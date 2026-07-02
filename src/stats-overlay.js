// Same color thresholds used in the dashboard's in-app bar - kept in sync intentionally.
const USAGE_YELLOW_AT = 60;
const USAGE_RED_AT = 85;

const cpuPill = document.getElementById('cpuPill');
const ramPill = document.getElementById('ramPill');
const cpuValue = document.getElementById('cpuValue');
const ramValue = document.getElementById('ramValue');

function colorClass(percent) {
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
  const cls = colorClass(percent);
  if (cls) pillEl.classList.add(cls);
}

// No warning text, no popups, no sounds here - purely a live color-coded readout.
window.statsOverlayApi.onData((data) => {
  document.body.classList.toggle('compact', !!data.compact);
  setPill(cpuPill, cpuValue, data.cpuPercent);
  setPill(ramPill, ramValue, data.ramPercent);
});
