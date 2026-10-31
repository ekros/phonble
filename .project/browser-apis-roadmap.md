# Browser APIs roadmap

Planning document for [project-description.md](./project-description.md). Phases 0.1–0.7 are already implemented; 0.8–0.11 are the ones added to the description. This file tracks the full list of browser APIs worth using, what each one buys Phonble, and how to build it.

Code references are relative to this folder: [`../src/App.tsx`](../src/App.tsx), [`../src/remoteInput.ts`](../src/remoteInput.ts), [`../src/pointerSync.ts`](../src/pointerSync.ts), [`../server/index.js`](../server/index.js).

## Where Phonble stands today

| Already used | Where |
| --- | --- |
| WebSocket (`ws`) relay | [`../server/index.js`](../server/index.js), [`../src/App.tsx`](../src/App.tsx) |
| Clipboard `write()` / `writeText()`, `ClipboardItem` (PNG) | [`../src/App.tsx`](../src/App.tsx) |
| `createImageBitmap`, `canvas.toBlob`, `FileReader`, drag-and-drop | [`../src/App.tsx`](../src/App.tsx) |
| `localStorage` (device name, session id, phone width) | [`../src/App.tsx`](../src/App.tsx) |
| DOM-event replay for pointer/scroll/click | [`../src/remoteInput.ts`](../src/remoteInput.ts) |
| `qrcode.react` QR rendering | [`../src/App.tsx`](../src/App.tsx) |
| Vibration (`navigator.vibrate`) handoff cue | [`../src/haptics.ts`](../src/haptics.ts), [`../src/App.tsx`](../src/App.tsx) |

Known gaps this roadmap addresses: no clipboard autodetect (0.1), base64 images inflating payloads by 33% on a single TCP socket, history not durable in `localStorage`, no encryption, one pointer event per frame, and everything security-sensitive blocked by the plain-HTTP LAN constraint.

## Prerequisite P0 — Secure context (HTTPS)

Most of the list below is unavailable on `http://<LAN-IP>`. This is not a feature phase but a gate for 0.8, 0.10, 0.14, 0.15, 0.19 and 0.20.

- Serve the app and relay over HTTPS with a locally trusted CA (mkcert) or a self-signed cert plus a one-time trust prompt on the phone; keep `localhost` working as-is.
- Alternatively evaluate **Cloudflare Tunnel / Tailscale** for a real certificate without installing a CA on the phone.
- Deliverable: `npm run dev` and `npm run start` both serve HTTPS when `HTTPS=1`, the QR encodes `https://`, and the relay stays on `/ws` (proxied).
- Exit criteria: `navigator.clipboard.readText()`, `Notification.requestPermission()`, and `navigator.wakeLock.request()` all succeed on the phone over the LAN.

## Phase overview

| Phase | Browser APIs | Why | Effort |
| --- | --- | --- | --- |
| 0.8 | Clipboard `read()`/`readText()`, `clipboardchange`, Permissions API | 0.1 autodetect | S |
| 0.9 | Web Locks, `BroadcastChannel` | Single controller, multi-tab | S |
| 0.10 | Notifications, Service Worker, Badging | Headline "cool feature" | M |
| 0.11 | Compression Streams | Payload size | XS |
| 0.12 | `pointerrawupdate`, `getCoalescedEvents`, `movementX/Y` | Smooth pointer handoff | S |
| 0.13 | Web Crypto (ECDH + AES-GCM) | Session confidentiality | M |
| 0.14 | IndexedDB, `navigator.storage` | Durable history + quota UI | S |
| 0.15 | Screen Wake Lock | Phone stays awake as a display | XS |
| 0.16 | File System Access, `getAsFileSystemHandle` | Drag files/folders both ways | M |
| 0.17 | Web Share (L2) + Share Target | Files in/out of Phonble | S |
| 0.18 | Window Management, Screen Orientation, `visualViewport` | Correct phone-area placement | S |
| 0.19 | `BarcodeDetector`, `getUserMedia` | Reverse QR pairing | S |
| 0.20 | Idle Detection, Vibration | Control handoff polish | XS |
| 0.21 | WebRTC DataChannel / WebTransport | Transport upgrade for bulk + input | L |
| 0.x | WebCodecs, `getDisplayMedia`, View Transitions, Orientation | Exploratory | L |

