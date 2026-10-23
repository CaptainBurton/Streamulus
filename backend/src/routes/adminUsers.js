// Admin › Users: accounts and their profiles, signed-in devices, account
// changes (name, email, role, disable, password reset, sign out), and the
// activity log.
//   /api/admin/users     — accounts
//   /api/admin/activity  — the log
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { ensureMainProfile, publicProfile, deleteProfileData } = require('../services/profiles');
const accounts = require('../services/accounts');
const sessions = require('../services/sessions');
const activity = require('../services/activity');

const uploadsDir = path.join(process.env.DATA_DIR || '/data', 'uploads');
const DAY = 24 * 60 * 60 * 1000;

// ── Accounts ─────────────────────────────────────────────────────────────────

const users = express.Router();

const ACCOUNT_COLUMNS = `u.id, u.username, u.email, u.role, u.status, u.passphrase_expires_at, u.created_at, u.last_login_at,
  (SELECT MAX(last_seen_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen_at,
  (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.last_seen_at > @fresh) AS device_count,
  (SELECT COUNT(*) FROM activity_log a WHERE a.user_id = u.id AND a.action = 'watch' AND a.at > @month) AS watches_30d,
  (SELECT MAX(at) FROM activity_log a WHERE a.user_id = u.id) AS last_activity_at`;

function shape(u, profiles) {
  const { passphrase_expires_at, ...rest } = u;
  return {
    ...rest,
    // Last time the account did anything we know of.
    last_active_at: Math.max(u.last_seen_at || 0, u.last_activity_at || 0, u.last_login_at || 0) || null,
    passphraseExpiresAt: u.status === 'pending' ? passphrase_expires_at : null,
    profiles: profiles.filter(p => p.user_id === u.id).map(p => ({ ...publicProfile(p), created_at: p.created_at })),
  };
}

const params = () => ({ fresh: Date.now() - 30 * DAY, month: Date.now() - 30 * DAY });

// Accounts with their profiles nested underneath (main profile first). Accounts
// people created themselves show as status 'pending' until they're activated
// with an Admin Passphrase; passphraseExpiresAt says whether one is out (ms).
users.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM users u ORDER BY u.id`).all(params());
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY is_main DESC, id').all();
  res.json({ users: rows.map(u => shape(u, profiles)), me: req.user.id });
});

// One account in full: profiles, devices, recent activity and what it watched.
users.get('/:id', requireAdmin, (req, res) => {
  const u = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM users u WHERE u.id = @id`).get({ ...params(), id: Number(req.params.id) });
  if (!u) return res.status(404).json({ error: 'Account not found' });
  const profiles = db.prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY is_main DESC, id').all(u.id);
  const watched = db.prepare(`
    SELECT wh.media_type, wh.media_id, wh.position, wh.completed, wh.watched_at, p.name AS profile_name,
           m.title AS movie_title, m.year,
           s.title AS show_title, e.season, e.episode_number, e.title AS episode_title, COALESCE(m.duration, e.duration) AS duration
    FROM watch_history wh
    LEFT JOIN profiles p ON p.id = wh.profile_id
    LEFT JOIN movies m ON wh.media_type = 'movie' AND m.id = wh.media_id
    LEFT JOIN episodes e ON wh.media_type = 'episode' AND e.id = wh.media_id
    LEFT JOIN tv_shows s ON s.id = e.show_id
    WHERE wh.user_id = ? ORDER BY wh.watched_at DESC LIMIT 20`).all(u.id)
    .map(w => ({
      title: w.media_type === 'movie'
        ? `${w.movie_title || 'Removed movie'}${w.year ? ` (${w.year})` : ''}`
        : `${w.show_title || 'Removed show'} · S${String(w.season ?? 0).padStart(2, '0')}E${String(w.episode_number ?? 0).padStart(2, '0')}${w.episode_title ? ` · ${w.episode_title}` : ''}`,
      profile: w.profile_name, watched_at: w.watched_at, completed: !!w.completed,
      progress: w.duration > 0 ? Math.min(1, w.position / w.duration) : null,
    }));
  res.json({
    user: shape(u, profiles),
    sessions: sessions.list(u.id).map(s => ({ ...s, current: s.id === req.sessionId })),
    activity: activity.query({ userId: u.id, limit: 60 }).items,
    watched,
  });
});

