const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  testConnection: (settings) => ipcRenderer.invoke('test-connection', settings),
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  previewHighUsage: () => ipcRenderer.invoke('preview-high-usage'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_e, data) => callback(data)),
  onLog: (callback) => ipcRenderer.on('log-line', (_e, line) => callback(line)),
  onSoundAlert: (callback) => ipcRenderer.on('sound-alert', (_e, data) => callback(data)),
});

// Exposed to the small always-on-top desktop overlay window only.
// It only ever receives numbers to display - no alert/warning payloads.
contextBridge.exposeInMainWorld('statsOverlayApi', {
  onData: (callback) => ipcRenderer.on('stats-overlay-data', (_e, data) => callback(data)),
});