---

## 0.8 Clipboard API

**Goal:** clipboard changes are picked up without Ctrl+V.

- APIs: `navigator.clipboard.readText()`, `navigator.clipboard.read()` (images), `clipboardchange` event (Chromium only, limited availability), `navigator.permissions.query({name: 'clipboard-read'})`.
- Design: subscribe to `clipboardchange` where present; otherwise poll `readText()` on `focus`/`visibilitychange` (never on a timer in a background tab) and only when `document.hasFocus()` and the user has opted in.
- Diff against the last seen value so an echoed share coming back from the relay does not re-trigger a send. Reuse the existing "recent share" comparison in [`../src/App.tsx`](../src/App.tsx).
- Surface an explicit "Clipboard autodetect: off / on" control and a permission-denied state; keep paste-to-share as the fallback.
- Depends on: P0.
- Exit criteria: copying text in another app makes it appear on the other device without interaction in Chrome/Edge; Firefox and Safari degrade to the paste path without errors.

## 0.9 Web Locks API

**Goal:** exactly one device drives a phone; no two tabs or devices fight over it.

- APIs: `navigator.locks.request()`, `BroadcastChannel`.
- Design: the controller acquires a lock named `phonble:control:<sessionId>:<targetDeviceId>` before sending input; release on pointer leaving the area, `visibilitychange` to hidden, or timeout. The relay still enforces ownership so a stale client cannot bypass it.
- Use `BroadcastChannel` for same-origin tab coordination (read-only follower tabs, one active sender).
- Extends the current "Controlled by `<device>`" strip and Release control in [`../src/remoteInput.ts`](../src/remoteInput.ts).
- Exit criteria: two devices moving the pointer into the same phone area never emit interleaved input; the loser shows "busy" instead of silently doing nothing.

## 0.10 Notifications

**Goal:** phone notifications appear as desktop notifications.

- APIs: `Notification` + `ServiceWorkerRegistration.showNotification()`, `navigator.setAppBadge`/`clearAppBadge`, `pushManager` only if a real push service is added later.
- Design: relay forwards notification payloads; the desktop registers a small service worker (required for actions, icons, and badge persistence) and renders them; clicking focuses the relevant phone area. Badge counts unread. Respect a per-device mute toggle.
- Capacitor: `Notification` is unavailable in the Android WebView — use `@capacitor/local-notifications` / `@capacitor/push-notifications` behind the same `notify()` interface.
- Depends on: P0 (desktop notification permission).
- Exit criteria: a simulated phone notification shows a desktop notification with title/body and increments the badge.

## 0.11 Gzip compression

**Goal:** smaller payloads over the relay.

- APIs: `CompressionStream` / `DecompressionStream` (`gzip`).
- Design: compress text and image bytes before the base64 hop, negotiate via a `caps` field in the hello message, keep an uncompressed fallback. Skip for payloads under ~1 KB where framing overhead dominates.
- Follow-up (not this phase): send images as raw binary frames instead of base64 JSON, which removes the remaining 33%.
- Exit criteria: a 4 MB PNG round-trips byte-identically and the wire payload measured on the relay drops substantially.

## 0.12 Pointer precision

**Goal:** the arrow on the phone moves as smoothly as the host cursor.

- APIs: `pointerrawupdate` event, `PointerEvent.getCoalescedEvents()`, `movementX`/`movementY`, `elementFromPoint`.
- Design: listen to `pointerrawupdate` where supported (fallback `pointermove`), batch coalesced samples per animation frame, send normalized coordinates (0..1) rather than CSS pixels so DPI and phone scale do not distort. Throttle to one message per frame, never per event.
- Replace the proportional mapping currently in [`../src/pointerSync.ts`](../src/pointerSync.ts) with area-relative normalization plus clamping at edges.
- Exit criteria: pointer movement over the relay is visibly smooth at 120 Hz input; no message burst exceeds one per frame.

