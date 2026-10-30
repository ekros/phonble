import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const maxTextBytes = 60 * 1024;
const port = Number(process.env.PORT ?? 3001);
let latestText = '';

app.use(express.static(dist));
app.get('/', (_request, response) => {
  response.sendFile(path.join(dist, 'index.html'));
});

const server = createServer(app);
const clients = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

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
  client.send(JSON.stringify({ type: 'text', text: latestText }));

  client.on('message', (message, isBinary) => {
    let update;
    try {
      if (isBinary) throw new Error('Binary messages are unsupported');
      update = JSON.parse(message.toString());
      if (
        update?.type !== 'text' ||
        typeof update.text !== 'string' ||
        Buffer.byteLength(update.text, 'utf8') > maxTextBytes
      ) {
        throw new Error('Invalid text update');
      }
    } catch {
      client.close(1003, 'Invalid text update');
      return;
    }

    latestText = update.text;
    const payload = JSON.stringify({ type: 'text', text: latestText });
    for (const peer of clients.clients) {
      if (peer.readyState === WebSocket.OPEN) peer.send(payload);
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Phonble listening on http://localhost:${port}`);
});