const adminCount = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get().n;

users.post('/', requireAdmin, async (req, res) => {
  const { email, password, role = 'user' } = req.body;
  const username = accounts.cleanDisplayName(req.body.username);
  if (!username) return res.status(400).json({ error: "Username must be 3–32 characters: letters, numbers, spaces and . _ ' -" });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role must be user or admin' });
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) return res.status(409).json({ error: 'Username already exists' });
  const hash = await bcrypt.hash(String(password), 12);
  const result = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, email || null, hash, role);
  ensureMainProfile(result.lastInsertRowid, username);
  activity.log(req, { category: 'admin', action: 'user_created', detail: `Created ${role === 'admin' ? 'admin ' : ''}account ${username}` });
  res.json({ id: result.lastInsertRowid, username, role });
});

// { username?, email?, role?, status?: 'active' | 'disabled' }
users.put('/:id', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  const self = target.id === req.user.id;
  const b = req.body || {};
  const updates = {};
  const changes = [];

  if (b.username !== undefined) {
    const username = accounts.cleanDisplayName(b.username);
    if (!username) return res.status(400).json({ error: "Username must be 3–32 characters: letters, numbers, spaces and . _ ' -" });
    if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, target.id)) {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    if (username !== target.username) { updates.username = username; changes.push(`name ${target.username} → ${username}`); }
  }
  if (b.email !== undefined) {
    const email = String(b.email || '').trim().slice(0, 200) || null;
    if (email !== target.email) { updates.email = email; changes.push(email ? `email ${email}` : 'email removed'); }
  }
  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) return res.status(400).json({ error: 'Role must be user or admin' });
    if (b.role !== target.role) {
      if (self) return res.status(400).json({ error: "You can't change your own role" });
      if (target.role === 'admin' && target.status === 'active' && adminCount() <= 1) return res.status(400).json({ error: 'Streamulus needs at least one admin' });
      updates.role = b.role;
      changes.push(b.role === 'admin' ? 'made an admin' : 'admin access removed');
    }
  }
  if (b.status !== undefined) {
    if (!['active', 'disabled'].includes(b.status)) return res.status(400).json({ error: 'Status must be active or disabled' });
    if (b.status !== target.status) {
      if (self) return res.status(400).json({ error: "You can't disable your own account" });
      if (b.status === 'disabled' && target.role === 'admin' && adminCount() <= 1) return res.status(400).json({ error: 'Streamulus needs at least one admin' });
      updates.status = b.status;
      changes.push(b.status === 'disabled' ? 'disabled' : 'enabled');
    }
  }

  const cols = Object.keys(updates);
  if (cols.length) {
    db.prepare(`UPDATE users SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => updates[c]), target.id);
    if (updates.status === 'disabled') sessions.revokeAll(target.id);
    if (updates.username) {
      // The main profile is named after the account unless someone renamed it.
      db.prepare('UPDATE profiles SET name = ? WHERE user_id = ? AND is_main = 1 AND name = ?').run(updates.username.slice(0, 20), target.id, target.username.slice(0, 20));
    }
    activity.log(req, { category: 'admin', action: 'user_updated', detail: `${target.username}: ${changes.join(', ')}` });
  }
  res.json({ success: true, changed: changes });
});

// { password, signOut = true } — a new password, set by the admin.
users.post('/:id/password', requireAdmin, async (req, res) => {
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, 12), target.id);
  const signOut = req.body?.signOut !== false && target.id !== req.user.id;
  if (signOut) sessions.revokeAll(target.id);
  activity.log(req, { category: 'admin', action: 'password_reset', detail: `New password for ${target.username}${signOut ? ' (signed out everywhere)' : ''}` });
  res.json({ success: true, signedOut: signOut });
});

// Sign the account out on every device.
users.post('/:id/sign-out', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Sign yourself out from your profile menu' });
  sessions.revokeAll(target.id);
  activity.log(req, { category: 'admin', action: 'signed_out_everywhere', detail: `Signed ${target.username} out on every device` });
  res.json({ success: true });
});

// Sign one device out.
users.delete('/:id/sessions/:sid', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  const session = db.prepare('SELECT * FROM user_sessions WHERE id = ? AND user_id = ?').get(req.params.sid, req.params.id);
  if (!target || !session) return res.status(404).json({ error: 'Not found' });
  sessions.revoke(session.id);
  activity.log(req, { category: 'admin', action: 'session_revoked', detail: `Signed ${target.username} out of ${[session.app, session.device].filter(Boolean).join(' · ') || 'a device'}` });
  res.json({ success: true });
});

// Make a new single-use Admin Passphrase for an account that's waiting, valid for
// an hour. It replaces any earlier one and is only ever shown here, once.
users.post('/:id/passphrase', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id, username, status FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  if (user.status !== 'pending') return res.status(400).json({ error: 'That account is already active' });
  const passphrase = accounts.generatePassphrase();
  const expiresAt = Date.now() + accounts.PASSPHRASE_TTL_MS;
  db.prepare('UPDATE users SET passphrase_hash = ?, passphrase_expires_at = ?, passphrase_attempts = 0 WHERE id = ?')
    .run(accounts.hashPassphrase(passphrase), expiresAt, user.id);
  activity.log(req, { category: 'admin', action: 'passphrase_created', detail: `Admin Passphrase for ${user.username}` });
  res.json({ passphrase, expiresAt, username: user.username });
});

users.delete('/:id', requireAdmin, (req, res) => {
  if (parseInt(req.params.id, 10) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const target = db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.role === 'admin' && target.status === 'active' && adminCount() <= 1) return res.status(400).json({ error: 'Streamulus needs at least one admin' });
  // Remove the account's profiles, their avatars and watch history first —
  // with foreign keys on, leftover rows made the delete fail.
  const profiles = db.prepare('SELECT * FROM profiles WHERE user_id = ?').all(target.id);
  db.transaction(() => {
    for (const p of profiles) deleteProfileData(p.id);
    db.prepare('DELETE FROM watch_history WHERE user_id = ?').run(target.id);
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(target.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  })();
  for (const p of profiles) {
    if (p.avatar_path) fs.rm(path.join(uploadsDir, 'avatars', p.avatar_path), { force: true }, () => {});
  }
  activity.log(req, { category: 'admin', action: 'user_deleted', detail: `Removed account ${target.username}` });
  res.json({ success: true });
});

// ── Activity log ─────────────────────────────────────────────────────────────

const log = express.Router();

const PERIODS = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

function filters(q) {
  return {
    userId: q.user ? Number(q.user) : undefined,
    category: q.category || undefined,
    action: q.action || undefined,
    q: String(q.q || '').trim().slice(0, 100) || undefined,
    since: PERIODS[q.period] ? Date.now() - PERIODS[q.period] : undefined,
  };
}

// ?user=&category=auth|account|playback|admin&action=&q=&period=24h|7d|30d&limit=&offset=
log.get('/', requireAdmin, (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const offset = parseInt(req.query.offset, 10) || 0;
  res.json({ ...activity.query({ ...filters(req.query), limit, offset }), retentionDays: activity.retentionDays() });
});

// The same, as a CSV file (up to 10,000 rows).
log.get('/export', requireAdmin, (req, res) => {
  const { items } = activity.query({ ...filters(req.query), limit: 10000 });
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['time', 'category', 'action', 'user', 'profile', 'detail', 'app', 'device', 'ip'];
  const lines = items.map(r => [new Date(r.at).toISOString(), r.category, r.action, r.username, r.profile_name, r.detail, r.app, r.device, r.ip].map(cell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="streamulus-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header.join(','), ...lines].join('\n') + '\n');
});

// { retentionDays } — 0 keeps everything.
log.put('/settings', requireAdmin, (req, res) => {
  const days = parseInt(req.body?.retentionDays, 10);
  if (!Number.isInteger(days) || days < 0 || days > 3650) return res.status(400).json({ error: 'Keep entries for 0–3650 days' });
  activity.setRetentionDays(days);
  res.json({ retentionDays: activity.retentionDays() });
});

log.delete('/', requireAdmin, (req, res) => {
  const removed = activity.clear();
  activity.log(req, { category: 'admin', action: 'log_cleared', detail: `Cleared ${removed} log entr${removed === 1 ? 'y' : 'ies'}` });
  res.json({ success: true, removed });
});

module.exports = { users, log };
