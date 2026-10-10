// Admin › Profile Pictures: categories of provided profile pictures and who can
// pick them (services/avatarLibrary.js). Mounted at /api/admin/avatars.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { imageExt } = require('./profiles');
const library = require('../services/avatarLibrary');

const router = express.Router();

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 50;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: MAX_FILES } });

function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  return n.length >= 1 && n.length <= 40 ? n : null;
}
const cleanAudience = (a) => (library.AUDIENCES.includes(a) ? a : null);

const getCategory = (id) => db.prepare('SELECT * FROM avatar_categories WHERE id = ?').get(id);
const nameTaken = (name, exceptId = 0) =>
  !!db.prepare('SELECT id FROM avatar_categories WHERE name = ? COLLATE NOCASE AND id != ?').get(name, exceptId);

// Everything, with how many profiles use each picture.
router.get('/', requireAdmin, (req, res) => {
  const categories = db.prepare('SELECT * FROM avatar_categories ORDER BY name COLLATE NOCASE, id').all();
  const images = db.prepare('SELECT * FROM avatar_images ORDER BY id').all();
  const usedBy = Object.fromEntries(db.prepare(`
    SELECT avatar_library_id AS id, COUNT(*) AS n FROM profiles
    WHERE avatar_library_id IS NOT NULL GROUP BY avatar_library_id
  `).all().map(r => [r.id, r.n]));
  res.json({
    categories: categories.map(c => ({
      id: c.id,
      name: c.name,
      audience: c.audience,
      images: images.filter(i => i.category_id === c.id).map(i => ({
        id: i.id,
        url: library.imageUrl(i.file),
        audience: i.audience,
        usedBy: usedBy[i.id] || 0,
      })),
    })),
  });
});

router.post('/categories', requireAdmin, (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Category name must be 1–40 characters' });
  const audience = cleanAudience(req.body?.audience ?? 'all');
  if (!audience) return res.status(400).json({ error: "Audience must be 'all', 'adults' or 'kids'" });
  if (nameTaken(name)) return res.status(409).json({ error: 'There is already a category with that name' });
  const r = db.prepare('INSERT INTO avatar_categories (name, audience) VALUES (?, ?)').run(name, audience);
  res.json({ category: { id: r.lastInsertRowid, name, audience, images: [] } });
});

router.put('/categories/:id', requireAdmin, (req, res) => {
  const category = getCategory(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const updates = {};
  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Category name must be 1–40 characters' });
    if (nameTaken(name, category.id)) return res.status(409).json({ error: 'There is already a category with that name' });
    updates.name = name;
  }
  if (req.body?.audience !== undefined) {
    const audience = cleanAudience(req.body.audience);
    if (!audience) return res.status(400).json({ error: "Audience must be 'all', 'adults' or 'kids'" });
    updates.audience = audience;
  }
  const cols = Object.keys(updates);
  if (cols.length) {
    db.prepare(`UPDATE avatar_categories SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => updates[c]), category.id);
  }
  res.json({ success: true, ...updates });
});

// Removes the category and its pictures. Profiles already using one keep it.
router.delete('/categories/:id', requireAdmin, (req, res) => {
  const category = getCategory(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const images = db.prepare('SELECT * FROM avatar_images WHERE category_id = ?').all(category.id);
  db.transaction(() => {
    db.prepare(`UPDATE profiles SET avatar_library_id = NULL
                WHERE avatar_library_id IN (SELECT id FROM avatar_images WHERE category_id = ?)`).run(category.id);
    db.prepare('DELETE FROM avatar_images WHERE category_id = ?').run(category.id);
    db.prepare('DELETE FROM avatar_categories WHERE id = ?').run(category.id);
  })();
  for (const i of images) library.removeFile(i.file);
  res.json({ success: true });
});

// Add pictures (field "images", up to 50 at once). PNG, JPG, WebP or GIF.
router.post('/categories/:id/images', requireAdmin, (req, res) => {
  const category = getCategory(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  upload.array('images', MAX_FILES)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each picture must be 8 MB or smaller'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Add up to ${MAX_FILES} pictures at a time`
        : 'Upload failed';
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No pictures uploaded' });
    const audience = cleanAudience(req.body?.audience ?? 'all') || 'all';
    const added = [];
    const skipped = [];
    const insert = db.prepare('INSERT INTO avatar_images (category_id, file, audience) VALUES (?, ?, ?)');
    for (const f of files) {
      const ext = imageExt(f.buffer);
      if (!ext) { skipped.push(f.originalname); continue; }
      const file = `c${category.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(library.libraryDir, file), f.buffer);
      const r = insert.run(category.id, file, audience);
      added.push({ id: r.lastInsertRowid, url: library.imageUrl(file), audience, usedBy: 0 });
    }
    if (!added.length) return res.status(400).json({ error: 'Use PNG, JPG, WebP or GIF pictures', skipped });
    res.json({ added, skipped });
  });
});

router.put('/images/:id', requireAdmin, (req, res) => {
  const image = db.prepare('SELECT * FROM avatar_images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Picture not found' });
  const audience = cleanAudience(req.body?.audience);
  if (!audience) return res.status(400).json({ error: "Audience must be 'all', 'adults' or 'kids'" });
  db.prepare('UPDATE avatar_images SET audience = ? WHERE id = ?').run(audience, image.id);
  res.json({ success: true, audience });
});

// Remove a picture from the choices. Profiles already using it keep it.
router.delete('/images/:id', requireAdmin, (req, res) => {
  const image = db.prepare('SELECT * FROM avatar_images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Picture not found' });
  db.transaction(() => {
    db.prepare('UPDATE profiles SET avatar_library_id = NULL WHERE avatar_library_id = ?').run(image.id);
    db.prepare('DELETE FROM avatar_images WHERE id = ?').run(image.id);
  })();
  library.removeFile(image.file);
  res.json({ success: true });
});

module.exports = router;
