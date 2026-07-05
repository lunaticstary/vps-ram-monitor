const els = {
  serverList: document.getElementById('serverList'),
  newName: document.getElementById('newName'),
  newHost: document.getElementById('newHost'),
  newPort: document.getElementById('newPort'),
  newUsername: document.getElementById('newUsername'),
  newAuthType: document.getElementById('newAuthType'),
  newPassword: document.getElementById('newPassword'),
  newPrivateKey: document.getElementById('newPrivateKey'),
  newPassphrase: document.getElementById('newPassphrase'),
  newPasswordField: document.getElementById('newPasswordField'),
  newKeyField: document.getElementById('newKeyField'),
  testNewBtn: document.getElementById('testNewBtn'),
  addServerBtn: document.getElementById('addServerBtn'),
  newServerResult: document.getElementById('newServerResult'),

  pollIntervalSec: document.getElementById('pollIntervalSec'),
  launchOnStartup: document.getElementById('launchOnStartup'),
  showLiveUsageBar: document.getElementById('showLiveUsageBar'),
  showDesktopOverlay: document.getElementById('showDesktopOverlay'),
  compactLayout: document.getElementById('compactLayout'),
  soundAlertsEnabled: document.getElementById('soundAlertsEnabled'),
  showCpu: document.getElementById('showCpu'),
  showRam: document.getElementById('showRam'),
  showDisk: document.getElementById('showDisk'),
  overlayBgColor: document.getElementById('overlayBgColor'),
  moveOverlayBtn: document.getElementById('moveOverlayBtn'),
  resetOverlayPosBtn: document.getElementById('resetOverlayPosBtn'),

  saveBtn: document.getElementById('saveBtn'),
  testAlertBtn: document.getElementById('testAlertBtn'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  log: document.getElementById('log'),
  liveStatusCard: document.getElementById('liveStatusCard'),
  liveStatusList: document.getElementById('liveStatusList'),
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

function pillHtml(label, percent, visible) {
  if (!visible) return '';
  const cls = usageColorClass(percent);
  const valueText = percent == null || Number.isNaN(percent) ? '--%' : `${percent}%`;
  return `
    <div class="live-pill ${cls ? `usage-${cls}` : ''}">
      <span class="dot-mini"></span>
      <span class="label">${label}</span>
      <span class="value">${valueText}</span>
    </div>
  `;
}

function overallStatusColorClass(servers) {
  const percents = [];
  servers.forEach((s) => {
    if (typeof s.ramPercent === 'number') percents.push(s.ramPercent);
    if (typeof s.cpuPercent === 'number') percents.push(s.cpuPercent);
    if (typeof s.diskPercent === 'number') percents.push(s.diskPercent);
  });
  if (percents.length === 0) return null;
  return usageColorClass(Math.max(...percents));
}

// ---- Server list (add/remove/test) ----
let currentServers = [];

function toggleNewAuthFields() {
  const isKey = els.newAuthType.value === 'key';
  els.newKeyField.classList.toggle('hidden', !isKey);
  els.newPasswordField.classList.toggle('hidden', isKey);
}
els.newAuthType.addEventListener('change', toggleNewAuthFields);
toggleNewAuthFields();

function collectNewServerForm() {
  return {
    name: els.newName.value.trim(),
    host: els.newHost.value.trim(),
    port: Number(els.newPort.value) || 22,
    username: els.newUsername.value.trim(),
    authType: els.newAuthType.value,
    password: els.newPassword.value,
    privateKey: els.newPrivateKey.value,
    passphrase: els.newPassphrase.value,
  };
}

function clearNewServerForm() {
  els.newName.value = '';
  els.newHost.value = '';
  els.newPort.value = 22;
  els.newUsername.value = '';
  els.newAuthType.value = 'password';
  els.newPassword.value = '';
  els.newPrivateKey.value = '';
  els.newPassphrase.value = '';
  toggleNewAuthFields();
}

function renderServerList() {
  if (currentServers.length === 0) {
    els.serverList.innerHTML = '<p class="hint">No servers added yet — add one below.</p>';
    return;
  }
  els.serverList.innerHTML = currentServers
    .map(
      (s) => `
      <div class="server-item" data-id="${s.id}">
        <div class="server-item-info">
          <div class="server-item-name">${s.name || s.host}</div>
          <div class="server-item-sub">${s.username}@${s.host}:${s.port}</div>
        </div>
        <div class="server-item-actions">
          <button class="secondary small test-server-btn" data-id="${s.id}">Test</button>
          <button class="destructive small remove-server-btn" data-id="${s.id}">Remove</button>
        </div>
      </div>
    `
    )
    .join('');

  els.serverList.querySelectorAll('.test-server-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const server = currentServers.find((s) => s.id === btn.dataset.id);
      btn.textContent = 'Testing...';
      const result = await window.api.testServerConnection(server);
      btn.textContent = result.ok ? '✓ OK' : '✗ Failed';
      setTimeout(() => (btn.textContent = 'Test'), 2500);
    });
  });

  els.serverList.querySelectorAll('.remove-server-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      currentServers = await window.api.removeServer(btn.dataset.id);
      renderServerList();
    });
  });
}

els.testNewBtn.addEventListener('click', async () => {
  els.newServerResult.textContent = 'Testing...';
  els.newServerResult.style.color = '#9aa0ac';
  const result = await window.api.testServerConnection(collectNewServerForm());
  if (result.ok) {
    els.newServerResult.textContent = '✓ Connected successfully';
    els.newServerResult.style.color = '#22c55e';
  } else {
    els.newServerResult.textContent = '✗ ' + result.error;
    els.newServerResult.style.color = '#e5484d';
  }
});

