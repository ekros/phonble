import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
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
    });

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
        } else {
          throw new Error('Invalid shared update');
        }

        const participant = participants.get(client);
        const session = participant?.sessionId ? sessions.get(participant.sessionId) : null;
        if (!session) throw new Error('Participant is not in a session');
        session.latestUpdate = update;
        let historyPayload;
        if (update.type === 'image' || update.text.length > 0) {
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