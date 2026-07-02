# VPS RAM Monitor

An Electron desktop app that connects to your VPS over SSH, polls RAM usage on
a schedule, and throws up a hard-to-miss, always-on-top overlay banner (with
an audible siren) when memory usage hits a critical threshold (default 99%).

## Features

- 🔐 **SSH login** to your VPS (password or private key auth)
- 📊 **RAM polling** via `/proc/meminfo` on a configurable interval
- 🚨 **Full-width overlay alert** pinned to the top of the screen, on top of
  everything, with a looping siren sound, when RAM crosses your threshold
- 🧪 **Test Alert button** to preview the overlay + siren anytime, without
  needing real high RAM
- 🕶️ **Snooze** (10 min) and **Dismiss** controls on the alert
- 🧵 **Runs in the background** — closing the window just hides it to the
  system tray; monitoring keeps running. Use the tray menu to start/stop,
  fire a test alert, or quit for real.
- 🚀 Optional **launch on system startup**

## Getting started

```bash
npm install
npm start
```

1. Open the app, enter your VPS host/IP, port, username, and either a
   password or a private key.
2. Click **Test SSH Connection** to confirm it can log in.
3. Set your RAM threshold (default 99%) and check interval (default 15s).
4. Click **Save Settings**, then **Start Monitoring**.
5. Try **Test Alert Overlay** anytime to see/hear what a real alert looks like.

The app keeps monitoring in the background via the system tray icon even if
you close the dashboard window. Right-click the tray icon for quick actions.

## Building an installer

```bash
npm run dist
```

Uses `electron-builder` to produce a DMG (macOS), NSIS installer (Windows),
or AppImage (Linux) in `dist/`.

## Security note

Credentials are stored locally on disk via `electron-store` (in your OS's app
data folder) so the app can reconnect without asking every time. For best
security, prefer **private key auth** over password auth, and only run this
on a machine you trust.

## Tech stack

- [Electron](https://www.electronjs.org/)
- [ssh2](https://github.com/mscdex/ssh2) for the SSH connection
- [electron-store](https://github.com/sindresorhus/electron-store) for local settings persistence
