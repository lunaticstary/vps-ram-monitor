const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { fetchSystemUsage, testConnection } = require('./ssh-monitor');

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const store = new Store({
  name: 'vps-ram-monitor-config',
  defaults: {
    servers: [], // [{ id, name, host, port, username, authType, password, privateKey, passphrase }]
    pollIntervalSec: 15,
    launchOnStartup: false,
    showLiveUsageBar: true, // in-app live status list inside the dashboard window
    showDesktopOverlay: true, // real always-on-top desktop overlay widget
    compactLayout: false, // "Narrow Mode" - only affects sizing, never alerts
    soundAlertsEnabled: true, // beeps + spoken warning when usage is high
    showCpu: true,
    showRam: true,
    showDisk: true,
    // legacy single-server fields, kept only so we can migrate old configs below
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    password: '',
    privateKey: '',
    passphrase: '',
  },
});

// One-time migration: older versions of this app stored a single server directly
// on the settings object. If that's all we have, turn it into the first server.
(function migrateLegacySingleServer() {
  const servers = store.get('servers') || [];
  if (servers.length === 0 && store.get('host')) {
    servers.push({
      id: genId(),
      name: store.get('host'),
      host: store.get('host'),
      port: store.get('port') || 22,
      username: store.get('username') || '',
      authType: store.get('authType') || 'password',
      password: store.get('password') || '',
      privateKey: store.get('privateKey') || '',
      passphrase: store.get('passphrase') || '',
    });
    store.set('servers', servers);
  }
})();

const NORMAL_WIDTH = 520;
const COMPACT_WIDTH = 360;

const OVERLAY_WIDTH_NORMAL = 250;
const OVERLAY_WIDTH_COMPACT = 170;
const OVERLAY_ROW_HEIGHT_NORMAL = 62;
const OVERLAY_ROW_HEIGHT_COMPACT = 44;
const OVERLAY_MARGIN = 16;

// Same red cutoff the overlay/dashboard use for coloring - used here only to decide
// whether to fire the (optional) sound alert, not to show any text/popup.
const USAGE_RED_AT = 85;
const SOUND_ALERT_COOLDOWN_MS = 20000;

let mainWindow = null;
let statsOverlayWindow = null;
let tray = null;
let monitorTimer = null;
let isMonitoring = false;
let lastSoundAlertAt = 0;

