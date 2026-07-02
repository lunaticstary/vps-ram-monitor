const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  testConnection: (settings) => ipcRenderer.invoke('test-connection', settings),
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  triggerTestAlert: () => ipcRenderer.invoke('trigger-test-alert'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_e, data) => callback(data)),
  onLog: (callback) => ipcRenderer.on('log-line', (_e, line) => callback(line)),
});

contextBridge.exposeInMainWorld('overlayApi', {
  onAlert: (callback) => ipcRenderer.on('overlay-data', (_e, data) => callback(data)),
  dismiss: () => ipcRenderer.send('overlay-dismiss'),
  snooze: (minutes) => ipcRenderer.send('overlay-snooze', minutes),
});
