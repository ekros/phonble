import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const maxTextBytes = 60 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const maxPayloadBytes = Math.ceil(maxImageBytes / 3) * 4 + 256;
const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const port = Number(process.env.PORT ?? 3001);
let latestUpdate = { type: 'text', text: '' };
const participants = new Map();

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

const broadcastParticipants = () => {
  const roster = Array.from(participants.values());
  for (const peer of clients.clients) {
    if (peer.readyState !== WebSocket.OPEN) continue;
    peer.send(JSON.stringify({
      type: 'participants',
      deviceId: participants.get(peer)?.id,
      participants: roster,
    }));
  }
};

const getDefaultDeviceName = () => {
  const names = new Set(Array.from(participants.values(), (participant) => participant.name));
  let number = 1;
  while (names.has(`Device ${number}`)) number += 1;
  return `Device ${number}`;
};

app.use(express.static(dist));
app.get('/', (_request, response) => {
  response.sendFile(path.join(dist, 'index.html'));
});

const server = createServer(app);
const clients = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });

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
  participants.set(client, { id: randomUUID(), name: getDefaultDeviceName() });
  client.send(JSON.stringify(latestUpdate));
  broadcastParticipants();

  client.on('error', (error) => {
    console.warn('WebSocket client error:', error.message);
  });

  client.on('close', () => {
    if (participants.delete(client)) broadcastParticipants();
  });

  client.on('message', (message, isBinary) => {
    let update;
    try {
      if (isBinary) throw new Error('Binary messages are unsupported');
      update = JSON.parse(message.toString());

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
        participants.set(client, { ...participant, name });
        broadcastParticipants();
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
    } catch {
      client.close(1003, 'Invalid shared update');
      return;
    }

    latestUpdate = update;
    const payload = JSON.stringify(latestUpdate);
    for (const peer of clients.clients) {
      if (peer.readyState === WebSocket.OPEN) peer.send(payload);
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Phonble listening on http://localhost:${port}`);
});