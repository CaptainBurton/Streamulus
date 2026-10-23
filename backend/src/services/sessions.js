// Signed-in devices. Each sign-in (password, Admin Passphrase or Quick Login)
// creates a session; the token carries its id, so the admin can see where an
// account is signed in and sign one device — or all of them — out.
const crypto = require('crypto');
const db = require('../database/db');
const client = require('./client');

// Sessions not used for this long are dropped (tokens last 7 days anyway).
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

function create(userId, req) {
  const id = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const { app, device } = client.describe(req);
  db.prepare('INSERT INTO user_sessions (id, user_id, created_at, last_seen_at, ip, app, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, now, now, req.ip || null, app, device);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, userId);
  return id;
}

// Is this session still signed in? Notes when it was last used (at most once a minute).
const lastTouch = new Map();
function check(sessionId, userId, req) {
  const s = db.prepare('SELECT id, user_id, revoked_at FROM user_sessions WHERE id = ?').get(sessionId);
  if (!s || s.user_id !== userId || s.revoked_at) return false;
  const now = Date.now();
  if (now - (lastTouch.get(sessionId) || 0) > 60 * 1000) {
    lastTouch.set(sessionId, now);
    const { app, device } = client.describe(req);
    // Video requests come from the system player (no app header): keep what the app said.
    if (req.get?.('x-streamulus-client') || !/\/api\/stream\//.test(req.originalUrl || '')) {
      db.prepare('UPDATE user_sessions SET last_seen_at = ?, ip = ?, app = COALESCE(?, app), device = COALESCE(?, device) WHERE id = ?')
        .run(now, req.ip || null, app, device, sessionId);
    } else {
      db.prepare('UPDATE user_sessions SET last_seen_at = ?, ip = ? WHERE id = ?').run(now, req.ip || null, sessionId);
    }
  }
  return true;
}

function list(userId) {
  return db.prepare(`SELECT id, created_at, last_seen_at, ip, app, device FROM user_sessions
                     WHERE user_id = ? AND revoked_at IS NULL AND last_seen_at > ? ORDER BY last_seen_at DESC`)
    .all(userId, Date.now() - STALE_MS);
}

function revoke(sessionId) {
  return db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), sessionId).changes > 0;
}

// Every device, including ones signed in before sessions existed (token_version).
function revokeAll(userId) {
  db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId);
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
}

function prune() {
  db.prepare('DELETE FROM user_sessions WHERE last_seen_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
    .run(Date.now() - STALE_MS, Date.now() - STALE_MS);
}
setInterval(prune, 6 * 60 * 60 * 1000).unref();

module.exports = { create, check, list, revoke, revokeAll };
