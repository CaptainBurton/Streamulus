const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { ensureMainProfile } = require('../services/profiles');

const JWT_SECRET = process.env.JWT_SECRET || 'streamulus-secret-change-in-production';

// Tokens carry the account (userId) and the active profile (profileId). A token
// without a profileId — e.g. straight after login — acts as the main profile.
function signToken(user, profileId) {
  return jwt.sign({ userId: user.id, role: user.role, profileId: profileId ?? undefined }, JWT_SECRET, { expiresIn: '7d' });
}

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
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(payload.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

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

module.exports = { authenticate, requireAdmin, JWT_SECRET, signToken };
