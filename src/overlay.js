const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');

// --- Audible alarm (siren) using Web Audio API, no external sound files needed ---
let audioCtx = null;
let oscillator = null;
let sirenTimer = null;

function startAlarmSound() {
  stopAlarmSound();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.15;
  oscillator.type = 'sine';
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start();

  let high = true;
  sirenTimer = setInterval(() => {
    oscillator.frequency.setValueAtTime(high ? 880 : 660, audioCtx.currentTime);
    high = !high;
  }, 350);
}

function stopAlarmSound() {
  if (sirenTimer) clearInterval(sirenTimer);
  sirenTimer = null;
  if (oscillator) {
    try { oscillator.stop(); } catch (e) {}
    oscillator = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
}

window.overlayApi.onAlert((data) => {
  const pct = data.usedPercent != null ? data.usedPercent : '??';
  titleEl.textContent = data.test ? 'TEST ALERT: WARNING RAM USAGE HIGH' : 'WARNING: VPS RAM USAGE HIGH';
  subtitleEl.textContent = `${data.host || 'VPS'} is at ${pct}% RAM usage${data.test ? ' (this is a test)' : ''}.`;
  startAlarmSound();
});

document.getElementById('dismissBtn').addEventListener('click', () => {
  stopAlarmSound();
  window.overlayApi.dismiss();
});

document.getElementById('snoozeBtn').addEventListener('click', () => {
  stopAlarmSound();
  window.overlayApi.snooze(10);
});
