# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Stage 2: Backend with built frontend
FROM node:20-slim

WORKDIR /app

# Build tools for better-sqlite3 native addon + ffmpeg (Debian package has full codec coverage:
# H.264, H.265/HEVC, VP9, AV1, AC3, DTS, FLAC, Opus, etc. — same breadth as Plex)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 make g++ build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies (compiles native modules here)
COPY backend/package.json ./
RUN npm install --omit=dev

# Copy backend source
COPY backend/ .

# Copy built frontend into backend's public directory
COPY --from=frontend-builder /app/frontend/dist ./public

# Create default mount points
RUN mkdir -p /data /movies /tv

EXPOSE 8096

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD node -e "require('http').get('http://localhost:8096/api/setup/status',r=>{process.exit(r.statusCode<500?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
