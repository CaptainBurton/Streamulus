// Feedback and app suggestions (Profile & Settings › Feedback in the apps, Profile
// & Account on the web). Each one is a conversation: the person's message, then
// replies from the admin (Admin › Feedback) and from them.
//
//   /api/feedback        — your own (this profile's) feedback
//   /api/admin/feedback  — everyone's, for admins
//
// status: 'open' (waiting for the admin), 'answered' (the admin replied last) or
// 'closed'. "Unread" means the other side wrote since you last opened it.
const express = require('express');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const KINDS = ['feedback', 'suggestion'];
const STATUSES = ['open', 'answered', 'closed'];
const PLATFORMS = ['web', 'iphone', 'ipad', 'android', 'android-tablet', 'appletv'];
const MAX_LENGTH = 4000;

function cleanMessage(text) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  return body.length >= 1 && body.length <= MAX_LENGTH ? body : null;
}

// Simple fixed-window limiter: at most `max` hits per key per window.
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (key) => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= max;
  };
}
const newLimit = limiter(20, 60 * 60 * 1000);      // new feedback per account per hour
const replyLimit = limiter(120, 60 * 60 * 1000);   // replies per account per hour

const messagesOf = (ids) => {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT * FROM feedback_messages WHERE feedback_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
  const byId = new Map(ids.map(id => [id, []]));
  for (const m of rows) byId.get(m.feedback_id).push(m);
  return byId;
};

// side: 'user' or 'admin' — whose "unread" to work out.
function shape(f, messages, side) {
  const seen = side === 'admin' ? f.admin_seen_at : f.user_seen_at;
  const fromOtherSide = messages.filter(m => (side === 'admin' ? !m.from_admin : !!m.from_admin));
  const last = messages[messages.length - 1];
  return {
    id: f.id,
    kind: f.kind,
    status: f.status,
    platform: f.platform,
    appVersion: f.app_version,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
    preview: messages[0]?.body.slice(0, 160) ?? '',
    lastFromAdmin: !!last?.from_admin,
    unread: fromOtherSide.some(m => !seen || m.created_at > seen),
    messages: messages.map(m => ({
      id: m.id,
      fromAdmin: !!m.from_admin,
      author: m.author_name,
      body: m.body,
      createdAt: m.created_at,
    })),
  };
}

// ── Your own feedback ────────────────────────────────────────────────────────
const user = express.Router();

const ownFeedback = (req, id) =>
  db.prepare('SELECT * FROM feedback WHERE id = ? AND user_id = ? AND profile_id = ?').get(id, req.user.id, req.profile.id);

user.get('/', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM feedback WHERE user_id = ? AND profile_id = ? ORDER BY updated_at DESC').all(req.user.id, req.profile.id);
  const messages = messagesOf(rows.map(r => r.id));
  const items = rows.map(r => shape(r, messages.get(r.id), 'user'));
  res.json({ items, unreadCount: items.filter(i => i.unread).length });
});

// Just the number of conversations with a reply you haven't read (for badges).
user.get('/unread', authenticate, (req, res) => {
  const n = db.prepare(`
    SELECT COUNT(*) AS n FROM feedback f
    WHERE f.user_id = ? AND f.profile_id = ? AND EXISTS (
      SELECT 1 FROM feedback_messages m
      WHERE m.feedback_id = f.id AND m.from_admin = 1 AND (f.user_seen_at IS NULL OR m.created_at > f.user_seen_at)
    )
  `).get(req.user.id, req.profile.id).n;
  res.json({ count: n });
});

