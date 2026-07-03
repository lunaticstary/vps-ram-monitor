// Same color thresholds used in the dashboard - kept in sync intentionally.
const USAGE_YELLOW_AT = 60;
const USAGE_RED_AT = 85;

const root = document.getElementById('root');

function colorClass(percent) {
  if (percent == null || Number.isNaN(percent)) return null;
  if (percent >= USAGE_RED_AT) return 'usage-red';
  if (percent >= USAGE_YELLOW_AT) return 'usage-yellow';
  return 'usage-green';
}

function pillHtml(label, percent) {
  const cls = colorClass(percent);
  const valueText = percent == null || Number.isNaN(percent) ? '--%' : `${percent}%`;
  return `
    <div class="pill ${cls || ''}">
      <span class="label">${label}</span>
      <span class="value">${valueText}</span>
    </div>
  `;
}

// Converts a "#rrggbb" hex color into an "rgba(r, g, b, alpha)" string for the row background.
function hexToRgba(hex, alpha) {
  if (typeof hex !== 'string') return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Measures the actual rendered content height and tells main to resize the window to
// match exactly, so the last row never gets clipped regardless of how many servers or
// how long their names are.
function reportRealSize() {
  requestAnimationFrame(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (window.statsOverlayApi && height > 0) {
      window.statsOverlayApi.reportSize(height);
    }
  });
}

// No warning text, no popups, no sounds here - purely a live color-coded readout per server.
window.statsOverlayApi.onData((data) => {
  document.body.classList.toggle('compact', !!data.compact);

  const rgba = hexToRgba(data.bgColor, 0.55);
  if (rgba) document.documentElement.style.setProperty('--overlay-bg', rgba);

  const servers = data.servers || [];

  if (servers.length === 0) {
    root.innerHTML = `
      <div class="server-row">
        <div class="server-name">No servers configured</div>
      </div>
    `;
    reportRealSize();
    return;
  }

  root.innerHTML = servers
    .map((s) => {
      const pills = [];
      if (data.showCpu !== false) pills.push(pillHtml('CPU', s.cpuPercent));
      if (data.showRam !== false) pills.push(pillHtml('RAM', s.ramPercent));
      if (data.showDisk !== false) pills.push(pillHtml('DISK', s.diskPercent));
      const nameClass = s.connected === false ? 'server-name offline' : 'server-name';
      const nameText = s.connected === false ? `${s.name} (offline)` : s.name;
      return `
        <div class="server-row">
          <div class="${nameClass}" title="${nameText}">${nameText}</div>
          <div class="pills">${pills.join('')}</div>
        </div>
      `;
    })
    .join('');

  reportRealSize();
});

// Toggled by the dashboard's "Move Overlay" button - lets the user drag this widget
// anywhere on screen via the CSS drag region defined in stats-overlay.html.
window.statsOverlayApi.onMovableChanged((enabled) => {
  document.body.classList.toggle('draggable', !!enabled);
});

window.addEventListener('resize', reportRealSize);
