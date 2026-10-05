// "Who's watching?" profiles inside an account.
//
// Permissions:
//  - The main profile manages everything: add / edit / delete any profile,
//    make a profile a Streamling (kids), set or clear any PIN.
//  - Other adult profiles can edit their own name, photo and PIN.
//  - Streamling profiles can't edit profiles.
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../database/db');
const { authenticate, signToken } = require('../middleware/auth');
const { MAX_PROFILES, publicProfile, deleteProfileData } = require('../services/profiles');

const router = express.Router();

const avatarsDir = path.join(process.env.DATA_DIR || '/data', 'uploads', 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AVATAR_BYTES } });

// Identify the image from its first bytes (not the browser-supplied type or
// name), and save it with the matching extension so it's served as that type.
function imageExt(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  const head = buf.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

const getOwnProfile = (req, id) => db.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').get(id, req.user.id);
const isManager = (req) => !!req.profile.is_main && !req.profile.is_kids;
const canEdit = (req, target) => isManager(req) || (target.id === req.profile.id && !req.profile.is_kids);

function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  return n.length >= 1 && n.length <= 20 ? n : null;
}

function removeAvatarFile(p) {
  if (p?.avatar_path) fs.rm(path.join(avatarsDir, p.avatar_path), { force: true }, () => {});
}

function parentalLock(userId) {
  const u = db.prepare('SELECT parental_lock, parental_lock_method FROM users WHERE id = ?').get(userId) || {};
  return { enabled: u.parental_lock !== 0, method: u.parental_lock_method === 'pin' ? 'pin' : 'password' };
}

// What switching from the current profile to `target` needs: 'pin', 'password' or null.
function requiredCheck(req, target, lock) {
  if (target.id === req.profile.id) return null;
  if (lock.enabled && req.profile.is_kids && !target.is_kids) {
    // Leaving a Streamling: the parental lock. PIN only if this profile has one.
    return lock.method === 'pin' && target.pin_hash ? 'pin' : 'password';
  }
  return target.pin_hash ? 'pin' : null; // a PIN-locked profile always needs its PIN
}

router.get('/', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY is_main DESC, id').all(req.user.id);
  const lock = parentalLock(req.user.id);
  res.json({
    profiles: rows.map(p => ({ ...publicProfile(p), requires: requiredCheck(req, p, lock) })),
    currentProfileId: req.profile.id,
    maxProfiles: MAX_PROFILES,
    parentalLock: lock,
  });
});

router.post('/', authenticate, (req, res) => {
  if (!isManager(req)) return res.status(403).json({ error: 'Only the main profile can add profiles' });
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Profile name must be 1–20 characters' });
  const count = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(req.user.id).n;
  if (count >= MAX_PROFILES) return res.status(400).json({ error: `An account can have up to ${MAX_PROFILES} profiles` });
  const r = db.prepare('INSERT INTO profiles (user_id, name, is_kids) VALUES (?, ?, ?)').run(req.user.id, name, req.body.is_kids ? 1 : 0);
  res.json({ profile: publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(r.lastInsertRowid)) });
});

