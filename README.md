# Phonble 0.1

Text shared between browsers on a trusted local network. One machine hosts the app and relay; every visitor sees the latest shared text.

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

## Built app

Build and serve the app and relay together:

```bash
npm run build
npm run start
```

Open `http://<host-LAN-IP>:3001` from each computer. Allow incoming connections to port 3001 through the host firewall. Set `PORT` to change this port (the development proxy still targets 3001).

Paste into the text box to share immediately, or type text and choose Share text. Use Copy on another device to take the received text. Clipboard access requires a user action; browsers cannot reliably monitor the system clipboard or grant automatic clipboard access to an HTTP LAN page. If Copy is blocked, select the displayed text and copy it manually.

Only one text value is stored, up to 60 KB. The latest update wins, and restarting the server clears it. There is no login or encryption on HTTP: anyone who can reach the host can read or replace the shared text. Use only on a trusted network; do not expose this prototype to the public internet.
