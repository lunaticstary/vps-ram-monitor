const { Client } = require('ssh2');

const CPU_MARKER_1 = '__CPU_SAMPLE_1__';
const CPU_MARKER_2 = '__CPU_SAMPLE_2__';

/**
 * Connects to a VPS over SSH and reads current RAM usage using /proc/meminfo.
 * Returns a promise resolving to { usedPercent, totalMB, usedMB, availableMB }
 */
function fetchRamUsage(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connection timed out'));
    }, 15000);

    conn
      .on('ready', () => {
        conn.exec('cat /proc/meminfo', (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            return reject(err);
          }
          let data = '';
          stream
            .on('close', () => {
              clearTimeout(timeout);
              conn.end();
              try {
                resolve(parseMemInfo(data));
              } catch (parseErr) {
                reject(parseErr);
              }
            })
            .on('data', (chunk) => {
              data += chunk.toString();
            })
            .stderr.on('data', () => {
              // ignore stderr noise
            });
        });
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .connect(buildConnectOptions(config));
  });
}

/**
 * Connects once and reads BOTH RAM (via /proc/meminfo) and CPU usage
 * (via two /proc/stat samples 1s apart) in a single SSH session.
 * Returns a promise resolving to:
 *   { ramPercent, ramTotalMB, ramUsedMB, ramAvailableMB, cpuPercent }
 */
function fetchSystemUsage(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connection timed out'));
    }, 15000);

    const cmd = [
      'cat /proc/meminfo',
      `echo ${CPU_MARKER_1}`,
      "grep '^cpu ' /proc/stat",
      'sleep 1',
      `echo ${CPU_MARKER_2}`,
      "grep '^cpu ' /proc/stat",
    ].join(' && ');

    conn
      .on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            return reject(err);
          }
          let data = '';
          stream
            .on('close', () => {
              clearTimeout(timeout);
              conn.end();
              try {
                resolve(parseSystemUsage(data));
              } catch (parseErr) {
                reject(parseErr);
              }
            })
            .on('data', (chunk) => {
              data += chunk.toString();
            })
            .stderr.on('data', () => {
              // ignore stderr noise
            });
        });
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .connect(buildConnectOptions(config));
  });
}

function buildConnectOptions(config) {
  const opts = {
    host: config.host,
    port: Number(config.port) || 22,
    username: config.username,
    readyTimeout: 12000,
  };
  if (config.authType === 'key') {
    opts.privateKey = config.privateKey;
    if (config.passphrase) opts.passphrase = config.passphrase;
  } else {
    opts.password = config.password;
  }
  return opts;
}

function parseMemInfo(raw) {
  const lines = raw.split('\n');
  const map = {};
  for (const line of lines) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (match) {
      map[match[1]] = parseInt(match[2], 10);
    }
  }

  const totalKB = map.MemTotal;
  if (!totalKB) {
    throw new Error('Could not parse /proc/meminfo output from VPS');
  }

  // Prefer MemAvailable (accounts for reclaimable cache) when present,
  // fall back to Free+Buffers+Cached for older kernels.
  let availableKB = map.MemAvailable;
  if (availableKB === undefined) {
    availableKB = (map.MemFree || 0) + (map.Buffers || 0) + (map.Cached || 0);
  }

  const usedKB = totalKB - availableKB;
  const usedPercent = (usedKB / totalKB) * 100;

  return {
    usedPercent: Math.round(usedPercent * 10) / 10,
    totalMB: Math.round(totalKB / 1024),
    usedMB: Math.round(usedKB / 1024),
    availableMB: Math.round(availableKB / 1024),
  };
}

/**
 * Parses a "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
 * line from /proc/stat into { idle, total }.
 */
function parseCpuStatLine(line) {
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts;
  const idleTotal = idle + iowait;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { idle: idleTotal, total };
}

function parseSystemUsage(raw) {
  const memPart = raw.split(CPU_MARKER_1)[0];
  const memInfo = parseMemInfo(memPart);

  const afterMarker1 = raw.split(CPU_MARKER_1)[1] || '';
  const cpuSample1Raw = afterMarker1.split(CPU_MARKER_2)[0];
  const cpuSample2Raw = afterMarker1.split(CPU_MARKER_2)[1] || '';

  const cpuLine1 = (cpuSample1Raw.match(/^cpu\s+.*/m) || [])[0];
  const cpuLine2 = (cpuSample2Raw.match(/^cpu\s+.*/m) || [])[0];

  let cpuPercent = null;
  if (cpuLine1 && cpuLine2) {
    const sample1 = parseCpuStatLine(cpuLine1);
    const sample2 = parseCpuStatLine(cpuLine2);
    const totalDelta = sample2.total - sample1.total;
    const idleDelta = sample2.idle - sample1.idle;
    if (totalDelta > 0) {
      cpuPercent = Math.round(((1 - idleDelta / totalDelta) * 100) * 10) / 10;
      cpuPercent = Math.max(0, Math.min(100, cpuPercent));
    }
  }

  return {
    ramPercent: memInfo.usedPercent,
    ramTotalMB: memInfo.totalMB,
    ramUsedMB: memInfo.usedMB,
    ramAvailableMB: memInfo.availableMB,
    cpuPercent,
  };
}

/**
 * Simple connectivity test - connects, runs `echo ok`, disconnects.
 */
function testConnection(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('Connection timed out'));
    }, 15000);

    conn
      .on('ready', () => {
        clearTimeout(timeout);
        conn.end();
        resolve(true);
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .connect(buildConnectOptions(config));
  });
}

module.exports = { fetchRamUsage, fetchSystemUsage, testConnection, parseMemInfo, parseCpuStatLine, parseSystemUsage };
