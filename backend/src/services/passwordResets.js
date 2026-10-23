// Password reset links. The email carries a random token; only its SHA-256 is
// stored, so a copy of the database can't be used to reset anyone's password.
// A link works once, for RESET_MINUTES, and asking again replaces older links.
const crypto = require('crypto');
const db = require('../database/db');

const RESET_MINUTES = 60;

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function create(userId, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(userId);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)')
      .run(hash(token), userId, now, now + RESET_MINUTES * 60 * 1000, ip || null);
  })();
  return token;
}

// The account a still-valid token belongs to, or null.
function find(token) {
  if (!token || String(token).length < 20) return null;
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hash(token));
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  const user = db.prepare('SELECT id, username, status FROM users WHERE id = ?').get(row.user_id);
  if (!user || user.status !== 'active') return null;
  return { ...user, expiresAt: row.expires_at, tokenHash: row.token_hash };
}

function markUsed(found) {
  db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(Date.now(), found.tokenHash);
  db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(found.id);
}

// Old links are dropped after a day.
setInterval(() => {
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(Date.now() - 24 * 60 * 60 * 1000);
}, 6 * 60 * 60 * 1000).unref();

module.exports = { RESET_MINUTES, create, find, markUsed };
