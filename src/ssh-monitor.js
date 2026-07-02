const { Client } = require('ssh2');

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

module.exports = { fetchRamUsage, testConnection, parseMemInfo };
