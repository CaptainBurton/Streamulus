const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data';

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error(`[db] FATAL: Cannot create data directory ${DATA_DIR}: ${err.message}`);
  console.error('[db] Fix: ensure the Docker volume for /data is writable by the container process.');
  process.exit(1);
}

let db;
try {
  db = new Database(path.join(DATA_DIR, 'streamulus.db'));
} catch (err) {
  console.error(`[db] FATAL: Cannot open database at ${path.join(DATA_DIR, 'streamulus.db')}: ${err.message}`);
  if (err.message.includes('permission') || err.message.includes('EACCES')) {
    console.error('[db] Fix: the /data volume is not writable. On Ubuntu/Linux, run:');
    console.error(`[db]   docker exec streamulus chmod 777 /data`);
    console.error('[db] or fix the volume permissions on the host and restart the container.');
  } else if (err.code === 'MODULE_NOT_FOUND' || err.message.includes('better_sqlite3')) {
    console.error('[db] Fix: better-sqlite3 native module failed to load.');
    console.error('[db] The image may need a clean rebuild: in Portainer, remove the image and redeploy.');
  }
  process.exit(1);
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    last_scanned DATETIME
  );

  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER,
    file_path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    tmdb_id INTEGER,
    overview TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    rating REAL,
    genres TEXT,
    duration INTEGER,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (library_id) REFERENCES libraries(id)
  );

  CREATE TABLE IF NOT EXISTS tv_shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER,
    title TEXT NOT NULL,
    tmdb_id INTEGER,
    overview TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    rating REAL,
    genres TEXT,
    status TEXT,
    first_air_date TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (library_id) REFERENCES libraries(id)
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER,
    file_path TEXT UNIQUE NOT NULL,
    season INTEGER,
    episode_number INTEGER,
    title TEXT,
    overview TEXT,
    still_path TEXT,
    duration INTEGER,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (show_id) REFERENCES tv_shows(id)
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    media_type TEXT,
    media_id INTEGER,
    position INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Incremental schema migrations — safe to run on every startup
try { db.exec('ALTER TABLE tv_shows ADD COLUMN tvdb_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE movies ADD COLUMN imdb_id TEXT'); } catch {}
try { db.exec('ALTER TABLE movies ADD COLUMN imdb_rating REAL'); } catch {}
try { db.exec('ALTER TABLE movies ADD COLUMN content_rating TEXT'); } catch {}
try { db.exec('ALTER TABLE tv_shows ADD COLUMN imdb_id TEXT'); } catch {}
try { db.exec('ALTER TABLE tv_shows ADD COLUMN imdb_rating REAL'); } catch {}
try { db.exec('ALTER TABLE tv_shows ADD COLUMN content_rating TEXT'); } catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER NOT NULL,
    season_number INTEGER NOT NULL,
    poster_path TEXT,
    UNIQUE(show_id, season_number)
  )`);
} catch {}
// Clear malformed episode still_path values: relative TVDB paths that were incorrectly
// prefixed with the TMDB CDN URL before the toFullUrl() fix was introduced.
try {
  db.prepare(`UPDATE episodes SET still_path = NULL WHERE still_path LIKE 'https://image.tmdb.org/t/p/%/banners/%'`).run();
} catch {}


const ENCODING_DEFAULTS = {
  video_crf: '23',
  video_preset: 'ultrafast',
  video_resolution: 'original',
  audio_bitrate: '192k',
  audio_channels: '2',
  hls_segment_duration: '4',
};
for (const [key, value] of Object.entries(ENCODING_DEFAULTS)) {
  db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

module.exports = db;
