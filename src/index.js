const els = {
  host: document.getElementById('host'),
  port: document.getElementById('port'),
  username: document.getElementById('username'),
  authType: document.getElementById('authType'),
  password: document.getElementById('password'),
  privateKey: document.getElementById('privateKey'),
  passphrase: document.getElementById('passphrase'),
  passwordField: document.getElementById('passwordField'),
  keyField: document.getElementById('keyField'),
  thresholdPercent: document.getElementById('thresholdPercent'),
  pollIntervalSec: document.getElementById('pollIntervalSec'),
  launchOnStartup: document.getElementById('launchOnStartup'),
  saveBtn: document.getElementById('saveBtn'),
  testAlertBtn: document.getElementById('testAlertBtn'),
  testConnBtn: document.getElementById('testConnBtn'),
  testConnResult: document.getElementById('testConnResult'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  ramInfo: document.getElementById('ramInfo'),
  log: document.getElementById('log'),
};

function collectFormSettings() {
  return {
    host: els.host.value.trim(),
    port: Number(els.port.value) || 22,
    username: els.username.value.trim(),
    authType: els.authType.value,
    password: els.password.value,
    privateKey: els.privateKey.value,
    passphrase: els.passphrase.value,
    thresholdPercent: Number(els.thresholdPercent.value) || 99,
    pollIntervalSec: Number(els.pollIntervalSec.value) || 15,
    launchOnStartup: els.launchOnStartup.checked,
  };
}

function applySettingsToForm(s) {
  els.host.value = s.host || '';
  els.port.value = s.port || 22;
  els.username.value = s.username || '';
  els.authType.value = s.authType || 'password';
  els.password.value = s.password || '';
  els.privateKey.value = s.privateKey || '';
  els.passphrase.value = s.passphrase || '';
  els.thresholdPercent.value = s.thresholdPercent || 99;
  els.pollIntervalSec.value = s.pollIntervalSec || 15;
  els.launchOnStartup.checked = !!s.launchOnStartup;
  toggleAuthFields();
}

function toggleAuthFields() {
  const isKey = els.authType.value === 'key';
  els.keyField.classList.toggle('hidden', !isKey);
  els.passwordField.classList.toggle('hidden', isKey);
}

els.authType.addEventListener('change', toggleAuthFields);

els.saveBtn.addEventListener('click', async () => {
  const settings = collectFormSettings();
  await window.api.saveSettings(settings);
});

els.testConnBtn.addEventListener('click', async () => {
  els.testConnResult.textContent = 'Testing...';
  els.testConnResult.style.color = '#9aa0ac';
  const settings = collectFormSettings();
  const result = await window.api.testConnection(settings);
  if (result.ok) {
    els.testConnResult.textContent = '✓ Connected successfully';
    els.testConnResult.style.color = '#22c55e';
  } else {
    els.testConnResult.textContent = '✗ ' + result.error;
    els.testConnResult.style.color = '#e5484d';
  }
});

els.testAlertBtn.addEventListener('click', () => {
  window.api.triggerTestAlert();
});

els.startBtn.addEventListener('click', async () => {
  await window.api.saveSettings(collectFormSettings());
  await window.api.startMonitoring();
});

els.stopBtn.addEventListener('click', async () => {
  await window.api.stopMonitoring();
});

window.api.onStatusUpdate((status) => {
  if (status.monitoring === true) {
    els.statusDot.className = 'dot dot-on';
    els.statusText.textContent = 'Monitoring...';
  } else if (status.monitoring === false) {
    els.statusDot.className = 'dot dot-off';
    els.statusText.textContent = 'Not monitoring';
  }
  if (status.connected === false) {
    els.statusDot.className = 'dot dot-alert';
    els.statusText.textContent = 'Connection error';
  }
  if (typeof status.usedPercent === 'number') {
    els.ramInfo.textContent = `RAM: ${status.usedPercent}% used (${status.usedMB}MB / ${status.totalMB}MB)`;
    if (status.usedPercent >= Number(els.thresholdPercent.value)) {
      els.statusDot.className = 'dot dot-alert';
      els.statusText.textContent = 'HIGH RAM USAGE!';
    }
  }
});

window.api.onLog((line) => {
  els.log.textContent += line + '\n';
  els.log.scrollTop = els.log.scrollHeight;
});

(async () => {
  const settings = await window.api.getSettings();
  applySettingsToForm(settings);
})();