## 0.13 Web Crypto session encryption

**Goal:** remove the "no encryption" caveat in [`../README.md`](../README.md).

- APIs: `crypto.subtle` (ECDH P-256 key agreement, AES-GCM 256), `crypto.getRandomValues`.
- Design: the session creator generates a key pair, keeps the private half locally, and puts the public key (or a symmetric room key) in the QR/URL `#fragment` so it never reaches the server. Participants derive a shared key and encrypt every payload envelope; the relay only sees ciphertext.
- The fragment-based join means the session id alone is no longer enough — document that the QR becomes the full credential.
- Exit criteria: relay logs and tests never contain plaintext clipboard content; joining with only the session id fails with a clear error.

## 0.14 IndexedDB history

**Goal:** history survives reload with real payloads.

- APIs: IndexedDB (Blob storage), `navigator.storage.persist()`, `navigator.storage.estimate()`.
- Design: move the 20-entry history out of React state into an object store keyed by `sessionId` + timestamp; store image bytes as Blobs, not base64. Show quota and offer "clear history" using the existing `Trash2` control.
- Exit criteria: a page reload restores the full history including images; `localStorage` no longer holds payload data.

## 0.15 Screen Wake Lock

**Goal:** the phone does not sleep while it is acting as a second screen.

- APIs: `navigator.wakeLock.request('screen')`, `visibilitychange` re-acquire, `screen.orientation`.
- Design: acquire while a session is active and the pointer has entered the area at least once; release when the app is hidden or control is released.
- Capacitor: use `@capacitor-community/keep-awake`.
- Depends on: P0.
- Exit criteria: the phone screen stays on for 10 minutes while a session is active and returns to normal after leaving.

## 0.16 File System Access

**Goal:** the blank canvas accepts real files and folders, in both directions.

- APIs: `DataTransferItem.getAsFileSystemHandle()`, `showOpenFilePicker`, `showSaveFilePicker`, `FileSystemObserver` (experimental).
- Design: dropping a file or directory yields a handle; render a canvas item per file. Received files get "Save" via `showSaveFilePicker` (or a Blob download fallback in unsupported browsers). Keep the current 5 MB guard until the transport upgrade in 0.21.
- Capacitor: not supported in the WebView — use `@capacitor/filesystem` + share sheet.
- Exit criteria: dragging a folder enumerates and shares its files; saving a received file works in Chromium without a download prompt.

## 0.17 Web Share

**Goal:** Phonble appears in the Android share sheet, and received content can be shared out.

- APIs: `navigator.share({files})`, `navigator.canShare`, Web Share Target in the PWA manifest.
- Design: manifest `share_target` posts files/text to the phone route, which drops them into the session. Outbound: a Share button next to Copy/Download.
- Capacitor: `@capacitor/share`.
- Exit criteria: sharing an image from another Android app lands in the shared pane; sharing from Phonble opens the system sheet.

## 0.18 Phone-area geometry

**Goal:** the phone rectangle is correct on any monitor layout.

- APIs: Window Management (`window.getScreenDetails()` + `screen.isExtended`), `screen.orientation.lock()`, `visualViewport`, `devicePixelRatio`.
- Design: clamp the resizable phone area to the current display bounds via `getScreenDetails()`; use `visualViewport` to avoid the phone keyboard pushing the layout; keep the saved width per display set.
- Exit criteria: with a second monitor attached, the phone area cannot be dragged off-screen and the saved width restores per display.

## 0.19 Reverse QR pairing

**Goal:** the desktop can scan the phone, not only the other way round.

