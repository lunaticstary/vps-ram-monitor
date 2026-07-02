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
  showLiveUsageBar: document.getElementById('showLiveUsageBar'),
  compactLayout: document.getElementById('compactLayout'),
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
  liveUsageBar: document.getElementById('liveUsageBar'),
  cpuPill: document.getElementById('cpuPill'),
  ramPill: document.getElementById('ramPill'),
  cpuValue: document.getElementById('cpuValue'),
  ramValue: document.getElementById('ramValue'),
};

// Usage color thresholds for the live bar (independent of the RAM alert threshold)
const USAGE_YELLOW_AT = 60;
const USAGE_RED_AT = 85;

function usageColorClass(percent) {
  if (percent == null || Number.isNaN(percent)) return null;
  if (percent >= USAGE_RED_AT) return 'usage-red';
  if (percent >= USAGE_YELLOW_AT) return 'usage-yellow';
  return 'usage-green';
}

function setPill(pillEl, valueEl, percent) {
  pillEl.classList.remove('usage-green', 'usage-yellow', 'usage-red');
  if (percent == null || Number.isNaN(percent)) {
    valueEl.textContent = '--%';
    return;
  }
  valueEl.textContent = `${percent}%`;
  const cls = usageColorClass(percent);
  if (cls) pillEl.classList.add(cls);
}

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
    showLiveUsageBar: els.showLiveUsageBar.checked,
    compactLayout: els.compactLayout.checked,
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
  els.showLiveUsageBar.checked = s.showLiveUsageBar !== false;
  els.compactLayout.checked = !!s.compactLayout;
  toggleAuthFields();
  applyDisplayPrefs();
}

function toggleAuthFields() {
  const isKey = els.authType.value === 'key';
  els.keyField.classList.toggle('hidden', !isKey);
  els.passwordField.classList.toggle('hidden', isKey);
}

function applyDisplayPrefs() {
  els.liveUsageBar.classList.toggle('hidden', !els.showLiveUsageBar.checked);
  document.body.classList.toggle('compact', els.compactLayout.checked);
}

els.authType.addEventListener('change', toggleAuthFields);
els.showLiveUsageBar.addEventListener('change', applyDisplayPrefs);
els.compactLayout.addEventListener('change', applyDisplayPrefs);

els.saveBtn.addEventListener('click', async () => {
  const settings = collectFormSettings();
  await window.api.saveSettings(settings);
  applyDisplayPrefs();
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
    setPill(els.ramPill, els.ramValue, status.usedPercent);
    if (status.usedPercent >= Number(els.thresholdPercent.value)) {
      els.statusDot.className = 'dot dot-alert';
      els.statusText.textContent = 'HIGH RAM USAGE!';
    }
  }
  if (typeof status.cpuPercent === 'number') {
    setPill(els.cpuPill, els.cpuValue, status.cpuPercent);
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
