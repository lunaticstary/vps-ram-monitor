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
    thresholdPercent: 99,
    launchOnStartup: false,
    showLiveUsageBar: true,
    compactLayout: false,
  },
});

const NORMAL_WIDTH = 480;
const COMPACT_WIDTH = 340;

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let monitorTimer = null;
let isMonitoring = false;
let snoozeUntil = 0;
let alertActive = false;

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
    { label: 'Send Test Alert', click: () => showOverlay({ test: true, usedPercent: 99.4, host: store.get('host') || 'test-vps' }) },
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

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width,
    height: 130,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function showOverlay(data) {
  const now = Date.now();
  if (now < snoozeUntil) {
    sendLog('Alert suppressed (snoozed)');
    return;
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
  alertActive = true;
  const send = () => overlayWindow.webContents.send('overlay-data', data);
  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
  overlayWindow.showInactive();
  overlayWindow.focus();
}

function hideOverlay() {
  alertActive = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
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

    if (usage.ramPercent >= Number(config.thresholdPercent)) {
      showOverlay({ usedPercent: usage.ramPercent, host: config.host, test: false });
    } else if (alertActive) {
      hideOverlay();
    }
  } catch (err) {
    sendLog(`ERROR: ${err.message}`);
    sendStatus({ connected: false, error: err.message });
  }
}

function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;
  const intervalMs = Math.max(5, Number(store.get('pollIntervalSec')) || 15) * 1000;
  sendLog(`Monitoring started (every ${intervalMs / 1000}s, threshold ${store.get('thresholdPercent')}%).`);
  pollOnce();
  monitorTimer = setInterval(pollOnce, intervalMs);
  refreshTrayMenu();
  sendStatus({ monitoring: true });
}

function stopMonitoring() {
  isMonitoring = false;
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
  sendLog('Monitoring stopped.');
  refreshTrayMenu();
  sendStatus({ monitoring: false });
}

// ---- IPC handlers ----
ipcMain.handle('get-settings', () => store.store);

ipcMain.handle('save-settings', (_e, settings) => {
  const prevCompact = store.get('compactLayout');
  Object.keys(settings).forEach((key) => store.set(key, settings[key]));
  app.setLoginItemSettings({ openAtLogin: !!settings.launchOnStartup });

  if (typeof settings.compactLayout === 'boolean' && settings.compactLayout !== prevCompact) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [, height] = mainWindow.getSize();
      mainWindow.setSize(settings.compactLayout ? COMPACT_WIDTH : NORMAL_WIDTH, height);
    }
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

ipcMain.handle('trigger-test-alert', () => {
  showOverlay({ test: true, usedPercent: 99.4, host: store.get('host') || 'test-vps' });
  return { ok: true };
});

ipcMain.on('overlay-dismiss', () => hideOverlay());
ipcMain.on('overlay-snooze', (_e, minutes) => {
  snoozeUntil = Date.now() + Math.max(1, Number(minutes) || 10) * 60 * 1000;
  sendLog(`Alerts snoozed for ${minutes} minute(s).`);
  hideOverlay();
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
