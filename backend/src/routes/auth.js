const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { authenticate, signToken, tokenPayload } = require('../middleware/auth');
const { ensureMainProfile, publicProfile } = require('../services/profiles');
const accounts = require('../services/accounts');
const sessions = require('../services/sessions');
const activity = require('../services/activity');

const router = express.Router();

// Signing in uses the exact name first, then ignores letter case, so "erin"
// finds "Erin" (unless that's ambiguous).
function findUser(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const exact = db.prepare('SELECT * FROM users WHERE username = ?').get(n);
  if (exact) return exact;
  const loose = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').all(n);
  return loose.length === 1 ? loose[0] : null;
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
const registerLimit = limiter(10, 60 * 60 * 1000); // new accounts per IP per hour
const failedSignIns = limiter(20, 15 * 60 * 1000); // wrong passwords per IP per 15 minutes

const WAITING = 'Your account needs an Admin Passphrase before you can sign in. Ask your Streamulus admin for one — '
  + 'it usually takes 5–10 minutes — then enter it here. Each passphrase works once, for 1 hour.';

// A pending account signs in once with its Admin Passphrase, which activates it.
// Returns an error to send, or null once the account is active.
function activatePending(user, passphrase) {
  const fail = (code, error) => ({ status: 403, body: { error, code, pending: true } });
  if (!String(passphrase || '').trim()) return fail('PASSPHRASE_REQUIRED', WAITING);
  if (!user.passphrase_hash) {
    return fail('PASSPHRASE_NOT_READY', "Your admin hasn't made a passphrase for you yet — it usually takes 5–10 minutes. Try again soon.");
  }
  if (Date.now() > user.passphrase_expires_at) {
    return fail('PASSPHRASE_EXPIRED', 'That passphrase has expired (they last 1 hour). Ask your admin for a new one.');
  }
  if (!accounts.passphraseMatches(passphrase, user.passphrase_hash)) {
    const attempts = user.passphrase_attempts + 1;
    if (attempts >= accounts.MAX_ATTEMPTS) {
      // Too many guesses: this passphrase stops working; the admin makes a new one.
      db.prepare('UPDATE users SET passphrase_hash = NULL, passphrase_expires_at = NULL, passphrase_attempts = 0 WHERE id = ?').run(user.id);
      return fail('PASSPHRASE_EXPIRED', 'Too many wrong passphrases — ask your admin for a new one.');
    }
    db.prepare('UPDATE users SET passphrase_attempts = ? WHERE id = ?').run(attempts, user.id);
    return fail('PASSPHRASE_INVALID', "That passphrase isn't right. Check it with your admin and try again.");
  }
  // Single use: clear it as the account becomes active.
  db.prepare(`UPDATE users SET status = 'active', passphrase_hash = NULL, passphrase_expires_at = NULL,
              passphrase_attempts = 0 WHERE id = ?`).run(user.id);
  return null;
}

function failed(req, res, status, body, { user, username, reason }) {
  activity.log(req, { category: 'auth', action: 'sign_in_failed', userId: user?.id ?? null, username: user?.username ?? String(username || '').slice(0, 64), detail: reason });
  return res.status(status).json(body);
}

router.post('/login', async (req, res) => {
  const { username, password, passphrase } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const blocked = { error: 'Too many failed sign-ins from here — try again in 15 minutes' };

  const user = findUser(username);
  if (!user) {
    if (!failedSignIns(req.ip)) return res.status(429).json(blocked);
    return failed(req, res, 401, { error: 'Invalid credentials' }, { username, reason: 'No account with that name' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    if (!failedSignIns(req.ip)) return res.status(429).json(blocked);
    return failed(req, res, 401, { error: 'Invalid credentials' }, { user, reason: 'Wrong password' });
  }

  let method = 'Password';
  if (user.status === 'pending') {
    const failure = activatePending(user, passphrase);
    if (failure) return failed(req, res, failure.status, failure.body, { user, reason: failure.body.error });
    method = 'Admin Passphrase (account activated)';
    activity.log(req, { category: 'account', action: 'activated', userId: user.id, username: user.username, detail: 'Signed in with an Admin Passphrase' });
  } else if (user.status === 'disabled') {
    return failed(req, res, 403, { error: 'This account has been disabled — ask your Streamulus admin', code: 'ACCOUNT_DISABLED' }, { user, reason: 'Account disabled' });
  } else if (user.status !== 'active') {
    return failed(req, res, 403, { error: 'This account is not active' }, { user, reason: 'Account not active' });
  }

  const main = ensureMainProfile(user.id, user.username);
  const profileCount = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(user.id).n;
  const sessionId = sessions.create(user.id, req);
  activity.log(req, { category: 'auth', action: 'sign_in', userId: user.id, username: user.username, detail: method });
  res.json({
    token: signToken(user, main.id, sessionId),
    user: { id: user.id, username: user.username, role: user.role },
    profile: publicProfile(main),
    // The app shows "Who's watching?" after login when there's more than one profile.
    profileCount,
  });
});

// Create an account (web or app): a display name — also the sign-in name — and
// a password. It waits for an Admin Passphrase before it can be used.
router.post('/register', async (req, res) => {
  if (!registerLimit(req.ip)) return res.status(429).json({ error: 'Too many new accounts from here — try again later' });
  const name = accounts.cleanDisplayName(req.body?.displayName ?? req.body?.username);
  if (!name) {
    return res.status(400).json({ error: "Display name must be 3–32 characters: letters, numbers, spaces and . _ ' -" });
  }
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(name)) {
    return res.status(409).json({ error: 'That name is already taken — try another' });
  }
  const waiting = db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").get().n;
  if (waiting >= accounts.MAX_PENDING) {
    return res.status(503).json({ error: 'Too many accounts are waiting for approval — try again later' });
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = db.prepare("INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'user', 'pending')").run(name, hash);
    activity.log(req, { category: 'account', action: 'registered', userId: r.lastInsertRowid, username: name, detail: 'Asked for an account (waiting for an Admin Passphrase)' });
  } catch {
    return res.status(409).json({ error: 'That name is already taken — try another' });
  }
  res.status(201).json({ pending: true, username: name, message: WAITING });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user, profile: publicProfile(req.profile) });
});

// Signs this device out (its session stops working). Always succeeds, even with
// no or an expired token.
router.post('/logout', (req, res) => {
  const payload = tokenPayload(req);
  const user = payload && db.prepare('SELECT id, username FROM users WHERE id = ?').get(payload.userId);
  if (user) {
    if (payload.sid) sessions.revoke(payload.sid);
    activity.log(req, { category: 'auth', action: 'sign_out', userId: user.id, username: user.username });
  }
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
  const username = accounts.cleanDisplayName(req.body.username);
  if (!username) {
    return res.status(400).json({ error: "Username must be 3–32 characters: letters, numbers, spaces and . _ ' -" });
  }
  const row = await checkAccountChange(req, res);
  if (!row) return;
  const taken = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, row.id);
  if (taken) return res.status(409).json({ error: 'That username is already taken' });
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, row.id);
  activity.log(req, { category: 'account', action: 'username_changed', username, detail: `${row.username} → ${username}` });
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
  // Other devices sign in again with the new password; this one stays signed in.
  db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?').run(Date.now(), row.id, req.sessionId);
  activity.log(req, { category: 'account', action: 'password_changed', detail: 'Changed their password (other devices signed out)' });
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
