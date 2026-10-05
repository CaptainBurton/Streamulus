const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8096;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// When this image was built (written by the Dockerfile) — shows which build is running.
const BUILD_DATE = (() => {
  try { return fs.readFileSync(path.join(__dirname, '../BUILD_DATE'), 'utf8').trim(); } catch { return 'unknown'; }
})();

// Docker health check: answers without touching the database or disk, so it
// only fails if the server itself is down or stuck.
app.get('/api/health', (req, res) => res.json({ ok: true, build: BUILD_DATE }));

// API routes
app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth/quick', require('./routes/quicklogin'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profiles', require('./routes/profiles'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/tv', require('./routes/tv'));
app.use('/api/genres', require('./routes/genres'));
app.use('/api/stream', require('./routes/stream'));
app.use('/api/admin', require('./routes/admin'));

// Serve user-uploaded artwork stored in /data/uploads/
const uploadsDir = path.join(process.env.DATA_DIR || '/data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Serve React frontend in production
const publicDir = path.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  // index.html must never be cached — it references hashed JS/CSS filenames.
  // Without this, browsers (especially Safari) serve stale HTML that loads old bundles.
  app.use(express.static(publicDir, {
    setHeaders(res, filepath) {
      if (path.basename(filepath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`  Streamulus running on port ${PORT}`);
  console.log(`  Image built: ${BUILD_DATE}`);
  console.log(`  Started:     ${new Date().toISOString()}`);

  // Check FFmpeg at startup — result appears immediately in Portainer container logs
  try {
    const ver = execSync('ffmpeg -version 2>&1', { timeout: 5000 }).toString().split('\n')[0];
    console.log(`  FFmpeg: ${ver}`);
  } catch (e) {
    console.error(`  WARNING: FFmpeg not found or failed to run: ${e.message}`);
    console.error(`  Video transcoding will not work until ffmpeg is installed.`);
  }
  console.log(`========================================`);

  // Fix stored file paths left over from a different media mount.
  // then read any missing runtimes (used for "Ends at" times and progress bars).
  require('./services/path-repair').repairAllPaths()
    .catch(err => console.error('[paths] Repair failed:', err.message))
    .then(() => require('./services/durations').fillMissingDurations())
    .catch(err => console.error('[durations] Failed:', err.message));
});
