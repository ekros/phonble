# Phonble 0.5

Text and images shared between named devices in a session. One machine hosts the app and relay; participants can scan a QR code to join from a phone and position the phone beside the desktop workspace.

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

Open the address printed by Rsbuild on the host, or open `http://<host-LAN-IP>:3000` from another device on the same network. Use the host's LAN address, not `localhost`, so the phone QR can reach this computer. Allow incoming connections to the Rsbuild port through the host firewall. The relay uses port 3001 locally; Rsbuild proxies `/ws` to it.

If the relay port is already in use during development, set `PORT` and `RELAY_PORT` to the same available port before running `npm run dev`.

## Built app

Build and serve the app and relay together:

```bash
npm run build
npm run start
```

Open `http://<host-LAN-IP>:3001` from each device. Use this LAN address on the host computer too if you want to scan the phone QR. Allow incoming connections to port 3001 through the host firewall. Set `PORT` to change this port (the development proxy still targets 3001).

Paste text or an image into the compose area to share it immediately. You can also type text and choose Share text, drop an image into the area, or choose an image file. PNG, JPEG, WebP, and GIF images up to 5 MB are supported. Images appear in the shared pane and can be downloaded there. Copy takes received text to the clipboard. Clipboard access requires a user action; browsers cannot reliably monitor the system clipboard or grant automatic clipboard access to an HTTP LAN page. If Copy is blocked, select the displayed text and copy it manually.

Create a session or join with its ID to share text, images, participants, and history privately with that session. Session IDs are saved in the browser and restored when it reconnects. On desktop widths above 1200 px, the phone target appears beside the workspace; resize it from the corner, and its width is saved in that browser. Its QR opens the current host and joins the session automatically. Anyone who can scan the QR can join, so treat it like a session access credential. Enter a device name in the connected-devices strip and choose Save name. Names are saved in that browser and restored when it reconnects; unnamed devices appear as `Device 1`, `Device 2`, and so on.

Only one current shared item is stored at a time, with up to 20 recent shares in session history: text up to 60 KB or one image up to 5 MB. Restarting the server clears sessions and their content. There is no login or encryption on HTTP: anyone who can reach the host can join if they have a session ID and can read or replace shared content. Use only on a trusted network; do not expose this prototype to the public internet.
