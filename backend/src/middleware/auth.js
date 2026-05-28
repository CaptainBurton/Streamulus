const jwt = require('jsonwebtoken');
const db = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'streamulus-secret-change-in-production';

function authenticate(req, res, next) {
  // Also accept token as query param for SSE endpoints (EventSource can't set headers)
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token || req.query?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

module.exports = { authenticate, requireAdmin, JWT_SECRET };
