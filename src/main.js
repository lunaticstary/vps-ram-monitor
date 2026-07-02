const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { fetchSystemUsage, testConnection } = require('./ssh-monitor');

const store = new Store({
  name: 'vps-ram-monitor-config',
  defaults: {
    host: '',
    port: 22,
    username: '',
    authType: 'password', // 'password' | 'key'
    password: '',
    privateKey: '',
    passphrase: '',
    pollIntervalSec: 15,
    launchOnStartup: false,
    showLiveUsageBar: true, // in-app bar inside the dashboard window
    showDesktopOverlay: true, // real always-on-top desktop overlay widget
    compactLayout: false, // "Narrow Mode" - only affects sizing, never alerts
  },
});

const NORMAL_WIDTH = 480;
const COMPACT_WIDTH = 340;

const OVERLAY_SIZE_NORMAL = { width: 210, height: 64 };
const OVERLAY_SIZE_COMPACT = { width: 140, height: 46 };
const OVERLAY_MARGIN = 16;

let mainWindow = null;
let statsOverlayWindow = null;
let tray = null;
let monitorTimer = null;
let isMonitoring = false;

function createMainWindow() {
  const compact = store.get('compactLayout');
  mainWindow = new BrowserWindow({
    width: compact ? COMPACT_WIDTH : NORMAL_WIDTH,
    height: 760,
    resizable: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function overlaySize() {
  return store.get('compactLayout') ? OVERLAY_SIZE_COMPACT : OVERLAY_SIZE_NORMAL;
}

function overlayPosition(size) {
  const { x, y, width } = screen.getPrimaryDisplay().workArea;
  return {
    x: x + width - size.width - OVERLAY_MARGIN,
    y: y + OVERLAY_MARGIN,
  };
}

function createStatsOverlayWindow() {
  const size = overlaySize();
  const pos = overlayPosition(size);

  statsOverlayWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' level + visibleOnFullScreen keeps it above full-screen apps/games on macOS.
  statsOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  statsOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  statsOverlayWindow.loadFile(path.join(__dirname, 'stats-overlay.html'));

  // Purely a readout - let clicks/input pass straight through to whatever is underneath (e.g. a game).
  statsOverlayWindow.once('ready-to-show', () => {
    if (statsOverlayWindow) statsOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  statsOverlayWindow.on('closed', () => {
    statsOverlayWindow = null;
  });
}

function ensureStatsOverlayWindow() {
  if (!statsOverlayWindow || statsOverlayWindow.isDestroyed()) {
    createStatsOverlayWindow();
  }
}

function repositionStatsOverlay() {
  if (!statsOverlayWindow || statsOverlayWindow.isDestroyed()) return;
  const size = overlaySize();
  const pos = overlayPosition(size);
  statsOverlayWindow.setBounds({ x: pos.x, y: pos.y, width: size.width, height: size.height });
}

function showStatsOverlay() {
  if (!store.get('showDesktopOverlay')) return;
  ensureStatsOverlayWindow();
  repositionStatsOverlay();
  statsOverlayWindow.showInactive();
}

function hideStatsOverlay() {
  if (statsOverlayWindow && !statsOverlayWindow.isDestroyed()) {
    statsOverlayWindow.hide();
  }
}

function updateStatsOverlay(data) {
  if (!statsOverlayWindow || statsOverlayWindow.isDestroyed()) return;
  const payload = { ...data, compact: store.get('compactLayout') };
  const send = () => statsOverlayWindow.webContents.send('stats-overlay-data', payload);
  if (statsOverlayWindow.webContents.isLoading()) {
    statsOverlayWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) {
    image = image.resize({ width: 16, height: 16 });
  }
  tray = new Tray(image);
  tray.setToolTip('VPS RAM Monitor');
  refreshTrayMenu();

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
}

function refreshTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => mainWindow.show() },
    { type: 'separator' },
    {
      label: isMonitoring ? 'Stop Monitoring' : 'Start Monitoring',
      click: () => (isMonitoring ? stopMonitoring() : startMonitoring()),
    },
    {
      label: store.get('showDesktopOverlay') ? 'Hide Desktop Overlay' : 'Show Desktop Overlay',
      click: () => {
        store.set('showDesktopOverlay', !store.get('showDesktopOverlay'));
        if (store.get('showDesktopOverlay') && isMonitoring) showStatsOverlay();
        else hideStatsOverlay();
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function sendLog(line) {
  console.log(line);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-line', `[${new Date().toLocaleTimeString()}] ${line}`);
  }
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', status);
  }
}

async function pollOnce() {
  const config = store.store;
  if (!config.host || !config.username) {
    sendLog('Skipping poll: host/username not configured.');
    return;
  }
  try {
    const usage = await fetchSystemUsage(config);
    const cpuLabel = usage.cpuPercent != null ? `${usage.cpuPercent}%` : 'n/a';
    sendLog(`${config.host} — RAM: ${usage.ramPercent}% (${usage.ramUsedMB}MB / ${usage.ramTotalMB}MB), CPU: ${cpuLabel}`);
    sendStatus({
      connected: true,
      usedPercent: usage.ramPercent,
      usedMB: usage.ramUsedMB,
      totalMB: usage.ramTotalMB,
      cpuPercent: usage.cpuPercent,
    });
    // Overlay only ever reflects live numbers + color. No thresholds, no popups, no sounds.
    updateStatsOverlay({ cpuPercent: usage.cpuPercent, ramPercent: usage.ramPercent });
  } catch (err) {
    sendLog(`ERROR: ${err.message}`);
    sendStatus({ connected: false, error: err.message });
  }
}

function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;
  const intervalMs = Math.max(5, Number(store.get('pollIntervalSec')) || 15) * 1000;
  sendLog(`Monitoring started (every ${intervalMs / 1000}s).`);
  showStatsOverlay();
  pollOnce();
  monitorTimer = setInterval(pollOnce, intervalMs);
  refreshTrayMenu();
  sendStatus({ monitoring: true });
}

function stopMonitoring() {
  isMonitoring = false;
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
  hideStatsOverlay();
  sendLog('Monitoring stopped.');
  refreshTrayMenu();
  sendStatus({ monitoring: false });
}

// ---- IPC handlers ----
ipcMain.handle('get-settings', () => store.store);

ipcMain.handle('save-settings', (_e, settings) => {
  const prevCompact = store.get('compactLayout');
  const prevShowOverlay = store.get('showDesktopOverlay');
  Object.keys(settings).forEach((key) => store.set(key, settings[key]));
  app.setLoginItemSettings({ openAtLogin: !!settings.launchOnStartup });

  if (typeof settings.compactLayout === 'boolean' && settings.compactLayout !== prevCompact) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [, height] = mainWindow.getSize();
      mainWindow.setSize(settings.compactLayout ? COMPACT_WIDTH : NORMAL_WIDTH, height);
    }
    repositionStatsOverlay();
  }

  if (typeof settings.showDesktopOverlay === 'boolean' && settings.showDesktopOverlay !== prevShowOverlay) {
    if (settings.showDesktopOverlay && isMonitoring) showStatsOverlay();
    if (!settings.showDesktopOverlay) hideStatsOverlay();
  }

  sendLog('Settings saved.');
  return store.store;
});

ipcMain.handle('test-connection', async (_e, settings) => {
  try {
    await testConnection(settings);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('start-monitoring', () => {
  startMonitoring();
  return { monitoring: true };
});

ipcMain.handle('stop-monitoring', () => {
  stopMonitoring();
  return { monitoring: false };
});

// Lets the user see what the overlay looks like at high usage - color only, briefly,
// then automatically reverts to real numbers. No banner, no text, no sound.
ipcMain.handle('preview-high-usage', () => {
  const wasVisible = !!(statsOverlayWindow && !statsOverlayWindow.isDestroyed() && statsOverlayWindow.isVisible());
  showStatsOverlay();
  updateStatsOverlay({ cpuPercent: 97, ramPercent: 99 });
  setTimeout(() => {
    if (isMonitoring) {
      pollOnce();
    } else if (!wasVisible) {
      hideStatsOverlay();
    }
  }, 5000);
  return { ok: true };
});

app.whenReady().then(() => {
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Keep running in background (tray) instead of quitting.
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
