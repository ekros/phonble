import { afterEach, expect, test } from '@rstest/core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

let relayProcess;
const sockets = [];

const connect = async (port) => {
  const socket = new globalThis.WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.push(socket);
  await once(socket, 'open');
  return socket;
};

const nextUpdate = (socket, type) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.removeEventListener('message', onMessage);
    reject(new Error(`Timed out waiting for ${type}`));
  }, 2000);
  const onMessage = (message) => {
    const update = JSON.parse(message.data);
    if (update.type !== type) return;
    clearTimeout(timeout);
    socket.removeEventListener('message', onMessage);
    resolve(update);
  };
  socket.addEventListener('message', onMessage);
});

const startRelay = async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  relayProcess = spawn(process.execPath, [resolve('server/index.js')], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((resolve, reject) => {
    relayProcess.stdout.on('data', (data) => {
      if (data.toString().includes(`localhost:${port}`)) resolve();
    });
    relayProcess.once('error', reject);
    relayProcess.once('exit', (code) => reject(new Error(`Relay exited with code ${code}`)));
  });
  return port;
};

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  if (relayProcess) {
    relayProcess.kill();
    relayProcess = undefined;
  }
});

test('isolates clipboard updates and participants by session', async () => {
  const port = await startRelay();

  const first = await connect(port);
  const second = await connect(port);
  const separate = await connect(port);
  const separateUpdates = [];
  separate.addEventListener('message', (message) => separateUpdates.push(JSON.parse(message.data)));

  const created = nextUpdate(first, 'session');
  first.send(JSON.stringify({ type: 'create-session' }));
  const firstSession = await created;
  expect(firstSession.sessionId).toMatch(/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/);

  const joined = nextUpdate(second, 'session');
  second.send(JSON.stringify({ type: 'join-session', sessionId: firstSession.sessionId }));
  await joined;
  const sharedRoster = nextUpdate(first, 'participants');
  second.send(JSON.stringify({ type: 'set-name', name: 'Same session device' }));
  expect((await sharedRoster).participants).toHaveLength(2);

  const separateSession = nextUpdate(separate, 'session');
  separate.send(JSON.stringify({ type: 'create-session' }));
  await separateSession;

  const receivedShare = nextUpdate(second, 'text');
  first.send(JSON.stringify({ type: 'text', text: 'private to this session' }));
  expect(await receivedShare).toEqual({ type: 'text', text: 'private to this session' });
  expect(separateUpdates.some((update) => update.text === 'private to this session')).toBe(false);

  const rejectedJoin = nextUpdate(separate, 'session-error');
  separate.send(JSON.stringify({ type: 'join-session', sessionId: 'm1ss-1ng0-id0' }));
  expect(await rejectedJoin).toEqual({
    type: 'session-error',
    message: 'Session not found. Check the ID and try again.',
  });

  const firstLeft = nextUpdate(first, 'session-left');
  first.send(JSON.stringify({ type: 'leave-session' }));
  await firstLeft;
  const secondLeft = nextUpdate(second, 'session-left');
  second.send(JSON.stringify({ type: 'leave-session' }));
  await secondLeft;

  const removedAfterLeave = nextUpdate(second, 'session-error');
  second.send(JSON.stringify({ type: 'join-session', sessionId: firstSession.sessionId }));
  expect((await removedAfterLeave).type).toBe('session-error');

  separate.close();
  await once(separate, 'close');
  const reconnectingDevice = await connect(port);
  const removedAfterDisconnect = nextUpdate(reconnectingDevice, 'session-error');
  reconnectingDevice.send(JSON.stringify({ type: 'join-session', sessionId: separateSession.sessionId }));
  expect((await removedAfterDisconnect).type).toBe('session-error');
});
test('reports the host network addresses to connecting clients', async () => {
  const port = await startRelay();
  const socket = new globalThis.WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.push(socket);
  const info = nextUpdate(socket, 'server-info');
  await once(socket, 'open');

  const { lanAddresses } = await info;
  expect(Array.isArray(lanAddresses)).toBe(true);
  expect(lanAddresses.every((address) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address))).toBe(true);
  expect(lanAddresses).not.toContain('127.0.0.1');
});

test('relays pointer updates only to the other devices of the session', async () => {
  const port = await startRelay();
  const host = await connect(port);
  const phone = await connect(port);
  const outsider = await connect(port);
  const hostUpdates = [];
  host.addEventListener('message', (message) => hostUpdates.push(JSON.parse(message.data)));
  const outsiderUpdates = [];
  outsider.addEventListener('message', (message) => outsiderUpdates.push(JSON.parse(message.data)));

  const created = nextUpdate(host, 'session');
  host.send(JSON.stringify({ type: 'create-session' }));
  const { sessionId } = await created;
  const joined = nextUpdate(phone, 'session');
  phone.send(JSON.stringify({ type: 'join-session', sessionId }));
  await joined;
  const outsiderSession = nextUpdate(outsider, 'session');
  outsider.send(JSON.stringify({ type: 'create-session' }));
  await outsiderSession;

  const relayed = nextUpdate(phone, 'pointer');
  host.send(JSON.stringify({ type: 'pointer', active: true, x: 0.25, y: 0.6 }));

  expect(await relayed).toEqual({
    type: 'pointer',
    deviceId: expect.any(String),
    active: true,
    x: 0.25,
    y: 0.6,
  });
  expect(hostUpdates.some((update) => update.type === 'pointer')).toBe(false);
  expect(outsiderUpdates.some((update) => update.type === 'pointer')).toBe(false);
});

