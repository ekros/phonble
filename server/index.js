import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const maxTextBytes = 60 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const maxPayloadBytes = Math.ceil(maxImageBytes / 3) * 4 + 256;
const maxHistoryEntries = 20;
const maxHistoryBytes = 12 * 1024 * 1024;
const maxScrollStep = 600;
const inputLimits = {
  click: { ratePerSecond: 30, burst: 60 },
  scroll: { ratePerSecond: 120, burst: 240 },
  status: { ratePerSecond: 1, burst: 6 },
};
const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const port = Number(process.env.PORT ?? 3001);
const sessionIdAlphabet = 'abcdefghijklmnopqrstuvwxyz23456789';
const sessionIdLength = 10;

const generateSessionId = (sessions) => {
  let id;
  do {
    id = '';
    while (id.length < sessionIdLength) {
      for (const byte of randomBytes(16)) {
        if (byte < 224) id += sessionIdAlphabet[byte % sessionIdAlphabet.length];
        if (id.length === sessionIdLength) break;
      }
    }
    id = `${id.slice(0, 3)}-${id.slice(3, 7)}-${id.slice(7)}`;
  } while (sessions.has(id));
  return id;
};

const virtualAdapterPattern = /^(br-|docker|veth|virbr|vmnet|vboxnet|tun|tap|utun|wg|zt|tailscale)/i;

const rankLanAddress = (address, adapterName) => {
  if (address.startsWith('169.254.')) return 90;
  const adapterRank = virtualAdapterPattern.test(adapterName) ? 50 : 0;
  if (address.startsWith('192.168.')) return adapterRank;
  if (address.startsWith('10.')) return adapterRank + 1;
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(address)) return adapterRank + 2;
  return adapterRank + 3;
};

const getLanAddresses = () => {
  const addressed = [];
  for (const [adapterName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4)) continue;
      addressed.push({ address: entry.address, rank: rankLanAddress(entry.address, adapterName) });
    }
  }
  return [...new Set(addressed.sort((a, b) => a.rank - b.rank).map(({ address }) => address))];
};

const isUnitCoordinate = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const readOptionalNumber = (value, max) =>
  isFiniteNumber(value) && value >= 0 && value <= max ? Math.round(value * 100) / 100 : null;

const readOptionalText = (value, maxLength) =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;

const maxStatusDurationSeconds = 60 * 60 * 24 * 30;
const maxStatusAgeMs = 60 * 60 * 24 * 7;

const sanitizeBattery = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (!isUnitCoordinate(value.level) || typeof value.charging !== 'boolean') return null;
  return {
    level: Math.round(value.level * 1000) / 1000,
    charging: value.charging,
    chargingTime: readOptionalNumber(value.chargingTime, maxStatusDurationSeconds),
    dischargingTime: readOptionalNumber(value.dischargingTime, maxStatusDurationSeconds),
  };
};

// Status snapshots are advisory: sub-fields that fail validation degrade to null instead of
// dropping the whole message, but a payload without the core shape is rejected outright.
const sanitizePhoneStatus = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (value.visibility !== 'visible' && value.visibility !== 'hidden') return null;
  const { network, screen } = value;
  if (!network || typeof network !== 'object' || typeof network.online !== 'boolean') return null;
  if (!screen || typeof screen !== 'object') return null;
  if (!isFiniteNumber(screen.width) || screen.width <= 0 || screen.width > 20000) return null;
  if (!isFiniteNumber(screen.height) || screen.height <= 0 || screen.height > 20000) return null;
  if (!isFiniteNumber(screen.dpr) || screen.dpr <= 0 || screen.dpr > 10) return null;
  if (screen.orientation !== 'portrait' && screen.orientation !== 'landscape') return null;

  const device = value.device && typeof value.device === 'object' ? value.device : {};
  const cores = isFiniteNumber(device.cores) && device.cores > 0 && device.cores <= 1024
    ? Math.round(device.cores)
    : null;
  const now = Date.now();
  const interactionAt = isFiniteNumber(value.lastInteractionAt)
    ? Math.min(now, Math.max(now - maxStatusAgeMs, value.lastInteractionAt))
    : now;

  return {
    type: 'phone-status',
    // Every participant measures age against the relay clock, so client clocks never leak in.
    updatedAt: now,
    visibility: value.visibility,
    lastInteractionAt: interactionAt,
    battery: sanitizeBattery(value.battery),
    network: {
      online: network.online,
      effectiveType: readOptionalText(network.effectiveType, 16),
      saveData: typeof network.saveData === 'boolean' ? network.saveData : null,
      rtt: readOptionalNumber(network.rtt, 60000),
      downlink: readOptionalNumber(network.downlink, 100000),
    },
    screen: {
      width: Math.round(screen.width),
      height: Math.round(screen.height),
      dpr: Math.round(screen.dpr * 100) / 100,
      orientation: screen.orientation,
    },
    device: {
      model: readOptionalText(device.model, 64),
      platformVersion: readOptionalText(device.platformVersion, 32),
      cores,
      memoryGb: readOptionalNumber(device.memoryGb, 4096),
    },
  };
};

