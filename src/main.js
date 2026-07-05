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
    overlayBackgroundColor: '#14161e', // customizable overlay background color
    overlayCustomPosition: null, // { x, y } once the user drags the overlay; null = default top-right anchor
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
let overlayMoveModeActive = false;
let lastStatusList = []; // last known per-server stats, so we can instantly re-render the overlay when display settings (like color) change

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
  const work = screen.getPrimaryDisplay().workArea;
  const custom = store.get('overlayCustomPosition');
  if (custom && typeof custom.x === 'number' && typeof custom.y === 'number') {
    // Clamp so a resolution change (or a drag that ended slightly off-screen) can't
    // strand the overlay somewhere unreachable.
    const x = Math.min(Math.max(custom.x, work.x), work.x + work.width - size.width);
    const y = Math.min(Math.max(custom.y, work.y), work.y + work.height - size.height);
    return { x, y };
  }
  return {
    x: work.x + work.width - size.width - OVERLAY_MARGIN,
    y: work.y + OVERLAY_MARGIN,
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
    movable: true,
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

  // Only persist a new position while the user explicitly enabled "Move Overlay" mode -
  // programmatic setBounds() calls (resize, reposition) also fire 'moved', and we don't
  // want those overwriting/creating a custom position on their own.
  statsOverlayWindow.on('moved', () => {
    if (!overlayMoveModeActive || !statsOverlayWindow || statsOverlayWindow.isDestroyed()) return;
    const bounds = statsOverlayWindow.getBounds();
    store.set('overlayCustomPosition', { x: bounds.x, y: bounds.y });
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
  lastStatusList = servers;
  if (!statsOverlayWindow || statsOverlayWindow.isDestroyed()) return;
  const payload = {
    servers,
    compact: store.get('compactLayout'),
    showCpu: store.get('showCpu'),
    showRam: store.get('showRam'),
    showDisk: store.get('showDisk'),
    bgColor: store.get('overlayBackgroundColor'),
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
      label: 'Exit',
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

      // Only alert on a metric if it's actually visible/enabled - a hidden metric
      // should never be able to trigger a sound alert.
      const ramHigh = store.get('showRam') && usage.ramPercent >= USAGE_RED_AT;
      const cpuHigh = store.get('showCpu') && usage.cpuPercent != null && usage.cpuPercent >= USAGE_RED_AT;
      const diskHigh = store.get('showDisk') && usage.diskPercent != null && usage.diskPercent >= USAGE_RED_AT;
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
  const prevBgColor = store.get('overlayBackgroundColor');
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
    'overlayBackgroundColor',
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

  if (settings.overlayBackgroundColor && settings.overlayBackgroundColor !== prevBgColor) {
    // Re-push the overlay's last known data immediately so the new color shows right away,
    // instead of waiting for the next poll cycle.
    updateStatsOverlay(lastStatusList);
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
  const pos = overlayPosition({ width, height: clampedHeight });
  statsOverlayWindow.setBounds({ x: pos.x, y: pos.y, width, height: clampedHeight });
});

// "Move Overlay" mode: while active, the overlay becomes draggable (and briefly focusable/
// interactable) instead of a pure click-through readout, so the user can drag it anywhere.
// Dragging is handled by a CSS -webkit-app-region:drag region in the overlay page itself.
ipcMain.handle('set-overlay-move-mode', (_e, enabled) => {
  overlayMoveModeActive = !!enabled;
  ensureStatsOverlayWindow();
  const wasVisible = statsOverlayWindow.isVisible();

  if (overlayMoveModeActive) {
    statsOverlayWindow.setFocusable(true);
    statsOverlayWindow.setIgnoreMouseEvents(false);
    if (!wasVisible) statsOverlayWindow.show();
  } else {
    statsOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
    statsOverlayWindow.setFocusable(false);
    if (!isMonitoring) hideStatsOverlay();
  }

  statsOverlayWindow.webContents.send('overlay-movable-changed', overlayMoveModeActive);
  return { enabled: overlayMoveModeActive };
});

ipcMain.handle('reset-overlay-position', () => {
  store.set('overlayCustomPosition', null);
  repositionStatsOverlay();
  return { ok: true };
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
// Each scenario produces different fake data so the user can see exactly how the
// overlay looks (colors) and sounds (beeps + speech) in every situation.
ipcMain.handle('preview-scenario', (_e, scenario) => {
  const wasVisible = !!(statsOverlayWindow && !statsOverlayWindow.isDestroyed() && statsOverlayWindow.isVisible());
  const showRam = store.get('showRam') !== false;
  const showCpu = store.get('showCpu') !== false;
  const showDisk = store.get('showDisk') !== false;

  const savedServers = store.get('servers') || [];
  const useRealNames = savedServers.length > 0;
  const realNames = useRealNames ? savedServers.map((s) => serverLabel(s)) : [];

  function srv(i, overrides) {
    const base = { id: `preview-${i}`, name: useRealNames ? realNames[i] || `Server ${i + 1}` : `Server ${i + 1}`, connected: true };
    return { ...base, ...overrides };
  }

  let fakeServers = [];
  let alerts = [];

  switch (scenario) {
    case 'critical':
      fakeServers = [srv(0, { ramPercent: 99, cpuPercent: 97, diskPercent: 95 })];
      alerts = [{ name: fakeServers[0].name, ramHigh: showRam, cpuHigh: showCpu, diskHigh: showDisk, ramPercent: 99, cpuPercent: 97, diskPercent: 95 }];
      break;
    case 'warning':
      fakeServers = [srv(0, { ramPercent: 72, cpuPercent: 65, diskPercent: 68 })];
      // Yellow zone (60-84%) — no audio alert, just visual color change
      alerts = [];
      break;
    case 'healthy':
      fakeServers = [srv(0, { ramPercent: 15, cpuPercent: 10, diskPercent: 22 })];
      alerts = [];
      break;
    case 'offline':
      fakeServers = [srv(0, { connected: false, error: 'Connection timed out (22s)' })];
      alerts = [];
      break;
    case 'mixed':
      fakeServers = [
        srv(0, { ramPercent: 18, cpuPercent: 12, diskPercent: 30 }),
        srv(1, { ramPercent: 99, cpuPercent: 96, diskPercent: 88 }),
        srv(2, { connected: false, error: 'ECONNREFUSED' }),
      ];
      alerts = [{ name: fakeServers[1].name, ramHigh: showRam, cpuHigh: showCpu, diskHigh: showDisk, ramPercent: 99, cpuPercent: 96, diskPercent: 88 }];
      break;
    case 'ram-only':
      fakeServers = [srv(0, { ramPercent: 99, cpuPercent: 15, diskPercent: 22 })];
      alerts = [{ name: fakeServers[0].name, ramHigh: showRam, cpuHigh: false, diskHigh: false, ramPercent: 99, cpuPercent: 15, diskPercent: 22 }];
      break;
    case 'cpu-only':
      fakeServers = [srv(0, { ramPercent: 20, cpuPercent: 98, diskPercent: 30 })];
      alerts = [{ name: fakeServers[0].name, ramHigh: false, cpuHigh: showCpu, diskHigh: false, ramPercent: 20, cpuPercent: 98, diskPercent: 30 }];
      break;
    case 'disk-only':
      fakeServers = [srv(0, { ramPercent: 25, cpuPercent: 18, diskPercent: 97 })];
      alerts = [{ name: fakeServers[0].name, ramHigh: false, cpuHigh: false, diskHigh: showDisk, ramPercent: 25, cpuPercent: 18, diskPercent: 97 }];
      break;
    default:
      fakeServers = [srv(0, { ramPercent: 99, cpuPercent: 97, diskPercent: 91 })];
      alerts = [{ name: fakeServers[0].name, ramHigh: showRam, cpuHigh: showCpu, diskHigh: showDisk, ramPercent: 99, cpuPercent: 97, diskPercent: 91 }];
  }

  showStatsOverlay();
  updateStatsOverlay(fakeServers);

  // Only fire sound alerts when there are actual high-usage alerts AND sound is enabled.
  if (alerts.length > 0 && store.get('soundAlertsEnabled')) {
    lastSoundAlertAt = Date.now();
    sendSoundAlert({ alerts });
  }

  // Restore real data after 6 seconds.
  setTimeout(() => {
    if (isMonitoring) {
      pollOnce();
    } else if (!wasVisible) {
      hideStatsOverlay();
    }
  }, 6000);
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
