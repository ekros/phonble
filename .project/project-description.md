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

## 0.6 Pointer sync

- Once defined, the pointer is "teleported" to the phone when it enters the defined area.
  -> Using this feature as a base, I want to perform actions in the app running in the phone (TBD)
