// Finding new and removed files by itself, like Plex's "Scan my library
// automatically" (Admin › Libraries › Automatic Scanning).
//
// Every folder in each library is watched (inotify). When something changes,
// the movie or show folder it's in is noted, and once nothing has changed for
// SETTLE_MS — a copy in progress keeps changing — just those folders are
// scanned (scanner.scanPaths), not the whole library. Optionally, everything is
// also scanned every few hours, which catches changes the watcher can't see
// (e.g. a network share changed from another computer).
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

const SETTLE_MS = Number(process.env.AUTO_SCAN_SETTLE_MS) || 30 * 1000;
const MAX_WAIT_MS = 10 * 60 * 1000; // scan anyway if a folder keeps changing this long
const MAX_WATCHES = 100000;
// Partial downloads and temporary files aren't worth waking up for.
const IGNORED = /(^\.|\.(part|partial|tmp|temp|!qb|crdownload|bts|nfo|txt|jpg|jpeg|png|srt\.tmp)$|^~)/i;

const state = {
  watchers: new Map(), // dir → FSWatcher
  pending: new Map(), // library id → { lib, targets: Map(target → first seen), timer }
  intervalTimer: null,
  error: null,
  lastRun: null, // { at, library, added, removed, folders }
  generation: 0, // bumped by restart(), so an older start() stops adding watchers
};

const getConf = (key, fallback) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;
const setConf = (key, value) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));

function settings() {
  return {
    enabled: getConf('library_auto_scan', 'true') === 'true',
    intervalHours: Math.max(0, parseFloat(getConf('library_scan_interval_hours', '0')) || 0),
  };
}

function noteError(err) {
  const msg = err?.code === 'ENOSPC'
    ? "The system's limit on watched folders was reached, so some folders aren't watched. Raise fs.inotify.max_user_watches on the server, or turn on the regular full scan."
    : `Couldn't watch every folder (${err?.message || err}).`;
  if (state.error !== msg) console.error(`[auto-scan] ${msg}`);
  state.error = msg;
}

function closeWatcher(dir) {
  const w = state.watchers.get(dir);
  if (w) { try { w.close(); } catch {} state.watchers.delete(dir); }
}

// Watch `dir` and every folder below it.
async function watchTree(lib, dir, generation) {
  if (generation !== state.generation || state.watchers.has(dir)) return;
  if (state.watchers.size >= MAX_WATCHES) return noteError({ code: 'ENOSPC' });
  let watcher;
  try {
    watcher = fs.watch(dir, { persistent: false }, (event, name) => onChange(lib, dir, name ? String(name) : null));
  } catch (err) {
    return noteError(err);
  }
  watcher.on('error', () => closeWatcher(dir)); // e.g. the folder was deleted
  state.watchers.set(dir, watcher);
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) await watchTree(lib, path.join(dir, entry.name), generation);
  }
}

// Something in `dir` changed: note the movie / show folder (or loose file) it belongs to.
function onChange(lib, dir, name) {
  if (name && IGNORED.test(name)) return;
  const full = name ? path.join(dir, name) : dir;
  const rel = path.relative(lib.path, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  const target = path.join(lib.path, rel.split(path.sep)[0]);
  // A new folder (e.g. a film just moved in): watch it too.
  fs.promises.stat(full).then(st => {
    if (st.isDirectory()) watchTree(lib, full, state.generation);
  }).catch(() => {
    // Gone: stop watching it and anything that was below it.
    for (const watched of [...state.watchers.keys()]) {
      if (watched === full || watched.startsWith(full + path.sep)) closeWatcher(watched);
    }
  });
  queue(lib, target);
}

function queue(lib, target) {
  let entry = state.pending.get(lib.id);
  if (!entry) { entry = { lib, targets: new Map(), timer: null }; state.pending.set(lib.id, entry); }
  if (!entry.targets.has(target)) entry.targets.set(target, Date.now());
  clearTimeout(entry.timer);
  const oldest = Math.min(...entry.targets.values());
  const wait = Date.now() - oldest > MAX_WAIT_MS ? 0 : SETTLE_MS;
  entry.timer = setTimeout(() => flush(lib.id), wait);
  entry.timer.unref?.();
}

async function flush(libraryId) {
  const entry = state.pending.get(libraryId);
  if (!entry || !entry.targets.size) return;
  const targets = [...entry.targets.keys()];
  entry.targets.clear();
  const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId);
  if (!lib) return;
  try {
    const result = await require('./scanner').scanPaths(lib, targets);
    state.lastRun = { at: Date.now(), library: lib.name, added: result.added, removed: result.removed, folders: targets.map(t => path.basename(t)).slice(0, 10) };
    if (result.added || result.removed) {
      console.log(`[auto-scan] ${lib.name}: ${result.added} added, ${result.removed} removed (${targets.map(t => path.basename(t)).join(', ').slice(0, 200)})`);
    }
  } catch (err) {
    console.error(`[auto-scan] ${lib.name}: ${err.message}`);
  }
}

function stop() {
  state.generation++;
  for (const dir of [...state.watchers.keys()]) closeWatcher(dir);
  for (const entry of state.pending.values()) clearTimeout(entry.timer);
  state.pending.clear();
  clearInterval(state.intervalTimer);
  state.intervalTimer = null;
  state.error = null;
}

// (Re)start with the current settings and libraries — at start-up, and whenever
// libraries or these settings change.
async function restart() {
  stop();
  const generation = state.generation;
  const { enabled, intervalHours } = settings();
  if (intervalHours > 0) {
    state.intervalTimer = setInterval(() => {
      require('./scanner').scanAllWithProgress(() => {}).catch(err => console.error(`[auto-scan] Full scan failed: ${err.message}`));
    }, intervalHours * 60 * 60 * 1000);
    state.intervalTimer.unref?.();
  }
  if (!enabled) return;
  const libraries = db.prepare('SELECT * FROM libraries').all();
  for (const lib of libraries) {
    if (!fs.existsSync(lib.path)) continue;
    await watchTree(lib, lib.path, generation);
  }
  if (generation === state.generation) {
    console.log(`[auto-scan] Watching ${state.watchers.size} folder(s) in ${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'}`);
  }
}

function status() {
  const { enabled, intervalHours } = settings();
  return {
    enabled,
    intervalHours,
    watching: state.watchers.size,
    pending: [...state.pending.values()].reduce((n, e) => n + e.targets.size, 0),
    error: enabled ? state.error : null,
    lastRun: state.lastRun,
  };
}

function update({ enabled, intervalHours }) {
  if (enabled !== undefined) setConf('library_auto_scan', enabled ? 'true' : 'false');
  if (intervalHours !== undefined) setConf('library_scan_interval_hours', String(Math.max(0, Math.min(168, Number(intervalHours) || 0))));
  restart().catch(err => console.error(`[auto-scan] ${err.message}`));
}

module.exports = { restart, stop, status, update, flush, SETTLE_MS };
