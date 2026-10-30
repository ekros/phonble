# Phonble 0.2

Text and images shared between browsers on a trusted local network. One machine hosts the app and relay; every visitor sees the latest shared item.

## Setup

Install the dependencies:

```bash
npm install
```

## Development

Start the relay and Rsbuild together:

```bash
npm run dev
```

Open the address printed by Rsbuild on the host, or open `http://<host-LAN-IP>:3000` from another computer on the same network. Allow incoming connections to the Rsbuild port through the host firewall. The relay uses port 3001 locally; Rsbuild proxies `/ws` to it.

If the relay port is already in use during development, set `PORT` and `RELAY_PORT` to the same available port before running `npm run dev`.

## Built app

Build and serve the app and relay together:

```bash
npm run build
npm run start
```

Open `http://<host-LAN-IP>:3001` from each computer. Allow incoming connections to port 3001 through the host firewall. Set `PORT` to change this port (the development proxy still targets 3001).

Paste text or an image into the compose area to share it immediately. You can also type text and choose Share text, drop an image into the area, or choose an image file. PNG, JPEG, WebP, and GIF images up to 5 MB are supported. Images appear in the shared pane and can be downloaded there. Copy takes received text to the clipboard. Clipboard access requires a user action; browsers cannot reliably monitor the system clipboard or grant automatic clipboard access to an HTTP LAN page. If Copy is blocked, select the displayed text and copy it manually.

Only one shared item is stored at a time: text up to 60 KB or one image up to 5 MB. The latest update replaces the previous one, and restarting the server clears it. There is no login or encryption on HTTP: anyone who can reach the host can read or replace shared content. Use only on a trusted network; do not expose this prototype to the public internet.
