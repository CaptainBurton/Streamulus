// Quick Login: sign a device in (Apple TV, another browser) by approving a
// short code from somewhere you're already signed in — like Steam or Jellyfin.
//
//   1. The new device calls POST /start and shows the code. It keeps the
//      requestId (a long secret) to itself.
//   2. On a signed-in device the user enters the code: GET /:code shows which
//      device is asking, POST /:code/approve signs it in to that account.
//   3. The new device polls POST /poll with its requestId and receives a token.
//
// Requests live in memory and expire after 5 minutes.
const express = require('express');
const crypto = require('crypto');
const db = require('../database/db');
const { authenticate, signToken } = require('../middleware/auth');
const { ensureMainProfile, publicProfile } = require('../services/profiles');

const router = express.Router();

const TTL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_S = 3;
const MAX_PENDING = 500;
// No 0/O or 1/I — easy to read off a TV and type on a phone.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 6;

const requests = new Map(); // requestId -> { code, deviceName, expiresAt, userId }
const byCode = new Map();   // code -> requestId

const normalize = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

function newCode() {
  for (;;) {
    let code = '';
    const bytes = crypto.randomBytes(CODE_LEN);
    for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
    if (!byCode.has(code)) return code;
  }
}

function drop(requestId) {
  const r = requests.get(requestId);
  if (r) byCode.delete(r.code);
  requests.delete(requestId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, r] of requests) if (r.expiresAt <= now) drop(id);
}, 60 * 1000).unref();

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
const startLimit = limiter(20, 60 * 1000);     // per IP
const lookupLimit = limiter(20, 10 * 60 * 1000); // wrong codes per account

const secondsLeft = (r) => Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000));

// 1. New device asks for a code.
router.post('/start', (req, res) => {
  if (!startLimit(req.ip)) return res.status(429).json({ error: 'Too many requests — try again in a minute' });
  if (requests.size >= MAX_PENDING) return res.status(503).json({ error: 'Quick Login is busy — try again shortly' });
  const deviceName = String(req.body?.deviceName || 'A new device').trim().slice(0, 40) || 'A new device';
  const requestId = crypto.randomBytes(32).toString('hex');
  const code = newCode();
  const r = { code, deviceName, expiresAt: Date.now() + TTL_MS, userId: null };
  requests.set(requestId, r);
  byCode.set(code, requestId);
  res.json({ requestId, code, expiresIn: secondsLeft(r), interval: POLL_INTERVAL_S });
});

// 3. New device checks whether it's been approved.
router.post('/poll', (req, res) => {
  const requestId = String(req.body?.requestId || '');
  const r = requests.get(requestId);
  if (!r || r.expiresAt <= Date.now()) {
    drop(requestId);
    return res.status(410).json({ error: 'This code has expired — get a new one', code: 'EXPIRED' });
  }
  if (!r.userId) return res.json({ status: 'pending', expiresIn: secondsLeft(r) });

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(r.userId);
  drop(requestId); // one use only
  if (!user) return res.status(410).json({ error: 'That account no longer exists', code: 'EXPIRED' });
  const main = ensureMainProfile(user.id, user.username);
  const profileCount = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(user.id).n;
  res.json({ status: 'approved', token: signToken(user, main.id), user, profile: publicProfile(main), profileCount });
});

function findForApprover(req, res) {
  if (req.profile.is_kids) {
    res.status(403).json({ error: 'Ask a grown-up to approve this sign-in' });
    return null;
  }
  const code = normalize(req.params.code);
  const requestId = byCode.get(code);
  const r = requestId && requests.get(requestId);
  if (!r || r.expiresAt <= Date.now()) {
    if (!lookupLimit(req.user.id)) {
      res.status(429).json({ error: 'Too many wrong codes — try again in a few minutes' });
    } else {
      res.status(404).json({ error: "That code isn't valid or has expired. Check the code on your TV." });
    }
    return null;
  }
  return { requestId, r };
}

// 2a. Signed-in device: which device is this code for?
router.get('/:code', authenticate, (req, res) => {
  const found = findForApprover(req, res);
  if (!found) return;
  res.json({ deviceName: found.r.deviceName, expiresIn: secondsLeft(found.r), approved: !!found.r.userId });
});

// 2b. Signed-in device approves it.
router.post('/:code/approve', authenticate, (req, res) => {
  const found = findForApprover(req, res);
  if (!found) return;
  found.r.userId = req.user.id;
  res.json({ success: true, deviceName: found.r.deviceName });
});

module.exports = router;