const hasInputBudget = (participant, kind) => {
  const limit = inputLimits[kind];
  const bucket = participant.inputBuckets?.[kind];
  if (!limit || !bucket) return false;
  const now = Date.now();
  const elapsedSeconds = Math.max(0, now - bucket.refilledAt) / 1000;
  bucket.tokens = Math.min(limit.burst, bucket.tokens + elapsedSeconds * limit.ratePerSecond);
  bucket.refilledAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
};

const createInputBuckets = () => ({
  click: { tokens: inputLimits.click.burst, refilledAt: Date.now() },
  scroll: { tokens: inputLimits.scroll.burst, refilledAt: Date.now() },
  status: { tokens: inputLimits.status.burst, refilledAt: Date.now() },
});

const getBase64ByteLength = (data) => {
  if (
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  ) {
    return null;
  }

  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
};

const decodeBase64 = (data) => {
  if (typeof data !== 'string' || getBase64ByteLength(data) === null) return null;
  try {
    return Buffer.from(data, 'base64');
  } catch {
    return null;
  }
};

export const createRelayServer = () => {
  const app = express();
  const sessions = new Map();
  const participants = new Map();
  app.use(express.static(dist));
  app.get('/', (_request, response) => {
    response.sendFile(path.join(dist, 'index.html'));
  });

  const server = createServer(app);
  const clients = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });

  const removeSessionIfEmpty = (sessionId) => {
    if (!sessionId) return;
    const hasParticipants = Array.from(participants.values())
      .some((participant) => participant.sessionId === sessionId);
    if (!hasParticipants) sessions.delete(sessionId);
  };

  const broadcastParticipants = (sessionId) => {
    if (!sessionId) return;
    const roster = Array.from(participants.values())
      .filter((participant) => participant.sessionId === sessionId)
      .map(({ id, name }) => ({ id, name }));
    for (const peer of clients.clients) {
      const participant = participants.get(peer);
      if (peer.readyState !== WebSocket.OPEN || participant?.sessionId !== sessionId) continue;
      peer.send(JSON.stringify({
        type: 'participants',
        deviceId: participant.id,
        participants: roster,
      }));
    }
  };

  const getDefaultDeviceName = (sessionId) => {
    const names = new Set(Array.from(participants.values())
      .filter((participant) => participant.sessionId === sessionId)
      .map((participant) => participant.name));
    let number = 1;
    while (names.has(`Device ${number}`)) number += 1;
    return `Device ${number}`;
  };

  const assignToSession = (client, sessionId) => {
    const participant = participants.get(client);
    if (!participant) throw new Error('Unknown participant');
    const previousSessionId = participant.sessionId;
    const updatedParticipant = {
      ...participant,
      name: participant.hasCustomName ? participant.name : getDefaultDeviceName(sessionId),
      sessionId,
    };
    participants.set(client, updatedParticipant);
    removeSessionIfEmpty(previousSessionId);
    client.send(JSON.stringify({ type: 'session', sessionId }));
    client.send(JSON.stringify(sessions.get(sessionId).latestUpdate));
    client.send(JSON.stringify({ type: 'history', items: sessions.get(sessionId).history }));
    broadcastParticipants(previousSessionId);
    broadcastParticipants(sessionId);
  };

  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/ws') {
      socket.destroy();
      return;
    }

    clients.handleUpgrade(request, socket, head, (client) => {
      clients.emit('connection', client);
    });
  });

  clients.on('connection', (client) => {
    participants.set(client, {
      id: randomUUID(),
      name: 'Device',
      hasCustomName: false,
      sessionId: null,
      inputBuckets: createInputBuckets(),
    });

    client.send(JSON.stringify({ type: 'server-info', lanAddresses: getLanAddresses() }));

    client.on('error', (error) => {
      console.warn('WebSocket client error:', error.message);
    });

    client.on('close', () => {
      const participant = participants.get(client);
      if (participants.delete(client)) {
        removeSessionIfEmpty(participant?.sessionId);
        broadcastParticipants(participant?.sessionId);
      }
    });

    client.on('message', (message, isBinary) => {
      let update;
      try {
        if (isBinary) throw new Error('Binary messages are unsupported');
        update = JSON.parse(message.toString());

        if (update?.type === 'create-session') {
          const sessionId = generateSessionId(sessions);
          sessions.set(sessionId, {
            latestUpdate: { type: 'text', text: '' },
            history: [],
            historyBytes: 0,
          });
          assignToSession(client, sessionId);
          return;
        }

        if (update?.type === 'join-session') {
          if (typeof update.sessionId !== 'string' || !/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/.test(update.sessionId)) {
            client.send(JSON.stringify({ type: 'session-error', message: 'Session not found. Check the ID and try again.' }));
            return;
          }
          if (!sessions.has(update.sessionId)) {
            client.send(JSON.stringify({ type: 'session-error', message: 'Session not found. Check the ID and try again.' }));
            return;
          }
          assignToSession(client, update.sessionId);
          return;
        }

        if (update?.type === 'leave-session') {
          const participant = participants.get(client);
          if (!participant) throw new Error('Unknown participant');
          const previousSessionId = participant.sessionId;
          participants.set(client, { ...participant, sessionId: null });
          removeSessionIfEmpty(previousSessionId);
          client.send(JSON.stringify({ type: 'session-left' }));
          broadcastParticipants(previousSessionId);
          return;
        }

        if (update?.type === 'set-name') {
          const name = typeof update.name === 'string' ? update.name.trim() : '';
          const hasControlCharacter = name.split('').some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127;
          });
          if (!name || name.length > 32 || hasControlCharacter) {
            throw new Error('Invalid device name');
          }
          const participant = participants.get(client);
          if (!participant) throw new Error('Unknown participant');
          participants.set(client, { ...participant, name, hasCustomName: true });
          broadcastParticipants(participant.sessionId);
          return;
        }

        if (update?.type === 'pointer') {
          const participant = participants.get(client);
          if (!participant?.sessionId) throw new Error('Participant is not in a session');
          if (
            typeof update.active !== 'boolean' ||
            !isUnitCoordinate(update.x) ||
            !isUnitCoordinate(update.y)
          ) {
            throw new Error('Invalid pointer update');
          }
          const payload = JSON.stringify({
            type: 'pointer',
            deviceId: participant.id,
            active: update.active,
            x: update.x,
            y: update.y,
          });
          for (const peer of clients.clients) {
            if (
              peer !== client &&
              peer.readyState === WebSocket.OPEN &&
              participants.get(peer)?.sessionId === participant.sessionId
            ) {
              peer.send(payload);
            }
          }
          return;
        }

        if (update?.type === 'input') {
          const participant = participants.get(client);
          if (!participant?.sessionId) throw new Error('Participant is not in a session');
          const isScroll = update.kind === 'scroll';
          if (
            (update.kind !== 'click' && !isScroll) ||
            !isUnitCoordinate(update.x) ||
            !isUnitCoordinate(update.y) ||
            (isScroll && (typeof update.dy !== 'number' || !Number.isFinite(update.dy) || Math.abs(update.dy) > maxScrollStep))
          ) {
            throw new Error('Invalid input update');
          }
          if (!hasInputBudget(participant, isScroll ? 'scroll' : 'click')) return;
          const payload = JSON.stringify({
            type: 'input',
            deviceId: participant.id,
            kind: update.kind,
            x: update.x,
            y: update.y,
            ...(isScroll ? { dy: update.dy } : {}),
          });
          for (const peer of clients.clients) {
            if (
              peer !== client &&
              peer.readyState === WebSocket.OPEN &&
              participants.get(peer)?.sessionId === participant.sessionId
            ) {
              peer.send(payload);
            }
          }
          return;
        }

        if (update?.type === 'phone-status') {
          const participant = participants.get(client);
          if (!participant?.sessionId) throw new Error('Participant is not in a session');
          if (!hasInputBudget(participant, 'status')) return;
          const status = sanitizePhoneStatus(update);
          if (!status) throw new Error('Invalid phone status');
          const payload = JSON.stringify({ ...status, deviceId: participant.id });
          for (const peer of clients.clients) {
            if (
              peer !== client &&
              peer.readyState === WebSocket.OPEN &&
              participants.get(peer)?.sessionId === participant.sessionId
            ) {
              peer.send(payload);
            }
          }
          return;
        }

        if (update?.type === 'text') {
          if (typeof update.text !== 'string' || Buffer.byteLength(update.text, 'utf8') > maxTextBytes) {
            throw new Error('Invalid text update');
          }
        } else if (update?.type === 'image') {
          const imageBytes = typeof update.data === 'string' ? getBase64ByteLength(update.data) : null;
          if (
            !supportedImageTypes.has(update.mimeType) ||
            imageBytes === null ||
            imageBytes > maxImageBytes
          ) {
            throw new Error('Invalid image update');
          }
        } else if (update?.type === 'compressed-image') {
          const compressed = decodeBase64(update.data);
          if (!supportedImageTypes.has(update.mimeType) || !compressed || compressed.length > maxPayloadBytes) {
            throw new Error('Invalid compressed image update');
          }
          let imageBytes;
          try {
            imageBytes = gunzipSync(compressed, { maxOutputLength: maxImageBytes + 1 });
          } catch {
            throw new Error('Invalid compressed image update');
          }
          if (imageBytes.length > maxImageBytes) throw new Error('Invalid compressed image update');
        } else {
          throw new Error('Invalid shared update');
        }

        const participant = participants.get(client);
        const session = participant?.sessionId ? sessions.get(participant.sessionId) : null;
        if (!session) throw new Error('Participant is not in a session');
        session.latestUpdate = update;
        let historyPayload;
        if (update.type === 'image' || update.type === 'compressed-image' || (update.type === 'text' && update.text.length > 0)) {
          const historyItem = {
            ...update,
            id: randomUUID(),
            deviceName: participant.name,
            timestamp: Date.now(),
          };
          session.history.unshift(historyItem);
          session.historyBytes += Buffer.byteLength(JSON.stringify(historyItem));
          const removedIds = [];
          while (session.history.length > maxHistoryEntries || session.historyBytes > maxHistoryBytes) {
            const removedItem = session.history.pop();
            if (removedItem) {
              session.historyBytes -= Buffer.byteLength(JSON.stringify(removedItem));
              removedIds.push(removedItem.id);
            }
          }
          historyPayload = JSON.stringify({ type: 'history-item', item: historyItem, removedIds });
        }
        const payload = JSON.stringify(update);
        for (const peer of clients.clients) {
          if (
            peer.readyState === WebSocket.OPEN &&
            participants.get(peer)?.sessionId === participant.sessionId
          ) {
            peer.send(payload);
            if (historyPayload) peer.send(historyPayload);
          }
        }
      } catch {
        client.close(1003, 'Invalid shared update');
      }
    });
  });

  return { server, clients };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createRelayServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Phonble listening on http://localhost:${port}`);
  });
}