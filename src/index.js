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
  soundAlertsEnabled: document.getElementById('soundAlertsEnabled'),
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
    soundAlertsEnabled: els.soundAlertsEnabled.checked,
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
  els.soundAlertsEnabled.checked = s.soundAlertsEnabled !== false;
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

// Previews the overlay turning red AND (if sound alerts are on) the beep + spoken warning.
els.testAlertBtn.addEventListener('click', () => {
  // A user click right before this is exactly the gesture Chromium's autoplay
  // policy wants, so audio/speech reliably works when triggered from here.
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

// ---- Sound & voice alerts (beeps + spoken warning) ----
// This is the ONLY thing that makes noise. It is fully separate from the overlay's
// color and from Narrow Mode - it only fires when the "Sound & Voice Alerts" toggle is on.
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function beep(count = 4, freq = 880, duration = 0.12, gap = 0.12) {
  const ctx = ensureAudioCtx();
  let t = ctx.currentTime;
  for (let i = 0; i < count; i++) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    t += duration + gap;
  }
  return count * (duration + gap);
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;
  window.speechSynthesis.speak(utter);
}

window.api.onSoundAlert((data) => {
  if (!els.soundAlertsEnabled.checked) return;
  const beepsDurationSec = beep(4);
  let text;
  if (data.ramHigh && data.cpuHigh) {
    text = `Warning. RAM usage is ${Math.round(data.ramPercent)} percent and CPU usage is ${Math.round(data.cpuPercent)} percent.`;
  } else if (data.ramHigh) {
    text = `Warning. RAM usage is ${Math.round(data.ramPercent)} percent.`;
  } else {
    text = `Warning. CPU usage is ${Math.round(data.cpuPercent)} percent.`;
  }
  setTimeout(() => speak(text), beepsDurationSec * 1000 + 150);
});

(async () => {
  const settings = await window.api.getSettings();
  applySettingsToForm(settings);
})();
