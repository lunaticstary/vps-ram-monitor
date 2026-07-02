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
  pollIntervalSec: document.getElementById('pollIntervalSec'),
  launchOnStartup: document.getElementById('launchOnStartup'),
  showLiveUsageBar: document.getElementById('showLiveUsageBar'),
  showDesktopOverlay: document.getElementById('showDesktopOverlay'),
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

// Usage color thresholds - shared conceptually with the desktop overlay widget.
const USAGE_YELLOW_AT = 60;
const USAGE_RED_AT = 85;

function usageColorClass(percent) {
  if (percent == null || Number.isNaN(percent)) return null;
  if (percent >= USAGE_RED_AT) return 'red';
  if (percent >= USAGE_YELLOW_AT) return 'yellow';
  return 'green';
}

function setPill(pillEl, valueEl, percent) {
  pillEl.classList.remove('usage-green', 'usage-yellow', 'usage-red');
  if (percent == null || Number.isNaN(percent)) {
    valueEl.textContent = '--%';
    return;
  }
  valueEl.textContent = `${percent}%`;
  const cls = usageColorClass(percent);
  if (cls) pillEl.classList.add(`usage-${cls}`);
}

function setStatusDotColor(percent) {
  const cls = usageColorClass(percent);
  els.statusDot.className = `dot dot-${cls || 'on'}`;
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
    pollIntervalSec: Number(els.pollIntervalSec.value) || 15,
    launchOnStartup: els.launchOnStartup.checked,
    showLiveUsageBar: els.showLiveUsageBar.checked,
    showDesktopOverlay: els.showDesktopOverlay.checked,
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
  els.pollIntervalSec.value = s.pollIntervalSec || 15;
  els.launchOnStartup.checked = !!s.launchOnStartup;
  els.showLiveUsageBar.checked = s.showLiveUsageBar !== false;
  els.showDesktopOverlay.checked = s.showDesktopOverlay !== false;
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

// Only previews the overlay's color at a simulated high reading - no popup/sound involved.
els.testAlertBtn.addEventListener('click', () => {
  window.api.previewHighUsage();
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
    els.statusDot.className = 'dot dot-off';
    els.statusText.textContent = 'Connection error';
  }
  if (typeof status.usedPercent === 'number') {
    els.ramInfo.textContent = `RAM: ${status.usedPercent}% used (${status.usedMB}MB / ${status.totalMB}MB)`;
    setPill(els.ramPill, els.ramValue, status.usedPercent);
    setStatusDotColor(status.usedPercent);
    els.statusText.textContent = 'Monitoring...';
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