router.put('/:id', authenticate, async (req, res) => {
  const target = getOwnProfile(req, req.params.id);
  if (!target) return res.status(404).json({ error: 'Profile not found' });
  if (!canEdit(req, target)) return res.status(403).json({ error: "You can't edit this profile" });

  const updates = {};
  if (req.body.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Profile name must be 1–20 characters' });
    updates.name = name;
  }
  if (req.body.is_kids !== undefined) {
    if (!isManager(req)) return res.status(403).json({ error: 'Only the main profile can change Streamling settings' });
    if (target.is_main && req.body.is_kids) return res.status(400).json({ error: "The main profile can't be a Streamling" });
    updates.is_kids = req.body.is_kids ? 1 : 0;
    if (updates.is_kids) updates.pin_hash = null; // Streamlings don't have PINs
  }
  if (req.body.pin !== undefined) {
    const kids = updates.is_kids ?? target.is_kids;
    if (req.body.pin === null || req.body.pin === '') {
      updates.pin_hash = null;
    } else {
      if (kids) return res.status(400).json({ error: "Streamling profiles can't have a PIN" });
      if (!/^\d{4}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'PIN must be 4 digits' });
      updates.pin_hash = await bcrypt.hash(String(req.body.pin), 10);
    }
  }

  const cols = Object.keys(updates);
  if (cols.length) {
    db.prepare(`UPDATE profiles SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => updates[c]), target.id);
  }
  res.json({ profile: publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(target.id)) });
});

router.delete('/:id', authenticate, (req, res) => {
  if (!isManager(req)) return res.status(403).json({ error: 'Only the main profile can remove profiles' });
  const target = getOwnProfile(req, req.params.id);
  if (!target) return res.status(404).json({ error: 'Profile not found' });
  if (target.is_main) return res.status(400).json({ error: "The main profile can't be removed" });
  db.transaction(() => deleteProfileData(target.id))();
  removeAvatarFile(target);
  res.json({ success: true });
});

router.post('/:id/avatar', authenticate, (req, res) => {
  const target = getOwnProfile(req, req.params.id);
  if (!target) return res.status(404).json({ error: 'Profile not found' });
  if (!canEdit(req, target)) return res.status(403).json({ error: "You can't edit this profile" });

  upload.single('avatar')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Image must be 8 MB or smaller' : 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = imageExt(req.file.buffer);
    if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG, WebP or GIF image' });

    const filename = `p${target.id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(avatarsDir, filename), req.file.buffer);
    db.prepare('UPDATE profiles SET avatar_path = ? WHERE id = ?').run(filename, target.id);
    removeAvatarFile(target);
    res.json({ profile: publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(target.id)) });
  });
});

router.delete('/:id/avatar', authenticate, (req, res) => {
  const target = getOwnProfile(req, req.params.id);
  if (!target) return res.status(404).json({ error: 'Profile not found' });
  if (!canEdit(req, target)) return res.status(403).json({ error: "You can't edit this profile" });
  db.prepare('UPDATE profiles SET avatar_path = NULL WHERE id = ?').run(target.id);
  removeAvatarFile(target);
  res.json({ profile: publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(target.id)) });
});

// Switch profile. Returns a new token for that profile. A PIN-locked profile
// needs its PIN — that's what stops a Streamling switching into an adult
// profile. Wrong PINs are limited to 5 per 5 minutes per profile.
const fails = new Map(); // 'pin:<profileId>' | 'pw:<userId>' -> { count, until }
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

router.post('/:id/select', authenticate, async (req, res) => {
  const target = getOwnProfile(req, req.params.id);
  if (!target) return res.status(404).json({ error: 'Profile not found' });

  const needs = requiredCheck(req, target, parentalLock(req.user.id));
  if (needs) {
    const key = needs === 'pin' ? `pin:${target.id}` : `pw:${req.user.id}`;
    const f = fails.get(key);
    if (f && f.count >= MAX_FAILS && f.until > Date.now()) {
      return res.status(429).json({ error: `Too many wrong ${needs === 'pin' ? 'PINs' : 'passwords'} — try again in a few minutes` });
    }
    let ok = false;
    if (needs === 'pin') {
      ok = /^\d{4}$/.test(String(req.body.pin ?? '')) && await bcrypt.compare(String(req.body.pin), target.pin_hash);
    } else if (req.body.password) {
      const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      ok = !!u && await bcrypt.compare(String(req.body.password), u.password_hash);
    }
    if (!ok) {
      const given = needs === 'pin' ? req.body.pin : req.body.password;
      if (given) {
        const cur = f && f.until > Date.now() ? f : { count: 0 };
        fails.set(key, { count: cur.count + 1, until: Date.now() + LOCK_MS });
      }
      return needs === 'pin'
        ? res.status(403).json({ error: given ? 'Wrong PIN' : 'PIN required', code: 'PIN_REQUIRED' })
        : res.status(403).json({ error: given ? 'Wrong password' : 'Password required', code: 'PASSWORD_REQUIRED' });
    }
    fails.delete(key);
  }

  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.user.id);
  res.json({ token: signToken(user, target.id), profile: publicProfile(target) });
});

module.exports = router;
