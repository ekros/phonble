# Phonble

**AGENT: DO NOT MODIFY THIS FILE UNLESS DIRECTLY ASKED**

Phonble is a new way to multitask using a PC and a phone.

It is a pair of applications working together:

- A webapp, designed to be run on a laptop.
- A phone app

The phone is put in a side of the screen, where it integrates into the web app.

Main features:

- Files can be drag and drop in both directions.
- Shared clipboard

Cool features:

- The pointer moves seameasly bettween the laptop and the phone
- Phone notifications are displayed as browser notifications.

Technical design:

- a monorepo that contains the webapp and a multi-platform phone app (capacitor)
- connection through websockets

UI:

- A blank canvas where you can drop files

## Development phases

## 0.1 Initial prototype

- A webapp that can be accessed from multiple computers
- Every time something is copied in it, it is available in the other machines
- Ideally it should autodetect the clipboard contents, otherwise, users should use ctrl+v or a button to copy content.
- It supports only text by now.

## 0.2 Second prototype

- Support for image sharing. Images are displayed in the destination app and can be downloaded.

## 0.3 Third prototype

- We can set a name for the device.
- All participants can see who is connected.

## 0.4 Multidevice

- Devices can create a session or join one (using session id)
- Sessions are stored in server memory
- Sessions have a short but secure alphanumeric id
- Only participants of the same session can see each other

## 0.5 Phone participants

- Phone positioning
  - A rectangle can be resized to define the boundaries of the phone that will be positioned on the screen.
  - By default it is positioned in the right side with the typical size of a phone.
  - In this mode, a QR with the session id appears in the middle of the phone area.
  - In this mode, the current elements of the UI are align to the left, leaving space for the phone.

## 0.6 Pointer sync

- The pointer sync feature allows us to have a unified experience between connected devices.
- Once defined, the pointer is "teleported" to the phone when it enters the defined area.
- If the pointer leaves the phone viewport, it returns to the controller's viewport.
- The pointer moves freely through the phone app. Nothing more happens yet.

## 0.7 Basic remote interactions

- when the cursor is in the remote phone we can scroll and click things inside the webapp context.

## 0.8 in-browser Phone status info

- When connected, we display some info in the phone placeholder, simulating the real location where it appears. For example, battery i the top-right corner.

## 0.8 Clipboard API

- Uses clipboardchange to autodetect changes in clipboard. The item is automatically sent if supported.

## 0.9 Web Locks API

- Exactly one controller owns the phone (no two devices fighting), multi-tab coordination.

## 0.10 Notifications

- phone notifications shown as desktop notifications (notifications api, service worker + badging api)

## 0.11 Gzip compression

- Compression Streams API: Gzip payloads before base64 → the 5 MB image budget goes 3–4× further over the relay.

## 0.x future

- Using this feature as a base, I want to perform actions in the app running in the phone (TBD)
