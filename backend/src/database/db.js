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
try { db.exec('ALTER TABLE tv_shows ADD COLUMN intro_end_time INTEGER'); } catch {}
try { db.exec('ALTER TABLE tv_shows ADD COLUMN intro_start_time INTEGER'); } catch {}
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

// ── Profiles ─────────────────────────────────────────────────────────────────
// An account (users row) logs in; profiles are "who's watching" inside it, each
// with its own watch progress. Every account has exactly one main profile.
// Kids profiles ("Streamlings") only see titles allowed in Admin > Streamlings.
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    avatar_path TEXT,
    is_main INTEGER NOT NULL DEFAULT 0,
    is_kids INTEGER NOT NULL DEFAULT 0,
    pin_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

  -- Admin-chosen artwork for a genre card (otherwise a random title's artwork).
  CREATE TABLE IF NOT EXISTS genre_images (
    name TEXT PRIMARY KEY,
    image_path TEXT NOT NULL
  );

  -- Profile pictures the admin provides, in named categories (e.g. "The Simpsons"),
  -- that profiles pick from. audience: 'all' | 'adults' | 'kids' (Streamlings) —
  -- a picture is offered when both its category and the picture allow the profile.
  CREATE TABLE IF NOT EXISTS avatar_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS avatar_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES avatar_categories(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_avatar_images_category ON avatar_images(category_id);

  -- Admin's per-title choices for Streamlings; overrides the age-rating rule.
  CREATE TABLE IF NOT EXISTS kids_overrides (
    media_type TEXT NOT NULL,   -- 'movie' | 'show'
    media_id INTEGER NOT NULL,
    allowed INTEGER NOT NULL,
    PRIMARY KEY (media_type, media_id)
  );
`);
try { db.exec('ALTER TABLE watch_history ADD COLUMN profile_id INTEGER'); } catch {}
// Parental lock: leaving a Streamling for an adult profile needs the account
// password, or that profile's PIN when the method is 'pin' and it has one.
try { db.exec('ALTER TABLE users ADD COLUMN parental_lock INTEGER NOT NULL DEFAULT 1'); } catch {}
// Title logo artwork URL from TMDB ('' = none available). See services/logos.js.
try { db.exec('ALTER TABLE movies ADD COLUMN logo_path TEXT'); } catch {}
try { db.exec('ALTER TABLE tv_shows ADD COLUMN logo_path TEXT'); } catch {}
// Original language (ISO 639-1, e.g. 'ja'): Japanese/Korean/Chinese animation is
// grouped as "Anime". NULL = not looked up yet. See services/languages.js.
try { db.exec('ALTER TABLE movies ADD COLUMN original_language TEXT'); } catch {}
try { db.exec('ALTER TABLE tv_shows ADD COLUMN original_language TEXT'); } catch {}
// English title/overview when the stored ones aren't English (services/english.js).
// NULL = not checked yet, '' = nothing different in English.
for (const table of ['movies', 'tv_shows', 'episodes']) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN title_en TEXT`); } catch {}
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN overview_en TEXT`); } catch {}
}
// Per profile: show titles and descriptions in English where available.
try { db.exec('ALTER TABLE profiles ADD COLUMN english_titles INTEGER NOT NULL DEFAULT 0'); } catch {}
// The provided picture (avatar_images.id) a profile picked, if its photo is one;
// the profile keeps its own copy of the file, so removing the picture is harmless.
try { db.exec('ALTER TABLE profiles ADD COLUMN avatar_library_id INTEGER'); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN parental_lock_method TEXT NOT NULL DEFAULT 'password'"); } catch {}
// Accounts people create themselves are 'pending' until they enter the single-use
// Admin Passphrase an admin made for them (services/accounts.js).
try { db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN passphrase_hash TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN passphrase_expires_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN passphrase_attempts INTEGER NOT NULL DEFAULT 0'); } catch {}
db.exec('CREATE INDEX IF NOT EXISTS idx_wh_profile ON watch_history(profile_id, media_type, media_id)');

// Give every existing account a main profile and move its history onto it.
db.transaction(() => {
  for (const u of db.prepare(`
    SELECT id, username FROM users
    WHERE id NOT IN (SELECT user_id FROM profiles WHERE is_main = 1)
  `).all()) {
    db.prepare('INSERT INTO profiles (user_id, name, is_main) VALUES (?, ?, 1)').run(u.id, u.username);
  }
  db.prepare(`
    UPDATE watch_history SET profile_id =
      (SELECT p.id FROM profiles p WHERE p.user_id = watch_history.user_id AND p.is_main = 1)
    WHERE profile_id IS NULL
  `).run();
})();

const KIDS_DEFAULTS = {
  kids_use_ratings: 'true',   // allow titles whose age rating is within kids_max_age
  kids_max_age: '7',
  kids_allow_unrated: 'false',
};
for (const [key, value] of Object.entries(KIDS_DEFAULTS)) {
  db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

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
