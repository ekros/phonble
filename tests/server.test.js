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

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  if (relayProcess) {
    relayProcess.kill();
    relayProcess = undefined;
  }
});

test('isolates clipboard updates and participants by session', async () => {
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