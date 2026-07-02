# VPS RAM Monitor

An Electron desktop app that connects to your VPS over SSH and shows live
CPU + RAM usage on a small, transparent, always-on-top overlay — the kind
that stays visible over full-screen apps and games, like an FPS counter.

## Features

- 🔐 **SSH login** to your VPS (password or private key auth)
- 📊 **CPU + RAM polling** via `/proc/stat` and `/proc/meminfo` on a configurable interval
- 🖥️ **Real desktop overlay** — a small always-on-top widget (not embedded in
  the app window) pinned to the top-right of your screen, click-through so
  it never blocks game input
- 🟢🟡🔴 **Color-only feedback** — the overlay turns green (low), yellow
  (moderate), or red (high) based on usage. That's it — no warning text,
  no popups, no sounds, ever.
- 🧪 **Preview button** to see the overlay turn red on demand, without
  needing real high usage
- 🕶️ **Narrow Mode** — shrinks the overlay (and the dashboard window) for a
  more compact footprint. Purely a sizing option; it never changes alert
  behavior because there isn't any beyond color.
- 🧵 **Runs in the background** — closing the window just hides it to the
  system tray; monitoring (and the overlay) keep running. Use the tray menu
  to start/stop, toggle the overlay, or quit for real.
- 🚀 Optional **launch on system startup**

## Getting started

```bash
npm install
npm start
```

1. Open the app, enter your VPS host/IP, port, username, and either a
   password or a private key.
2. Click **Test SSH Connection** to confirm it can log in.
3. Set your check interval (default 15s).
4. Click **Save Settings**, then **Start Monitoring**.
5. A small CPU/RAM widget appears top-right of your screen — it stays on
   top of everything, including games. Its color reflects live usage.
6. Try **Preview High Usage** anytime to see the red state without waiting
   for real load.

## Color thresholds

- 🟢 Green: usage below 60%
- 🟡 Yellow: usage 60–85%
- 🔴 Red: usage 85%+

## Building an installer

```bash
npm run dist
```

Uses `electron-builder` to produce a DMG (macOS), NSIS installer (Windows),
or AppImage (Linux) in `dist/`.

## Security note

Credentials are stored locally on disk via `electron-store` (in your OS's
app data folder) so the app can reconnect without asking every time. For
best security, prefer **private key auth** over password auth, and only run
this on a machine you trust.

## Tech stack

- [Electron](https://www.electronjs.org/)
- [ssh2](https://github.com/mscdex/ssh2) for the SSH connection
- [electron-store](https://github.com/sindresorhus/electron-store) for local settings persistence
