# Phonble 0.8

Text and images shared between named devices in a session. One machine hosts the app and relay; participants can scan a QR code to join from a phone and position the phone beside the desktop workspace. Moving the pointer into the phone area hands it over to the phone, and scrolling or clicking there scrolls and clicks the phone, so one pointer works across both screens.

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

Open the address printed by Rsbuild on the host, or open `http://<host-LAN-IP>:3000` from another device on the same network. The phone QR uses this computer's LAN address, so you can also open `http://localhost:3000` on the host and still scan it. Allow incoming connections to the Rsbuild port through the host firewall. The relay uses port 3001 locally; Rsbuild proxies `/ws` to it.

If the relay port is already in use during development, set `PORT` and `RELAY_PORT` to the same available port before running `npm run dev`.

## Built app

Build and serve the app and relay together:

```bash
npm run build
npm run start
```

Open `http://<host-LAN-IP>:3001` from each device, or `http://localhost:3001` on the host; the phone QR always points at the host's LAN address when one is available. Allow incoming connections to port 3001 through the host firewall. Set `PORT` to change this port (the development proxy still targets 3001).

Paste text or an image into the compose area to share it immediately. You can also type text and choose Share text, drop an image into the area, or choose an image file. PNG, JPEG, WebP, and GIF images up to 5 MB are supported. Images appear in the shared pane and can be downloaded there. Copy takes received text to the clipboard. Clipboard access requires a user action; browsers cannot reliably monitor the system clipboard or grant automatic clipboard access to an HTTP LAN page. If Copy is blocked, select the displayed text and copy it manually.

Create a session or join with its ID to share text, images, participants, and history privately with that session. Session IDs are saved in the browser and restored when it reconnects. On desktop widths above 1200 px, the phone target appears beside the workspace; resize it from the corner, and its width is saved in that browser. Its QR joins the session from a phone, using the host's LAN address even when the page is open on `localhost`; if no LAN address is found, the QR falls back to the current host and says it only works on this computer. Anyone who can scan the QR can join, so treat it like a session access credential. Enter a device name in the connected-devices strip and choose Save name. Names are saved in that browser and restored when it reconnects; unnamed devices appear as `Device 1`, `Device 2`, and so on.

While a session is active, every device also reports its own status, and the phone target shows the newest report from another participant as a status bar across the top of the placeholder: device name and network type on the left, battery charge in the top-right corner, and `Screen off` in place of the network once that device stops being visible. Charging state and, on Chromium, the device model and core count appear on hover. Reports are sent when they change plus a heartbeat every 30 seconds, and they never enter the clipboard history. The bar fades to `Stale` after 45 seconds of silence, which is what happens once the phone's screen turns off or its browser suspends the page. Battery, network quality, and model details come from `navigator.getBattery()`, `navigator.connection`, and User-Agent Client Hints, so Firefox and iOS show no battery reading; no browser exposes brightness, volume, thermal state, or lock-screen state.

Once a session has more than one device, moving the pointer into the phone target hands it to the phone: the host cursor disappears inside the area and an arrow appears on the phone screen, following the mouse position proportionally. Wheel scrolling and left clicks made inside the area are replayed on the phone at the same position, so the phone scrolls or activates what is under the arrow while the host page stays put. Leave the area and the pointer returns to the host. The device receiving the input shows a `Controlled by <device>` strip with a Release control button; while paused it ignores incoming scrolls and clicks until the controlling device leaves the area or goes quiet for a few seconds. The device displaying the shared pointer also buzzes once when it appears and twice when it leaves (`navigator.vibrate`), controlled by the `Vibrate on handoff` checkbox and remembered per browser. Vibration only exists in Chromium browsers on Android and in Samsung Internet; Firefox for Android removed the API and iOS never had it, so the checkbox is disabled there. Browsers ignore vibration until the page has received a tap or key press, so `Tap to enable vibration` appears until that happens, and phones in silent or Do Not Disturb mode suppress it. Typing, right clicks, drags, and pinch gestures are not forwarded. Any participant who joins the session can scroll and click the other screens, so treat the session ID as a remote-control credential.

Only one current shared item is stored at a time, with up to 20 recent shares in session history: text up to 60 KB or one image up to 5 MB. Restarting the server clears sessions and their content. There is no login or encryption on HTTP: anyone who can reach the host can join if they have a session ID and can read or replace shared content. Use only on a trusted network; do not expose this prototype to the public internet.
