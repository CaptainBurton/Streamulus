// Runtime (seconds) of movies and episodes, read from the files with ffprobe
// and stored in the duration column. Used for "Ends at" times and progress bars.
const { spawn } = require('child_process');
const fs = require('fs');
const db = require('../database/db');
const { resolveFilePath } = require('./path-repair');

const TABLES = ['movies', 'episodes'];

function probeDuration(filePath) {
  return new Promise((resolve) => {
    let out = '';
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 20000);
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('exit', () => {
      clearTimeout(timer);
      const secs = parseFloat(out);
      resolve(secs > 0 ? Math.round(secs) : null);
    });
  });
}

// Stored duration, probing the file the first time it's needed.
async function ensureDuration(table, id) {
  if (!TABLES.includes(table)) return null;
  const row = db.prepare(`SELECT id, duration FROM ${table} WHERE id = ?`).get(id);
  if (!row) return null;
  if (row.duration > 0) return row.duration;
  const filePath = resolveFilePath(table, id);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const secs = await probeDuration(filePath);
  if (secs) db.prepare(`UPDATE ${table} SET duration = ? WHERE id = ?`).run(secs, id);
  return secs;
}

// The transcoder probes every file it streams; keep that result too.
function recordDuration(filePath, seconds) {
  const secs = Math.round(seconds);
  if (!(secs > 0)) return;
  for (const table of TABLES) {
    db.prepare(`UPDATE ${table} SET duration = ? WHERE file_path = ? AND (duration IS NULL OR duration <= 0)`).run(secs, filePath);
  }
}

// Background pass for everything without a duration (startup and after scans).
// One file at a time so it never competes with playback.
let filling = false;
async function fillMissingDurations() {
  if (filling) return;
  filling = true;
  let filled = 0;
  try {
    for (const table of TABLES) {
      const rows = db.prepare(`SELECT id FROM ${table} WHERE duration IS NULL OR duration <= 0`).all();
      for (const { id } of rows) {
        if (await ensureDuration(table, id)) filled++;
      }
    }
  } finally {
    filling = false;
  }
  if (filled) console.log(`[durations] Read the runtime of ${filled} file(s)`);
}

module.exports = { ensureDuration, recordDuration, fillMissingDurations };
