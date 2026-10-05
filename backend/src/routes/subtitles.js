const express = require('express');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const { canAccess } = require('../services/kids');
const { resolveFilePath } = require('../services/path-repair');
const { listTracks, getVtt } = require('../services/subtitles');

const router = express.Router();

// :type is 'movie' or 'episode'.
function mediaFile(req, res) {
  const { type, id } = req.params;
  if (!['movie', 'episode'].includes(type)) { res.status(400).json({ error: 'Bad type' }); return null; }
  if (!canAccess(req, type, id)) { res.status(404).json({ error: 'Not found' }); return null; }
  const filePath = resolveFilePath(type === 'movie' ? 'movies' : 'episodes', id);
  if (!filePath || !fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return null; }
  return filePath;
}

router.get('/:type/:id', authenticate, async (req, res) => {
  const filePath = mediaFile(req, res);
  if (!filePath) return;
  const tracks = await listTracks(filePath);
  res.json({ tracks: tracks.map(({ file, ...t }) => t) }); // don't expose file names
});

// WebVTT for one track. Cue times are the file's own times (from 0:00).
router.get('/:type/:id/:track.vtt', authenticate, async (req, res) => {
  const filePath = mediaFile(req, res);
  if (!filePath) return;
  const track = (await listTracks(filePath)).find(t => t.id === req.params.track);
  if (!track) return res.status(404).json({ error: 'No such subtitle track' });
  try {
    const vtt = await getVtt(filePath, track);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(vtt);
  } catch (e) {
    console.error(`[subtitles] ${filePath} ${track.id}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
