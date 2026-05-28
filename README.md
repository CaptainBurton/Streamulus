# Streamulus

A self-hosted media server with a Netflix-style interface. Stream your movies and TV shows from anywhere.

## Features

- **Netflix-style UI** — Dark theme, hero banner, horizontal scrolling rows, hover effects
- **Setup wizard** — 5-step guided first-run setup
- **TMDB integration** — Automatic metadata, posters, backdrops, and ratings
- **Movies & TV Shows** — Full library browsing with search and sort
- **Video streaming** — HTTP range request streaming with seek support
- **Watch progress** — Resume where you left off
- **Admin dashboard** — Manage libraries, users, and settings
- **Multi-user** — Admin and user roles
- **Docker-ready** — Single container, deployable via Portainer

---

## Quick Start with Portainer

### Method 1: Stack from Git Repository

1. In Portainer, go to **Stacks → Add Stack**
2. Choose **Repository**
3. Set **Repository URL** to: `https://github.com/captainburton/streamulus`
4. Set **Compose path** to: `docker-compose.yml`
5. Edit the environment variables and volume paths (see below)
6. Click **Deploy the stack**

### Method 2: Manual docker-compose

```bash
git clone https://github.com/captainburton/streamulus.git
cd streamulus

# Edit docker-compose.yml to set your media paths and JWT_SECRET
docker compose up -d
```

Then open `http://your-server-ip:8096` and complete the setup wizard.

---

## Configuration

Edit `docker-compose.yml` before deploying:

```yaml
volumes:
  - /your/actual/movies/path:/movies   # change this
  - /your/actual/tv/path:/tv           # change this

environment:
  - JWT_SECRET=your-strong-random-secret-here  # change this!
```

---

## First-Run Setup

On first launch, you'll be guided through a 5-step wizard:

1. **Welcome** — Overview of setup
2. **Media Folders** — Enter `/movies` and/or `/tv` (matching your Docker volume mounts)
3. **Admin Account** — Create your admin username and password
4. **Metadata** — Optionally add a TMDB API key for artwork and metadata
5. **Done** — A background scan starts automatically

### Getting a TMDB API Key (Free)

1. Create an account at [themoviedb.org](https://www.themoviedb.org)
2. Go to **Settings → API**
3. Request a **Developer** API key
4. Copy the **v3 auth key** and paste it in the setup wizard

---

## Media Naming Conventions

For best metadata matching:

**Movies:**
```
Movie Title (2023).mkv
The Dark Knight (2008).mp4
Inception.2010.mkv
```

**TV Shows:**
```
Show Name/Show Name S01E01.mkv
Breaking Bad/Breaking.Bad.S05E14.mkv
Game of Thrones/Game of Thrones - 1x01 - Winter Is Coming.mkv
```

---

## Supported Formats

`.mp4` `.mkv` `.avi` `.mov` `.wmv` `.flv` `.webm` `.m4v` `.ts` `.m2ts`

> **Note:** Browser playback depends on your browser. H.264/MP4 and WebM have the widest support.

---

## Ports

| Port | Service |
|------|---------|
| 8096 | Streamulus web interface |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8096` | Web server port |
| `DATA_DIR` | `/data` | Database and config storage |
| `JWT_SECRET` | *(insecure default)* | Secret for JWT tokens — **change this!** |
| `NODE_ENV` | `production` | Environment mode |

---

## Admin Panel

Access at `/admin` (admin users only):

- **Overview** — Stats and media scan trigger
- **Libraries** — Add/remove media library paths
- **Users** — Create and manage user accounts
- **Settings** — Update TMDB API key

---

## Architecture

```
streamulus/
├── backend/          # Node.js + Express API server
│   └── src/
│       ├── database/ # SQLite via better-sqlite3
│       ├── routes/   # API endpoints
│       ├── services/ # TMDB + file scanner
│       └── middleware/
├── frontend/         # React + Vite
│   └── src/
│       ├── pages/    # Setup, Login, Home, Movies, TV, Watch, Admin
│       └── components/
├── Dockerfile        # Multi-stage build
└── docker-compose.yml
```
