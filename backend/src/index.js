const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8096;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// API routes
app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/tv', require('./routes/tv'));
app.use('/api/stream', require('./routes/stream'));
app.use('/api/admin', require('./routes/admin'));

// Serve React frontend in production
const publicDir = path.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`  Streamulus running on port ${PORT}`);
  console.log(`  Build date: ${new Date().toISOString()}`);

  // Check FFmpeg at startup — result appears immediately in Portainer container logs
  try {
    const ver = execSync('ffmpeg -version 2>&1', { timeout: 5000 }).toString().split('\n')[0];
    console.log(`  FFmpeg: ${ver}`);
  } catch (e) {
    console.error(`  WARNING: FFmpeg not found or failed to run: ${e.message}`);
    console.error(`  Video transcoding will not work until ffmpeg is installed.`);
  }
  console.log(`========================================`);
});
