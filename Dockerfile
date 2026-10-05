# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ .
# Serve hls.js as a plain static asset so it is NOT bundled by Vite/Rollup.
# Bundling hls.js in production breaks it (Worker URL mangling, eval, etc.).
# The script tag in index.html loads it before React, exposing window.Hls.
RUN mkdir -p public && cp node_modules/hls.js/dist/hls.min.js public/
RUN npm run build

# Stage 2: Backend with built frontend
FROM node:20-alpine

WORKDIR /app

# Build tools for better-sqlite3 native addon + ffmpeg for video transcoding.
# Alpine's ffmpeg includes libx264, libx265, libvpx, libopus, libvorbis, AAC, etc.
# chromaprint provides fpcalc, used for audio fingerprint-based intro detection.
# wget is provided by busybox (built into Alpine base — no extra install needed).
RUN apk add --no-cache python3 make g++ ffmpeg chromaprint

# Install backend dependencies (compiles native modules here)
COPY backend/package.json ./
RUN npm install --omit=dev

# Copy backend source
COPY backend/ .

# Copy built frontend into backend's public directory
COPY --from=frontend-builder /app/frontend/dist ./public

# Record when this image was built (after both copies, so a change to either the
# backend or frontend updates it). Printed at startup and by /api/health so you
# can confirm a redeploy is running the new build.
RUN date -u '+%Y-%m-%d %H:%M UTC' > /app/BUILD_DATE

# Create default mount points
RUN mkdir -p /data /movies /tv

EXPOSE 8096

# Lightweight check: BusyBox wget against /api/health (no database or disk work),
# instead of starting a whole Node.js process every 30 s.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -q -T 5 -O /dev/null "http://127.0.0.1:${PORT:-8096}/api/health" || exit 1

CMD ["node", "src/index.js"]
