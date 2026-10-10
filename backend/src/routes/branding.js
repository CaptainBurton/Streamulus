// Branding (logo / "Streamulus" wordmark, shown on the web and in the apps) and
// the server's public address for the apps. Reading is public — the sign-in
// page and the apps need it before anyone has signed in.
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { imageExt } = require('./profiles');

const router = express.Router();

const brandingDir = path.join(process.env.DATA_DIR || '/data', 'uploads', 'branding');
fs.mkdirSync(brandingDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const get = (key, fallback) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;
const set = (key, value) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);

function branding() {
  const logoFile = get('brand_logo_path', '');
  return {
    showLogo: get('brand_show_logo', '1') === '1',
    showText: get('brand_show_text', '1') === '1',
    // An uploaded logo, or null for the built-in Streamulus logo.
    logoUrl: logoFile ? `/uploads/branding/${logoFile}` : null,
    // e.g. a Tailscale Funnel address; the apps use it when the home address doesn't answer.
    publicUrl: get('public_url', '') || null,
  };
}

router.get('/', (req, res) => res.json(branding()));

// { showLogo?, showText?, publicUrl? } — at least one of logo / text stays on.
router.put('/', requireAdmin, (req, res) => {
  const current = branding();
  const showLogo = req.body.showLogo !== undefined ? !!req.body.showLogo : current.showLogo;
  const showText = req.body.showText !== undefined ? !!req.body.showText : current.showText;
  if (!showLogo && !showText) return res.status(400).json({ error: 'Show the logo, the Streamulus text, or both' });
  if (req.body.publicUrl !== undefined) {
    const raw = String(req.body.publicUrl || '').trim().replace(/\/+$/, '');
    if (raw) {
      let ok = false;
      try { ok = ['http:', 'https:'].includes(new URL(raw).protocol); } catch {}
      if (!ok) return res.status(400).json({ error: 'Public URL must start with http:// or https:// (e.g. https://streamulus.your-tailnet.ts.net)' });
    }
    set('public_url', raw);
  }
  set('brand_show_logo', showLogo ? '1' : '0');
  set('brand_show_text', showText ? '1' : '0');
  res.json(branding());
});

function removeCustomLogo() {
  const file = get('brand_logo_path', '');
  if (file) fs.rm(path.join(brandingDir, file), { force: true }, () => {});
  set('brand_logo_path', '');
}

router.post('/logo', requireAdmin, (req, res) => {
  upload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Logo must be 5 MB or smaller' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = imageExt(req.file.buffer);
    if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG, WebP or GIF image (a square PNG with a transparent background works best)' });
    const filename = `logo-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(brandingDir, filename), req.file.buffer);
    removeCustomLogo();
    set('brand_logo_path', filename);
    // A new logo with the logo hidden would be pointless — show it.
    set('brand_show_logo', '1');
    res.json(branding());
  });
});

// Back to the built-in logo.
router.delete('/logo', requireAdmin, (req, res) => {
  removeCustomLogo();
  res.json(branding());
});

module.exports = router;
