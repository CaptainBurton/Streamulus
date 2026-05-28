# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Backend with built frontend
FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --production

# Copy backend source
COPY backend/ .

# Copy built frontend into backend's public directory
COPY --from=frontend-builder /app/frontend/dist ./public

# Create data directory
RUN mkdir -p /data /movies /tv

EXPOSE 8096

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8096/api/setup/status || exit 1

CMD ["node", "src/index.js"]