els.addServerBtn.addEventListener('click', async () => {
  const server = collectNewServerForm();
  if (!server.host || !server.username) {
    els.newServerResult.textContent = 'Host and username are required.';
    els.newServerResult.style.color = '#e5484d';
    return;
  }
  currentServers = await window.api.addServer(server);
  clearNewServerForm();
  els.newServerResult.textContent = '';
  renderServerList();
});

// ---- Global settings ----
function collectFormSettings() {
  return {
    pollIntervalSec: Number(els.pollIntervalSec.value) || 15,
    launchOnStartup: els.launchOnStartup.checked,
    showLiveUsageBar: els.showLiveUsageBar.checked,
    showDesktopOverlay: els.showDesktopOverlay.checked,
    compactLayout: els.compactLayout.checked,
    soundAlertsEnabled: els.soundAlertsEnabled.checked,
    showCpu: els.showCpu.checked,
    showRam: els.showRam.checked,
    showDisk: els.showDisk.checked,
    overlayBackgroundColor: els.overlayBgColor.value,
  };
}

function applySettingsToForm(s) {
  els.pollIntervalSec.value = s.pollIntervalSec || 15;
  els.launchOnStartup.checked = !!s.launchOnStartup;
  els.showLiveUsageBar.checked = s.showLiveUsageBar !== false;
  els.showDesktopOverlay.checked = s.showDesktopOverlay !== false;
  els.compactLayout.checked = !!s.compactLayout;
  els.soundAlertsEnabled.checked = s.soundAlertsEnabled !== false;
  els.showCpu.checked = s.showCpu !== false;
  els.showRam.checked = s.showRam !== false;
  els.showDisk.checked = s.showDisk !== false;
  els.overlayBgColor.value = s.overlayBackgroundColor || '#14161e';
  applyDisplayPrefs();
}

function applyDisplayPrefs() {
  els.liveStatusCard.classList.toggle('hidden', !els.showLiveUsageBar.checked);
  document.body.classList.toggle('compact', els.compactLayout.checked);
}

els.showLiveUsageBar.addEventListener('change', applyDisplayPrefs);
els.compactLayout.addEventListener('change', applyDisplayPrefs);

els.overlayBgColor.addEventListener('input', async () => {
  await window.api.saveSettings(collectFormSettings());
});

let overlayMoveModeOn = false;
els.moveOverlayBtn.addEventListener('click', async () => {
  overlayMoveModeOn = !overlayMoveModeOn;
  await window.api.setOverlayMoveMode(overlayMoveModeOn);
  els.moveOverlayBtn.textContent = overlayMoveModeOn ? '🔒 Lock Position' : '📍 Move Overlay';
  els.moveOverlayBtn.classList.toggle('active', overlayMoveModeOn);
});

els.resetOverlayPosBtn.addEventListener('click', async () => {
  await window.api.resetOverlayPosition();
});

els.saveBtn.addEventListener('click', async () => {
  await window.api.saveSettings(collectFormSettings());
  applyDisplayPrefs();
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

  if (Array.isArray(status.servers)) {
    if (status.servers.length === 0) {
      els.liveStatusList.innerHTML = '<p class="hint">No servers configured yet.</p>';
    } else {
      const showCpu = els.showCpu.checked;
      const showRam = els.showRam.checked;
      const showDisk = els.showDisk.checked;
      els.liveStatusList.innerHTML = status.servers
        .map((s) => {
          if (s.connected === false) {
            return `
              <div class="live-status-row live-status-down">
                <div class="live-status-name offline">
                  <span class="down-dot-dashboard"></span>${s.name} — OFFLINE
                </div>
                <div class="live-status-error">${s.error || 'connection error'}</div>
              </div>
            `;
          }
          const pills = [
            pillHtml('CPU', s.cpuPercent, showCpu),
            pillHtml('RAM', s.ramPercent, showRam),
            pillHtml('DISK', s.diskPercent, showDisk),
          ].join('');
          return `
            <div class="live-status-row">
              <div class="live-status-name">${s.name}</div>
              <div class="live-status-pills">${pills}</div>
            </div>
          `;
        })
        .join('');
    }

    const cls = overallStatusColorClass(status.servers.filter((s) => s.connected !== false));
    const anyError = status.servers.some((s) => s.connected === false);
    if (anyError) {
      els.statusDot.className = 'dot dot-off';
      els.statusText.textContent = 'One or more servers unreachable';
    } else if (cls) {
      els.statusDot.className = `dot dot-${cls}`;
      els.statusText.textContent = 'Monitoring...';
    }
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

function describeAlert(a) {
  const parts = [];
  if (a.ramHigh) parts.push(`RAM at ${Math.round(a.ramPercent)} percent`);
  if (a.cpuHigh) parts.push(`CPU at ${Math.round(a.cpuPercent)} percent`);
  if (a.diskHigh) parts.push(`Disk at ${Math.round(a.diskPercent)} percent`);
  return `${a.name}: ${parts.join(', ')}.`;
}

window.api.onSoundAlert((data) => {
  if (!els.soundAlertsEnabled.checked) return;
  const alerts = data.alerts || [];
  if (alerts.length === 0) return;
  const beepsDurationSec = beep(4);
  const text = `Warning. ${alerts.map(describeAlert).join(' ')}`;
  setTimeout(() => speak(text), beepsDurationSec * 1000 + 150);
});

(async () => {
  const settings = await window.api.getSettings();
  applySettingsToForm(settings);
  currentServers = await window.api.getServers();
  renderServerList();
})();