function createMainWindow() {
  const compact = store.get('compactLayout');
  mainWindow = new BrowserWindow({
    width: compact ? COMPACT_WIDTH : NORMAL_WIDTH,
    height: 820,
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
  // Just an initial estimate for window creation - the renderer measures its own real
  // content height after every render and reports it back (see 'stats-overlay-resize'),
  // which is what actually determines the final height. This avoids the last server
  // row ever getting clipped if a name is long or wraps.
  const compact = store.get('compactLayout');
  const rowH = compact ? OVERLAY_ROW_HEIGHT_COMPACT : OVERLAY_ROW_HEIGHT_NORMAL;
  const rows = Math.max(1, (store.get('servers') || []).length);
  return {
    width: compact ? OVERLAY_WIDTH_COMPACT : OVERLAY_WIDTH_NORMAL,
    height: rows * rowH + 16,
  };
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

function updateStatsOverlay(servers) {
  if (!statsOverlayWindow || statsOverlayWindow.isDestroyed()) return;
  const payload = {
    servers,
    compact: store.get('compactLayout'),
    showCpu: store.get('showCpu'),
    showRam: store.get('showRam'),
    showDisk: store.get('showDisk'),
  };
  const send = () => statsOverlayWindow.webContents.send('stats-overlay-data', payload);
  if (statsOverlayWindow.webContents.isLoading()) {
    statsOverlayWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

// Beeping + speech happen in the dashboard renderer (index.js) since that window's
// webContents stay alive in the background even when the window is hidden.
function sendSoundAlert(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sound-alert', data);
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
    {
      label: store.get('soundAlertsEnabled') ? 'Disable Sound & Voice Alerts' : 'Enable Sound & Voice Alerts',
      click: () => {
        store.set('soundAlertsEnabled', !store.get('soundAlertsEnabled'));
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

function serverLabel(srv) {
  return (srv && (srv.name || srv.host)) || 'Unnamed server';
}

async function pollOnce() {
  const servers = store.get('servers') || [];
  if (servers.length === 0) {
    sendLog('No servers configured yet — add one in the dashboard.');
    sendStatus({ servers: [] });
    return;
  }

  const results = await Promise.allSettled(
    servers.map((srv) =>
      fetchSystemUsage(srv)
        .then((usage) => ({ srv, usage }))
        .catch((err) => Promise.reject({ srv, err }))
    )
  );

  const statusList = [];
  const alerts = [];

  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      const { srv, usage } = r.value;
      const label = serverLabel(srv);
      const diskLabel = usage.diskPercent != null ? `${usage.diskPercent}%` : 'n/a';
      const cpuLabel = usage.cpuPercent != null ? `${usage.cpuPercent}%` : 'n/a';
      sendLog(`${label} — RAM ${usage.ramPercent}%, CPU ${cpuLabel}, Disk ${diskLabel}`);

      statusList.push({
        id: srv.id,
        name: label,
        connected: true,
        ramPercent: usage.ramPercent,
        ramUsedMB: usage.ramUsedMB,
        ramTotalMB: usage.ramTotalMB,
        cpuPercent: usage.cpuPercent,
        diskPercent: usage.diskPercent,
        diskUsedMB: usage.diskUsedMB,
        diskTotalMB: usage.diskTotalMB,
      });

      const ramHigh = usage.ramPercent >= USAGE_RED_AT;
      const cpuHigh = usage.cpuPercent != null && usage.cpuPercent >= USAGE_RED_AT;
      const diskHigh = usage.diskPercent != null && usage.diskPercent >= USAGE_RED_AT;
      if (ramHigh || cpuHigh || diskHigh) {
        alerts.push({
          name: label,
          ramHigh,
          cpuHigh,
          diskHigh,
          ramPercent: usage.ramPercent,
          cpuPercent: usage.cpuPercent,
          diskPercent: usage.diskPercent,
        });
      }
    } else {
      const reason = r.reason || {};
      const srv = reason.srv;
      const label = serverLabel(srv);
      const message = reason.err ? reason.err.message : 'Unknown error';
      sendLog(`ERROR (${label}): ${message}`);
      statusList.push({ id: srv ? srv.id : genId(), name: label, connected: false, error: message });
    }
  });

  sendStatus({ servers: statusList });
  // Overlay visuals only ever reflect live numbers + color. No banner/popup text, ever.
  updateStatsOverlay(statusList);

  // Optional audible alert (beeps + spoken warning) - separate from the overlay's color,
  // gated behind its own toggle so it never fires unless the user turned it on.
  if (store.get('soundAlertsEnabled') && alerts.length > 0) {
    const now = Date.now();
    if (now - lastSoundAlertAt >= SOUND_ALERT_COOLDOWN_MS) {
      lastSoundAlertAt = now;
      sendSoundAlert({ alerts });
    }
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
  const allowedKeys = [
    'pollIntervalSec',
    'launchOnStartup',
    'showLiveUsageBar',
    'showDesktopOverlay',
    'compactLayout',
    'soundAlertsEnabled',
    'showCpu',
    'showRam',
    'showDisk',
  ];
  allowedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(settings, key)) store.set(key, settings[key]);
  });
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

ipcMain.handle('get-servers', () => store.get('servers') || []);

// The overlay renderer measures its own content after every render and reports the
// real pixel height here, so the window always fits exactly - no clipped last row.
ipcMain.on('stats-overlay-resize', (event, height) => {
  if (!statsOverlayWindow || statsOverlayWindow.isDestroyed()) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== statsOverlayWindow) return;
  const width = overlaySize().width;
  const clampedHeight = Math.max(30, Math.round(height) + 2);
  const pos = overlayPosition({ width });
  statsOverlayWindow.setBounds({ x: pos.x, y: pos.y, width, height: clampedHeight });
});

ipcMain.handle('add-server', (_e, server) => {
  const servers = store.get('servers') || [];
  const newServer = {
    id: genId(),
    name: (server.name || server.host || '').trim(),
    host: server.host,
    port: Number(server.port) || 22,
    username: server.username,
    authType: server.authType || 'password',
    password: server.password || '',
    privateKey: server.privateKey || '',
    passphrase: server.passphrase || '',
  };
  servers.push(newServer);
  store.set('servers', servers);
  repositionStatsOverlay();
  sendLog(`Added server: ${serverLabel(newServer)}`);
  return servers;
});

ipcMain.handle('remove-server', (_e, id) => {
  let servers = store.get('servers') || [];
  const removed = servers.find((s) => s.id === id);
  servers = servers.filter((s) => s.id !== id);
  store.set('servers', servers);
  repositionStatsOverlay();
  if (removed) sendLog(`Removed server: ${serverLabel(removed)}`);
  return servers;
});

ipcMain.handle('test-server-connection', async (_e, server) => {
  try {
    await testConnection(server);
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

// Preview button: shows the overlay turning red for a fake server, and (if enabled) plays
// the beep + spoken warning too, so the user can test the full experience on demand.
ipcMain.handle('preview-high-usage', () => {
  const wasVisible = !!(statsOverlayWindow && !statsOverlayWindow.isDestroyed() && statsOverlayWindow.isVisible());
  const fakeServers = (store.get('servers') || []).length
    ? (store.get('servers') || []).map((s) => ({
        id: s.id,
        name: serverLabel(s),
        connected: true,
        ramPercent: 99,
        cpuPercent: 97,
        diskPercent: 91,
      }))
    : [{ id: 'preview', name: 'Preview Server', connected: true, ramPercent: 99, cpuPercent: 97, diskPercent: 91 }];

  showStatsOverlay();
  updateStatsOverlay(fakeServers);

  if (store.get('soundAlertsEnabled')) {
    lastSoundAlertAt = Date.now();
    sendSoundAlert({
      alerts: fakeServers.map((s) => ({
        name: s.name,
        ramHigh: true,
        cpuHigh: true,
        diskHigh: true,
        ramPercent: s.ramPercent,
        cpuPercent: s.cpuPercent,
        diskPercent: s.diskPercent,
      })),
    });
  }

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
