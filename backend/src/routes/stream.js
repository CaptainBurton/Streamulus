const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { getHLSSession, getManifestContent, getSegmentPath } = require('../services/transcoder');
const { posterUrl, backdropUrl } = require('../services/tmdb');

const router = express.Router();

// Log every request that reaches /api/stream/* — visible in Portainer container logs
router.use((req, res, next) => {
  console.log(`[stream] ${req.method} ${req.path} ip=${req.ip} token=${req.query.token ? 'present' : 'missing'}`);
  next();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function getFilePath(type, id) {
  if (type === 'movie') {
    const row = db.prepare('SELECT file_path FROM movies WHERE id = ?').get(id);
    return row?.file_path || null;
  }
  const row = db.prepare('SELECT file_path FROM episodes WHERE id = ?').get(id);
  return row?.file_path || null;
}

// ─── pre-flight check ─────────────────────────────────────────────────────────

router.get('/check/:type/:id', authenticate, (req, res) => {
  const filePath = getFilePath(req.params.type, req.params.id);
  if (!filePath) return res.json({ ok: false, error: 'Media not found in database' });

  if (!fs.existsSync(filePath)) {
    return res.json({ ok: false, error: `File not found on disk: ${filePath}` });
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return res.json({ ok: false, error: `File not readable — check Docker volume permissions: ${filePath}` });
  }

  res.json({ ok: true, filePath: path.basename(filePath), ext: path.extname(filePath).toLowerCase() });
});

// ─── video stream ─────────────────────────────────────────────────────────────
//
// ALL files are transcoded through FFmpeg to H.264 + AAC in a fragmented MP4.
// This handles H.265/HEVC MP4, MKV, AVI, TS — anything the browser can't play
// natively. The browser receives a progressive video/mp4 stream and starts
// playing as soon as the first chunks arrive.
//
// Optional: ?start=SECONDS  restarts the transcode from that position (seeking)

router.get('/video/:type/:id', authenticate, (req, res) => {
  const { type, id } = req.params;
  const filePath = getFilePath(type, id);

  if (!filePath) {
    console.error(`[stream] No file path found for ${type}/${id}`);
    return res.status(404).json({ error: 'Media not found in database' });
  }
  if (!fs.existsSync(filePath)) {
    console.error(`[stream] File not on disk: ${filePath}`);
    return res.status(404).json({ error: `File not found on disk: ${filePath}` });
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    console.error(`[stream] Permission denied: ${filePath}`);
    return res.status(403).json({ error: `Cannot read file — check Docker volume permissions: ${filePath}` });
  }

  const startSec = Math.max(0, parseFloat(req.query.start || '0') || 0);
  const isH265 = req.query.h265 === '1';
  console.log(`[stream] Starting transcode: ${path.basename(filePath)} start=${startSec}s codec=${isH265 ? 'h265' : 'h264'}`);

  const videoCodecArgs = isH265
    ? ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '28', '-tag:v', 'hvc1']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23'];

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'warning',
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i', filePath,
    ...videoCodecArgs,
    '-pix_fmt', 'yuv420p',
    // Normalize to even dimensions — required for yuv420p (odd width/height causes encode failure)
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-max_muxing_queue_size', '1024',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    // frag_keyframe writes a complete moov atom (with codec info) before the first fragment.
    // Do NOT use empty_moov — it omits codec info and browsers reject the stream immediately.
    '-movflags', 'frag_keyframe+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ];

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  // Tell browsers (especially Safari) not to send Range requests.
  // Our stream is a live FFmpeg pipe — there's no seekable byte range.
  // Safari respects this and plays the fMP4 stream progressively.
  res.setHeader('Accept-Ranges', 'none');

  proc.stdout.pipe(res);

  let ffmpegLog = '';
  proc.stderr.on('data', (chunk) => {
    const txt = chunk.toString();
    ffmpegLog += txt;
    process.stderr.write(`[ffmpeg] ${txt}`);
  });

  proc.on('error', (err) => {
    console.error(`[stream] FFmpeg spawn failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: `FFmpeg not found: ${err.message}` });
    else res.end();
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[stream] FFmpeg exit code ${code} for ${path.basename(filePath)}`);
    } else {
      console.log(`[stream] Transcode done: ${path.basename(filePath)}`);
    }
  });

  req.on('close', () => {
    proc.kill('SIGTERM');
  });
});