test('rejects pointer updates outside the phone screen', async () => {
  const port = await startRelay();
  const host = await connect(port);
  const created = nextUpdate(host, 'session');
  host.send(JSON.stringify({ type: 'create-session' }));
  await created;

  const closed = once(host, 'close');
  host.send(JSON.stringify({ type: 'pointer', active: true, x: 1.4, y: 0.6 }));

  const [event] = await closed;
  expect(event.code).toBe(1003);
});

test('relays input updates only to the other devices of the session', async () => {
  const port = await startRelay();
  const host = await connect(port);
  const phone = await connect(port);
  const outsider = await connect(port);
  const hostUpdates = [];
  host.addEventListener('message', (message) => hostUpdates.push(JSON.parse(message.data)));
  const outsiderUpdates = [];
  outsider.addEventListener('message', (message) => outsiderUpdates.push(JSON.parse(message.data)));

  const created = nextUpdate(host, 'session');
  host.send(JSON.stringify({ type: 'create-session' }));
  const { sessionId } = await created;
  const joined = nextUpdate(phone, 'session');
  phone.send(JSON.stringify({ type: 'join-session', sessionId }));
  await joined;
  const outsiderSession = nextUpdate(outsider, 'session');
  outsider.send(JSON.stringify({ type: 'create-session' }));
  await outsiderSession;

  const relayedClick = nextUpdate(phone, 'input');
  host.send(JSON.stringify({ type: 'input', kind: 'click', x: 0.4, y: 0.65 }));
  expect(await relayedClick).toEqual({
    type: 'input',
    deviceId: expect.any(String),
    kind: 'click',
    x: 0.4,
    y: 0.65,
  });

  const relayedScroll = nextUpdate(phone, 'input');
  host.send(JSON.stringify({ type: 'input', kind: 'scroll', x: 0.4, y: 0.65, dy: 240 }));
  expect(await relayedScroll).toEqual({
    type: 'input',
    deviceId: expect.any(String),
    kind: 'scroll',
    x: 0.4,
    y: 0.65,
    dy: 240,
  });

  expect(hostUpdates.some((update) => update.type === 'input')).toBe(false);
  expect(outsiderUpdates.some((update) => update.type === 'input')).toBe(false);
});

test('rejects input updates the phone app cannot apply', async () => {
  const port = await startRelay();
  const host = await connect(port);
  const created = nextUpdate(host, 'session');
  host.send(JSON.stringify({ type: 'create-session' }));
  await created;

  const closed = once(host, 'close');
  host.send(JSON.stringify({ type: 'input', kind: 'keypress', x: 0.4, y: 0.65 }));

  const [event] = await closed;
  expect(event.code).toBe(1003);
});

test('keeps relaying clicks after a burst of scroll updates', async () => {
  const port = await startRelay();
  const host = await connect(port);
  const phone = await connect(port);
  const created = nextUpdate(host, 'session');
  host.send(JSON.stringify({ type: 'create-session' }));
  const { sessionId } = await created;
  const joined = nextUpdate(phone, 'session');
  phone.send(JSON.stringify({ type: 'join-session', sessionId }));
  await joined;

  let clicks = 0;
  phone.addEventListener('message', (message) => {
    if (JSON.parse(message.data).kind === 'click') clicks += 1;
  });
  for (let index = 0; index < 600; index += 1) {
    host.send(JSON.stringify({ type: 'input', kind: 'scroll', x: 0.5, y: 0.5, dy: 40 }));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));

  host.send(JSON.stringify({ type: 'input', kind: 'click', x: 0.5, y: 0.5 }));
  await new Promise((resolve) => setTimeout(resolve, 250));

  expect(clicks).toBe(1);
});

test('drops input updates above the relay rate limit without closing the socket', async () => {
  const port = await startRelay();
  const host = await connect(port);
  const phone = await connect(port);
  const created = nextUpdate(host, 'session');
  host.send(JSON.stringify({ type: 'create-session' }));
  const { sessionId } = await created;
  const joined = nextUpdate(phone, 'session');
  phone.send(JSON.stringify({ type: 'join-session', sessionId }));
  await joined;

  let relayed = 0;
  phone.addEventListener('message', (message) => {
    if (JSON.parse(message.data).type === 'input') relayed += 1;
  });
  for (let index = 0; index < 300; index += 1) {
    host.send(JSON.stringify({ type: 'input', kind: 'scroll', x: 0.5, y: 0.5, dy: 40 }));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));

  expect(relayed).toBeGreaterThan(0);
  expect(relayed).toBeLessThan(300);
  expect(host.readyState).toBe(1);
});