user.post('/', authenticate, (req, res) => {
  if (!newLimit(`u${req.user.id}`)) return res.status(429).json({ error: "You've sent a lot of feedback this hour — try again later" });
  const body = cleanMessage(req.body?.message);
  if (!body) return res.status(400).json({ error: `Write a message (up to ${MAX_LENGTH} characters)` });
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'feedback';
  const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : 'web';
  const appVersion = req.body?.appVersion ? String(req.body.appVersion).slice(0, 40) : null;
  const now = Date.now();
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO feedback (user_id, profile_id, profile_name, kind, status, platform, app_version, created_at, updated_at, user_seen_at)
                          VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`)
      .run(req.user.id, req.profile.id, req.profile.name, kind, platform, appVersion, now, now, now);
    db.prepare('INSERT INTO feedback_messages (feedback_id, from_admin, author_name, body, created_at) VALUES (?, 0, ?, ?, ?)')
      .run(r.lastInsertRowid, req.profile.name, body, now);
    return r.lastInsertRowid;
  })();
  const f = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);
  res.status(201).json({ item: shape(f, messagesOf([id]).get(id), 'user') });
});

// Reply to the admin. Replying to a closed conversation opens it again.
user.post('/:id/messages', authenticate, (req, res) => {
  const f = ownFeedback(req, req.params.id);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  if (!replyLimit(`u${req.user.id}`)) return res.status(429).json({ error: 'Too many messages this hour — try again later' });
  const body = cleanMessage(req.body?.message);
  if (!body) return res.status(400).json({ error: `Write a message (up to ${MAX_LENGTH} characters)` });
  const now = Date.now();
  db.transaction(() => {
    db.prepare('INSERT INTO feedback_messages (feedback_id, from_admin, author_name, body, created_at) VALUES (?, 0, ?, ?, ?)')
      .run(f.id, req.profile.name, body, now);
    db.prepare("UPDATE feedback SET status = 'open', updated_at = ?, user_seen_at = ? WHERE id = ?").run(now, now, f.id);
  })();
  const updated = db.prepare('SELECT * FROM feedback WHERE id = ?').get(f.id);
  res.json({ item: shape(updated, messagesOf([f.id]).get(f.id), 'user') });
});

// Opened it: the admin's replies so far are read.
user.post('/:id/read', authenticate, (req, res) => {
  const f = ownFeedback(req, req.params.id);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  db.prepare('UPDATE feedback SET user_seen_at = ? WHERE id = ?').run(Date.now(), f.id);
  res.json({ success: true });
});

// ── Admin › Feedback ─────────────────────────────────────────────────────────
const admin = express.Router();

admin.get('/', requireAdmin, (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`
    SELECT f.*, u.username, p.is_kids AS profile_is_kids, p.avatar_path AS profile_avatar
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
    LEFT JOIN profiles p ON p.id = f.profile_id
    ${status ? 'WHERE f.status = ?' : ''}
    ORDER BY f.updated_at DESC
  `).all(...(status ? [status] : []));
  const messages = messagesOf(rows.map(r => r.id));
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status').all()) counts[r.status] = r.n;
  res.json({
    items: rows.map(r => ({
      ...shape(r, messages.get(r.id), 'admin'),
      username: r.username ?? '(removed account)',
      profileName: r.profile_name,
      profileIsKids: !!r.profile_is_kids,
      profileAvatarUrl: r.profile_avatar ? `/uploads/avatars/${r.profile_avatar}` : null,
    })),
    counts,
    unreadCount: countUnreadForAdmin(),
  });
});

function countUnreadForAdmin() {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM feedback f
    WHERE f.status != 'closed' AND EXISTS (
      SELECT 1 FROM feedback_messages m
      WHERE m.feedback_id = f.id AND m.from_admin = 0 AND (f.admin_seen_at IS NULL OR m.created_at > f.admin_seen_at)
    )
  `).get().n;
}

const getFeedback = (id) => db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);

admin.post('/:id/messages', requireAdmin, (req, res) => {
  const f = getFeedback(req.params.id);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  const body = cleanMessage(req.body?.message);
  if (!body) return res.status(400).json({ error: `Write a reply (up to ${MAX_LENGTH} characters)` });
  const now = Date.now();
  db.transaction(() => {
    db.prepare('INSERT INTO feedback_messages (feedback_id, from_admin, author_name, body, created_at) VALUES (?, 1, ?, ?, ?)')
      .run(f.id, req.user.username, body, now);
    db.prepare("UPDATE feedback SET status = 'answered', updated_at = ?, admin_seen_at = ? WHERE id = ?").run(now, now, f.id);
  })();
  res.json({ success: true });
});

admin.put('/:id', requireAdmin, (req, res) => {
  const f = getFeedback(req.params.id);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  if (!STATUSES.includes(req.body?.status)) return res.status(400).json({ error: "Status must be 'open', 'answered' or 'closed'" });
  db.prepare('UPDATE feedback SET status = ?, admin_seen_at = ? WHERE id = ?').run(req.body.status, Date.now(), f.id);
  res.json({ success: true, status: req.body.status });
});

admin.post('/:id/read', requireAdmin, (req, res) => {
  const f = getFeedback(req.params.id);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  db.prepare('UPDATE feedback SET admin_seen_at = ? WHERE id = ?').run(Date.now(), f.id);
  res.json({ success: true });
});

admin.delete('/:id', requireAdmin, (req, res) => {
  const f = getFeedback(req.params.id);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  db.prepare('DELETE FROM feedback WHERE id = ?').run(f.id);
  res.json({ success: true });
});

module.exports = { user, admin, countUnreadForAdmin };
