const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { ensureMainProfile } = require('../services/profiles');

// Example values from docker-compose.yml / the README and the old built-in
// default. They're public, so anyone could sign their own admin token with them —
// which matters as soon as the server is reachable from the internet.
const PLACEHOLDER_SECRETS = new Set([
  'streamulus-secret-change-in-production',
  'change-me-to-a-strong-random-secret',
  'your-strong-random-secret-here',
]);

// The JWT_SECRET setting when it's a real one; otherwise a random secret made
// once and kept in the data folder, so sign-ins survive restarts and updates.
function loadSecret() {
  const configured = String(process.env.JWT_SECRET || '').trim();
  if (configured && !PLACEHOLDER_SECRETS.has(configured) && configured.length >= 16) return configured;
  if (configured) console.warn('[auth] JWT_SECRET is a placeholder or too short — using a random secret kept in the data folder instead.');
  const file = path.join(process.env.DATA_DIR || '/data', 'jwt-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {}
  const secret = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch (err) {
    console.warn(`[auth] Couldn't save the sign-in secret (${err.message}) — everyone will need to sign in again after a restart.`);
  }
  return secret;
}

const JWT_SECRET = loadSecret();

// Tokens carry the account (userId), the active profile (profileId), the signed-in
// device (sid, services/sessions.js) and the account's token_version (tv). A token
// without a profileId — e.g. straight after login — acts as the main profile.
function signToken(user, profileId, sessionId) {
  const tv = db.prepare('SELECT token_version FROM users WHERE id = ?').get(user.id)?.token_version || 0;
  return jwt.sign({ userId: user.id, role: user.role, profileId: profileId ?? undefined, sid: sessionId ?? undefined, tv },
    JWT_SECRET, { expiresIn: '7d' });
}

const SIGNED_OUT = { error: 'You were signed out — sign in again', code: 'SIGNED_OUT' };

function authenticate(req, res, next) {
  // Also accept token as query param for SSE endpoints (EventSource can't set headers)
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token || req.query?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const user = db.prepare('SELECT id, username, email, role, status, token_version FROM users WHERE id = ?').get(payload.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  // Only active accounts get tokens; an admin may have disabled it since.
  if (user.status !== 'active') {
    return res.status(401).json({ error: user.status === 'disabled' ? 'This account has been disabled' : 'This account is not active yet', code: 'ACCOUNT_INACTIVE' });
  }
  // Signed out by the admin ("Sign out everywhere", a password reset) or this device signed out.
  if ((payload.tv || 0) !== (user.token_version || 0)) return res.status(401).json(SIGNED_OUT);
  if (payload.sid && !require('../services/sessions').check(payload.sid, user.id, req)) return res.status(401).json(SIGNED_OUT);
  delete user.status;
  delete user.token_version;
  req.sessionId = payload.sid || null;

  let profile;
  if (payload.profileId) {
    profile = db.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').get(payload.profileId, user.id);
    // Never fall back to another profile: a deleted Streamling must not become the main profile.
    if (!profile) return res.status(401).json({ error: 'Profile no longer exists', code: 'PROFILE_GONE' });
  } else {
    profile = ensureMainProfile(user.id, user.username);
  }

  req.user = user;
  req.profile = profile;
  // Titles/overviews in English for profiles that asked for it (services/locale.js).
  require('../services/locale').run(req, res, next);
}

function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    if (req.profile.is_kids) return res.status(403).json({ error: 'Not available on a Streamling profile' });
    next();
  });
}

// The request's token contents if it's valid, else null (no response sent).
function tokenPayload(req) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token || req.query?.token;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

module.exports = { authenticate, requireAdmin, JWT_SECRET, signToken, tokenPayload };
