// The activity log (Admin › Users › Activity): sign-ins and failed sign-ins,
// account changes, what people started watching, and admin actions — with
// when, who, from which app / device and IP. Old entries are removed after the
// admin's retention period (90 days unless changed).
const db = require('../database/db');
const client = require('./client');

const CATEGORIES = ['auth', 'account', 'playback', 'admin'];
const DEFAULT_RETENTION_DAYS = 90;

const insert = () => db.prepare(`INSERT INTO activity_log
  (at, category, action, user_id, username, profile_name, detail, ip, app, device, media_type, media_id)
  VALUES (@at, @category, @action, @user_id, @username, @profile_name, @detail, @ip, @app, @device, @media_type, @media_id)`);

/**
 * Record something. req (may be null) gives the signed-in user, profile, IP and
 * device; fields can override them, e.g. { userId, username } for a sign-in.
 */
function log(req, { category, action, detail = null, userId, username, profileName, mediaType = null, mediaId = null }) {
  try {
    const who = req?.user;
    const { app, device } = req ? client.describe(req) : { app: null, device: null };
    insert().run({
      at: Date.now(),
      category,
      action,
      user_id: userId ?? who?.id ?? null,
      username: username ?? who?.username ?? null,
      profile_name: profileName ?? (req?.profile && !req.profile.is_main ? req.profile.name : null),
      detail: detail == null ? null : String(detail).slice(0, 500),
      ip: req?.ip || null,
      app, device,
      media_type: mediaType,
      media_id: mediaId,
    });
  } catch (err) {
    console.error('[activity] Could not record:', err.message);
  }
}

// "Started watching": at most once per profile and title every 30 minutes, so
// skipping around (each skip is a new stream) doesn't fill the log.
const recentWatches = new Map(); // `${profileId}:${type}:${id}` → time
function logWatch(req, type, id) {
  const key = `${req.profile?.id}:${type}:${id}`;
  const now = Date.now();
  if (now - (recentWatches.get(key) || 0) < 30 * 60 * 1000) return;
  recentWatches.set(key, now);
  if (recentWatches.size > 5000) recentWatches.clear();
  let detail = null;
  if (type === 'movie') {
    const m = db.prepare('SELECT title, year FROM movies WHERE id = ?').get(id);
    detail = m ? `${m.title}${m.year ? ` (${m.year})` : ''}` : null;
  } else {
    const e = db.prepare(`SELECT s.title AS show, e.season, e.episode_number, e.title FROM episodes e
                          JOIN tv_shows s ON s.id = e.show_id WHERE e.id = ?`).get(id);
    detail = e ? `${e.show} · S${String(e.season).padStart(2, '0')}E${String(e.episode_number).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}` : null;
  }
  log(req, { category: 'playback', action: 'watch', detail, mediaType: type === 'movie' ? 'movie' : 'episode', mediaId: Number(id) });
}

function retentionDays() {
  const v = db.prepare("SELECT value FROM config WHERE key = 'activity_retention_days'").get()?.value;
  const n = v === undefined ? DEFAULT_RETENTION_DAYS : parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_RETENTION_DAYS; // 0 = keep forever
}

function setRetentionDays(days) {
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('activity_retention_days', ?)").run(String(days));
  prune();
}

function prune() {
  const days = retentionDays();
  if (!days) return 0;
  return db.prepare('DELETE FROM activity_log WHERE at < ?').run(Date.now() - days * 86400000).changes;
}
setInterval(prune, 6 * 60 * 60 * 1000).unref();

// Filtered page of the log, newest first.
// filters: { userId, category, action, q, since (ms), before (id), limit }
function query({ userId, category, action, q, since, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  if (category && CATEGORIES.includes(category)) { where.push('category = ?'); args.push(category); }
  if (action) { where.push('action = ?'); args.push(action); }
  if (since) { where.push('at >= ?'); args.push(since); }
  if (q) {
    where.push('(username LIKE ? OR detail LIKE ? OR ip LIKE ? OR device LIKE ? OR app LIKE ? OR profile_name LIKE ?)');
    for (let i = 0; i < 6; i++) args.push(`%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM activity_log ${clause}`).get(...args).n;
  const items = db.prepare(`SELECT * FROM activity_log ${clause} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, Math.min(Math.max(1, limit), 1000), Math.max(0, offset));
  return { total, items };
}

function clear() {
  return db.prepare('DELETE FROM activity_log').run().changes;
}

module.exports = { CATEGORIES, log, logWatch, query, clear, prune, retentionDays, setRetentionDays };
