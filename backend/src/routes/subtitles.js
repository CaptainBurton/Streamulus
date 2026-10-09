const express = require('express');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const { canAccess } = require('../services/kids');
const { resolveFilePath } = require('../services/path-repair');
const { listTracks, getVtt, warm } = require('../services/subtitles');

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
  // The player has opened: start reading the subtitles inside the file now, so
  // they're ready (or well under way) by the time someone turns them on.
  warm(filePath, tracks);
  res.json({ tracks: tracks.map(({ file, ...t }) => t) }); // don't expose file names
});

// WebVTT for one track. Cue times are the file's own times (from 0:00).
// X-Subtitles-Complete: 0 means only the cues read so far — ask again shortly.
router.get('/:type/:id/:track.vtt', authenticate, async (req, res) => {
  const filePath = mediaFile(req, res);
  if (!filePath) return;
  const track = (await listTracks(filePath)).find(t => t.id === req.params.track);
  if (!track) return res.status(404).json({ error: 'No such subtitle track' });
  try {
    const { text, complete } = await getVtt(filePath, track);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('X-Subtitles-Complete', complete ? '1' : '0');
    res.setHeader('Access-Control-Expose-Headers', 'X-Subtitles-Complete');
    res.setHeader('Cache-Control', complete ? 'private, max-age=3600' : 'no-store');
    res.send(text);
  } catch (e) {
    console.error(`[subtitles] ${filePath} ${track.id}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