// ─── direct file serving ─────────────────────────────────────────────────────
//
// Serves the original file with full byte-range support. Safari can natively
// play H.264 and H.265 MP4 without any transcoding — Express sendFile handles
// Range headers automatically so the browser can seek and resume freely.

router.get('/direct/:type/:id', authenticate, (req, res) => {
  const { type, id } = req.params;
  const filePath = getFilePath(type, id);

  if (!filePath) return res.status(404).json({ error: 'Media not found in database' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: `File not found on disk: ${filePath}` });
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return res.status(403).json({ error: `Cannot read file — check Docker volume permissions: ${filePath}` });
  }

  console.log(`[stream] Direct play: ${path.basename(filePath)}`);
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      console.error(`[stream] Direct play error: ${err.message}`);
      res.status(500).json({ error: `Failed to stream: ${err.message}` });
    }
  });
});

// ─── watch progress ───────────────────────────────────────────────────────────

router.post('/progress', authenticate, (req, res) => {
  const { mediaType, mediaId, position, completed } = req.body;
  const existing = db.prepare(
    'SELECT id FROM watch_history WHERE user_id=? AND media_type=? AND media_id=?'
  ).get(req.user.id, mediaType, mediaId);

  if (existing) {
    db.prepare('UPDATE watch_history SET position=?, completed=?, watched_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(position, completed ? 1 : 0, existing.id);
  } else {
    db.prepare('INSERT INTO watch_history (user_id, media_type, media_id, position, completed) VALUES (?,?,?,?,?)')
      .run(req.user.id, mediaType, mediaId, position, completed ? 1 : 0);
  }
  res.json({ success: true });
});

router.get('/progress/:mediaType/:mediaId', authenticate, (req, res) => {
  const row = db.prepare(
    'SELECT position, completed FROM watch_history WHERE user_id=? AND media_type=? AND media_id=?'
  ).get(req.user.id, req.params.mediaType, req.params.mediaId);
  res.json(row || { position: 0, completed: false });
});

// ─── continue watching ────────────────────────────────────────────────────────

router.get('/continue-watching', authenticate, (req, res) => {
  const movies = db.prepare(`
    SELECT 'movie' as type, wh.media_id as id, wh.position, wh.watched_at,
           m.title, m.poster_path, m.backdrop_path, m.year, m.duration
    FROM watch_history wh
    JOIN movies m ON m.id = wh.media_id
    WHERE wh.user_id=? AND wh.media_type='movie' AND wh.completed=0 AND wh.position>10
    ORDER BY wh.watched_at DESC LIMIT 20
  `).all(req.user.id).map(m => ({
    ...m,
    poster_url: posterUrl(m.poster_path),
    backdrop_url: backdropUrl(m.backdrop_path),
  }));

  const episodes = db.prepare(`
    SELECT 'episode' as type, wh.media_id as id, wh.position, wh.watched_at,
           s.title, s.poster_path, s.backdrop_path, s.id as show_id,
           e.season, e.episode_number, e.title as episode_title, e.duration
    FROM watch_history wh
    JOIN episodes e ON e.id = wh.media_id
    JOIN tv_shows s ON s.id = e.show_id
    WHERE wh.user_id=? AND wh.media_type='episode' AND wh.completed=0 AND wh.position>10
    ORDER BY wh.watched_at DESC LIMIT 20
  `).all(req.user.id).map(e => ({
    ...e,
    subtitle: `S${String(e.season).padStart(2,'0')}E${String(e.episode_number).padStart(2,'0')}${e.episode_title ? ` · ${e.episode_title}` : ''}`,
    poster_url: posterUrl(e.poster_path),
    backdrop_url: backdropUrl(e.backdrop_path),
  }));

  const items = [...movies, ...episodes]
    .sort((a, b) => new Date(b.watched_at) - new Date(a.watched_at))
    .slice(0, 20);

  res.json({ items });
});

// ─── stream diagnostics ───────────────────────────────────────────────────────
//
// Runs ffprobe on the source file and returns stream/format info as JSON.
// Accessible from the Watch page error UI so users can debug without Portainer.

router.get('/diagnose/:type/:id', authenticate, (req, res) => {
  const { type, id } = req.params;
  const filePath = getFilePath(type, id);
  if (!filePath) return res.status(404).json({ error: 'Media not found in database' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: `File not on disk: ${filePath}` });

  const probe = spawn('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let out = '';
  let err = '';
  probe.stdout.on('data', d => { out += d.toString(); });
  probe.stderr.on('data', d => { err += d.toString(); });

  probe.on('error', e => {
    if (!res.headersSent) res.status(500).json({ error: `ffprobe unavailable: ${e.message}` });
  });

  probe.on('exit', () => {
    try {
      const data = JSON.parse(out);
      const streams = (data.streams || []).map(s => ({
        index: s.index,
        type: s.codec_type,
        codec: s.codec_name,
        profile: s.profile,
        level: s.level,
        resolution: s.width ? `${s.width}×${s.height}` : undefined,
        pix_fmt: s.pix_fmt,
        sample_rate: s.sample_rate,
        channels: s.channels,
        channel_layout: s.channel_layout,
        bit_rate: s.bit_rate,
      }));
      res.json({
        file: path.basename(filePath),
        format: data.format?.format_name,
        duration_s: data.format?.duration ? Math.round(data.format.duration) : undefined,
        size_mb: data.format?.size ? (data.format.size / 1048576).toFixed(1) : undefined,
        streams,
        ffprobe_stderr: err.slice(0, 500) || undefined,
      });
    } catch {
      res.status(500).json({ error: 'ffprobe parse failed', stderr: err.slice(0, 500), raw: out.slice(0, 200) });
    }
  });
});

// ─── HLS streaming (Safari) ───────────────────────────────────────────────────
//
// Safari requires HLS for adaptive/live streams. Chrome/Firefox use /video
// (fragmented MP4). These routes use the existing transcoder.js HLS service.

router.get('/hls/:type/:id/manifest.m3u8', authenticate, async (req, res) => {
  const { type, id } = req.params;
  const filePath = getFilePath(type, id);

  if (!filePath) return res.status(404).json({ error: 'Media not found in database' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: `File not found on disk: ${filePath}` });

  const start = Math.max(0, parseFloat(req.query.start || '0') || 0);
  console.log(`[stream] HLS manifest: ${path.basename(filePath)} start=${start}s`);

  try {
    const key = await getHLSSession(filePath, start);
    if (res.writableEnded) return; // client disconnected while transcoding
    const segBase = `/api/stream/hls/${type}/${id}/segment?token=${req.query.token}&key=${key}`;
    const manifest = getManifestContent(key, segBase);
    if (!manifest) return res.status(503).json({ error: 'Manifest not ready' });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(manifest);
  } catch (err) {
    console.error(`[stream] HLS error: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.get('/hls/:type/:id/segment', authenticate, async (req, res) => {
  const { key, seg } = req.query;
  if (!key || !seg) return res.status(400).json({ error: 'Missing key or seg parameter' });

  const segPath = await getSegmentPath(key, seg);
  if (!segPath) return res.status(404).json({ error: 'Segment not found — transcode may have timed out' });

  // fMP4 init segment and .m4s fragments are video/mp4; legacy .ts is video/mp2t
  const contentType = seg.endsWith('.m4s') || seg.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(segPath);
});

module.exports = router;