- APIs: `BarcodeDetector` (Chromium), `getUserMedia({video})`, `MediaStreamTrack.applyConstraints({advanced:[{torch:true}]})`.
- Design: optional "Scan with this camera" button that opens a webcam preview and decodes the phone's session QR; manual id entry stays available.
- Depends on: P0.
- Exit criteria: scanning a phone-displayed QR joins the session on desktop without typing.

## 0.20 Control handoff polish

**Goal:** handoff feels deliberate instead of merely functional.

- APIs: Idle Detection (`IdleDetector`), Vibration (`navigator.vibrate`).
- Design: release control automatically when the host user is idle/away and show "away" in the participants strip; vibrate once when the pointer crosses into or out of the phone area.
- Depends on: P0 (Idle Detection), responsive layout for the participants strip.
- Exit criteria: no input is forwarded while the controller is idle; the phone vibrates on area entry (Android).
- Status: vibration is implemented in [`../src/haptics.ts`](../src/haptics.ts) and [`../src/App.tsx`](../src/App.tsx) — the device that displays the shared pointer buzzes once on entry and with a double pulse on exit, gated by a persisted `Vibrate on handoff` toggle. Because the spec requires sticky activation, a `Tap to enable vibration` button arms the API on pages that have not been interacted with. Idle Detection is still open.

## 0.21 Transport upgrade

**Goal:** stop serializing bulk data and pointer input on one TCP socket.

- APIs: WebRTC `RTCPeerConnection` + `RTCDataChannel` (reliable for files, unreliable/unordered for input), or `WebTransport` datagrams (HTTP/3, not available in the Android WebView).
- Design: keep the relay for signaling and session membership; negotiate a data channel when both peers support it and fall back to the WebSocket path unchanged. Binary frames remove base64 entirely.
- Risks: no TURN infrastructure means symmetric-NAT peers fall back; mDNS ICE candidates need the secure-context prerequisite.
- Exit criteria: two LAN peers transfer a 20 MB file without growing relay memory, and pointer input is not delayed behind the transfer. Fallback path still passes the existing relay tests in [`../tests/server.test.js`](../tests/server.test.js).

## 0.x Exploratory

- `getDisplayMedia` + `MediaStreamTrackProcessor` / WebCodecs — render the phone screen on the host and vice versa instead of replaying DOM events.
- View Transitions API — animate the pointer handoff.
- Device Orientation / DeviceMotion — flip-to-send and tilt gestures.
- `navigator.connection` — warn on metered networks and adapt compression.
- `navigator.userAgentData.getHighEntropyValues()` — prefill device names in 0.3 instead of `Device 1`.
- Permission API surfacing — replace opaque "Clipboard API unavailable" errors with actionable states.

## Considered and rejected

- **Web Bluetooth / WebUSB / WebHID / Web Serial** — the phone already speaks WebSocket, and pairing peripherals does not serve a stated feature. Revisit only if 0.x device actions need HID emulation.
- **Push API with a real push service** — Phonble is LAN-scoped and self-hosted; adding a push vendor contradicts that. Local notifications cover 0.10.
- **Background Sync / Periodic Sync** — no offline queue requirement; the relay is the source of truth.

## Cross-cutting notes

- **Capacitor gap:** Android WebView lacks `clipboardchange`, Notifications, Wake Lock, Web Share, File System Access, and WebTransport. Every phone-side feature needs a plugin-backed implementation behind a common interface (`/src/platform/`), with the web path used on desktop.
- **Feature detection:** no UA sniffing; probe `'x' in navigator` / `'x' in window` per phase and keep the documented fallback.
- **Tests:** each phase adds cases next to the existing suites — [`../tests/index.test.tsx`](../tests/index.test.tsx), [`../tests/pointerSync.test.ts`](../tests/pointerSync.test.ts), [`../tests/remoteInput.test.ts`](../tests/remoteInput.test.ts), [`../tests/server.test.js`](../tests/server.test.js). Relay-visible changes (0.11, 0.13, 0.21) need server-side coverage.
