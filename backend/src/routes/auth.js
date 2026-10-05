const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { authenticate, signToken } = require('../middleware/auth');
const { ensureMainProfile, publicProfile } = require('../services/profiles');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const main = ensureMainProfile(user.id, user.username);
  const profileCount = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(user.id).n;
  res.json({
    token: signToken(user, main.id),
    user: { id: user.id, username: user.username, role: user.role },
    profile: publicProfile(main),
    // The app shows "Who's watching?" after login when there's more than one profile.
    profileCount,
  });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user, profile: publicProfile(req.profile) });
});

router.post('/logout', (req, res) => {
  res.json({ success: true });
});

// ── Account settings (main profile only) ─────────────────────────────────────
// The login's username and password belong to the account, so only the main
// profile can change them, and the current password is always required.
async function checkAccountChange(req, res) {
  if (!req.profile.is_main) {
    res.status(403).json({ error: 'Only the main profile can change account settings' });
    return null;
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!req.body.currentPassword || !(await bcrypt.compare(req.body.currentPassword, row.password_hash))) {
    res.status(400).json({ error: 'Current password is incorrect' });
    return null;
  }
  return row;
}

router.put('/account/username', authenticate, async (req, res) => {
  const username = (req.body.username || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 characters: letters, numbers, . _ or -' });
  }
  const row = await checkAccountChange(req, res);
  if (!row) return;
  const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, row.id);
  if (taken) return res.status(409).json({ error: 'That username is already taken' });
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, row.id);
  res.json({ success: true, username });
});

router.put('/account/password', authenticate, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const row = await checkAccountChange(req, res);
  if (!row) return;
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(newPassword, 12), row.id);
  res.json({ success: true });
});

// Parental lock (main profile): whether leaving a Streamling needs a check, and
// whether that check is the profile's PIN or the account password.
router.put('/account/parental-lock', authenticate, (req, res) => {
  if (!req.profile.is_main || req.profile.is_kids) {
    return res.status(403).json({ error: 'Only the main profile can change the parental lock' });
  }
  const { enabled, method } = req.body;
  if (method !== undefined && !['pin', 'password'].includes(method)) {
    return res.status(400).json({ error: "Method must be 'pin' or 'password'" });
  }
  if (enabled !== undefined) db.prepare('UPDATE users SET parental_lock = ? WHERE id = ?').run(enabled ? 1 : 0, req.user.id);
  if (method !== undefined) db.prepare('UPDATE users SET parental_lock_method = ? WHERE id = ?').run(method, req.user.id);
  const u = db.prepare('SELECT parental_lock, parental_lock_method FROM users WHERE id = ?').get(req.user.id);
  res.json({ parentalLock: { enabled: u.parental_lock !== 0, method: u.parental_lock_method } });
});

module.exports = router;
