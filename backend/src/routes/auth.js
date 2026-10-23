const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { authenticate, signToken, tokenPayload } = require('../middleware/auth');
const { ensureMainProfile, publicProfile } = require('../services/profiles');
const accounts = require('../services/accounts');
const sessions = require('../services/sessions');
const activity = require('../services/activity');
const mailer = require('../services/mailer');
const resets = require('../services/passwordResets');

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

// Why an email address can't be used for an account, or null if it can.
function emailError(email, exceptUserId = null) {
  if (!mailer.validEmail(email) || email.length > 200) return "That doesn't look like an email address";
  const taken = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id IS NOT ?').get(email, exceptUserId);
  return taken ? 'Another account already uses that email address' : null;
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
const forgotPerIp = limiter(15, 15 * 60 * 1000); // reset requests per IP per 15 minutes (a household shares one)
const forgotPerAccount = limiter(3, 60 * 60 * 1000); // reset emails per account per hour

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
  // An email is required, so everyone can reset their password if they forget it.
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Enter your email address — it lets you reset your password if you forget it' });
  const emailProblem = emailError(email);
  if (emailProblem) return res.status(400).json({ error: emailProblem });
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(name)) {
    return res.status(409).json({ error: 'That name is already taken — try another' });
  }
  const waiting = db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").get().n;
  if (waiting >= accounts.MAX_PENDING) {
    return res.status(503).json({ error: 'Too many accounts are waiting for approval — try again later' });
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = db.prepare("INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, 'user', 'pending')").run(name, email, hash);
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

// Your own email address (used to send you a password reset link). Empty removes it.
router.put('/account/email', authenticate, async (req, res) => {
  const email = String(req.body.email || '').trim() || null;
  const problem = email && emailError(email, req.user.id);
  if (problem) return res.status(400).json({ error: problem });
  const row = await checkAccountChange(req, res);
  if (!row) return;
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, row.id);
  activity.log(req, { category: 'account', action: 'email_changed', detail: email ? `Set their email to ${mailer.maskEmail(email)}` : 'Removed their email address' });
  res.json({ success: true, email });
});

// ── Forgot password ──────────────────────────────────────────────────────────
// 1. POST /forgot { identifier: email or username } emails a reset link.
// 2. GET /password-reset/:token says whose it is (or 410 if it's expired/used).
// 3. POST /password-reset { token, password } sets the new password.

router.post('/forgot', async (req, res) => {
  const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim().slice(0, 200);
  if (!identifier) return res.status(400).json({ error: 'Enter the email address on your account' });
  if (!forgotPerIp(req.ip)) return res.status(429).json({ error: 'Too many reset requests from here — try again in 15 minutes' });
  const contact = mailer.settings().support_contact;
  const fail = (status, code, error, detail, user) => {
    activity.log(req, { category: 'auth', action: 'password_reset_failed', userId: user?.id ?? null, username: user?.username ?? identifier.slice(0, 64), detail });
    return res.status(status).json({ code, error, contact });
  };

  const isEmail = identifier.includes('@');
  const user = isEmail
    ? db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(identifier)
    : findUser(identifier);
  if (!user) {
    return isEmail
      ? fail(404, 'NOT_FOUND', `No account here uses that email address. If you haven't added an email address to your account, contact ${contact} to reset your password.`, 'No account with that email')
      : fail(404, 'NOT_FOUND', `We couldn't find an account called "${identifier}". Check the spelling, or contact ${contact}.`, 'No account with that username');
  }
  if (!user.email) {
    return fail(409, 'NO_EMAIL', `You haven't set up an email address on your account, so we can't send you a reset link. Contact ${contact} to reset your password.`, 'No email on the account', user);
  }
  if (user.status === 'pending') {
    return fail(403, 'PENDING', `Your account is still waiting for an Admin Passphrase — ask ${contact} for one, then sign in with the password you chose.`, 'Account waiting for approval', user);
  }
  if (user.status !== 'active') {
    return fail(403, 'DISABLED', `This account has been disabled — contact ${contact}.`, 'Account disabled', user);
  }
  if (!mailer.configured()) {
    return fail(503, 'EMAIL_NOT_CONFIGURED', `Password reset emails aren't set up on this server yet — contact ${contact} to reset your password.`, 'Email sending isn\'t set up (Admin › Settings › Email)', user);
  }
  if (!forgotPerAccount(user.id)) {
    return fail(429, 'TOO_MANY', 'We sent you a reset email recently — check your inbox (and spam folder), or try again in an hour.', 'Too many reset emails', user);
  }

  const token = resets.create(user.id, req.ip);
  const site = mailer.siteUrl(req);
  const message = mailer.resetEmail({
    username: user.username, url: `${site}/reset-password?token=${encodeURIComponent(token)}`,
    minutes: resets.RESET_MINUTES, site, contact,
  });
  try {
    await mailer.send({ to: user.email, ...message });
  } catch (err) {
    console.error(`[mail] Password reset email to ${user.username} failed: ${err.message}`);
    return fail(502, 'EMAIL_FAILED', `We couldn't send the email right now — try again later, or contact ${contact}.`, `Email failed: ${err.message}`, user);
  }
  activity.log(req, { category: 'auth', action: 'password_reset_requested', userId: user.id, username: user.username, detail: `Reset email sent to ${mailer.maskEmail(user.email)}` });
  res.json({ sent: true, to: mailer.maskEmail(user.email), minutes: resets.RESET_MINUTES });
});

const EXPIRED = { code: 'EXPIRED', error: 'This reset link has expired or was already used. Ask for a new one from the sign-in page.' };

router.get('/password-reset/:token', (req, res) => {
  const found = resets.find(req.params.token);
  if (!found) return res.status(410).json(EXPIRED);
  res.json({ username: found.username, expiresAt: found.expiresAt });
});

router.post('/password-reset', async (req, res) => {
  const found = resets.find(req.body?.token);
  if (!found) return res.status(410).json(EXPIRED);
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Your new password must be at least 6 characters' });
  if (req.body?.confirm !== undefined && req.body.confirm !== password) return res.status(400).json({ error: "The passwords don't match" });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, 12), found.id);
  resets.markUsed(found);
  sessions.revokeAll(found.id); // every device signs in again with the new password
  activity.log(req, { category: 'account', action: 'password_reset_completed', userId: found.id, username: found.username, detail: 'Reset their password from an email link (signed out everywhere)' });
  res.json({ success: true, username: found.username });
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
