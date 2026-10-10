<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/streamulus-logo-dark.svg">
    <img src="branding/streamulus-logo-light.svg" alt="Streamulus logo" width="140">
  </picture>
</p>

<h1 align="center">Streamulus</h1>

<p align="center">
  A self-hosted media server with a Netflix-style interface — in the browser, on Apple TV, iPhone and iPad.
</p>

<p align="center">
  <img alt="Docker ready" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white">
  <img alt="Node.js 20" src="https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white">
  <img alt="React 18" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white">
  <img alt="FFmpeg HLS" src="https://img.shields.io/badge/FFmpeg-HLS%20streaming-007808?logo=ffmpeg&logoColor=white">
  <br>
  <img alt="tvOS 26+" src="https://img.shields.io/badge/tvOS-26%2B-000000?logo=apple&logoColor=white">
  <img alt="iOS and iPadOS 26+" src="https://img.shields.io/badge/iOS%20%26%20iPadOS-26%2B-000000?logo=apple&logoColor=white">
  <img alt="SwiftUI Liquid Glass" src="https://img.shields.io/badge/SwiftUI-Liquid%20Glass-F05138?logo=swift&logoColor=white">
  <img alt="Tailscale Funnel friendly" src="https://img.shields.io/badge/Remote%20access-Tailscale%20Funnel-242424?logo=tailscale&logoColor=white">
</p>

## Features

- **Netflix-style UI** — Dark theme, rotating featured banner with title logos, horizontal rows, hover effects
- **Apps** — Native [Apple TV](tv/appletv/README.md) and [iPhone & iPad](mobile/ios/xcode-project/README.md) apps (SwiftUI, Liquid Glass)
- **Profiles** — Netflix-style "Who's watching?", Streamlings (kids profiles) with admin-picked titles, PIN or password lock
- **Profile pictures** — Upload a photo, or choose from picture categories the admin provides (e.g. "The Simpsons"), each set for Streamers, Streamlings or both
- **Quick Login** — Sign a TV or phone in by approving a code from a device that's already signed in
- **Create an account** — On the web or in the iPhone / iPad app (display name + password); an admin approves it with a single-use **Admin Passphrase** that works for 1 hour
- **Movies, TV Shows & Genres** — A–Z libraries, genre pages (incl. Anime), search, "More Like This", cast
- **Streaming** — HLS with smart copy/transcode, buffered progress, Up Next, subtitles (embedded and sidecar files)
- **Metadata** — TMDB / TVDB / IMDb, Fix Match, custom artwork, English titles for foreign-language titles
- **Watch progress** — Resume where you left off, Continue Watching with stills, mark as watched
- **Admin dashboard** — Libraries, users, Streamlings, genres, branding (logo / text), remote access
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

Set where your media lives on the server with two environment variables. In Portainer, add them under the stack's **Environment variables**:

| Variable | Example | Mounted inside the container at |
|---|---|---|
| `TV_PATH` | `/mnt/movies-series/Series` | `/tv` |
| `MOVIES_PATH` | `/mnt/movies-series/Movies` | `/movies` |

In the app, libraries are always `/tv` and `/movies`, whatever the server folders are called.

Also change the secret in `docker-compose.yml`:

```yaml
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
- **Users** — Create and manage user accounts and their profiles; **Account Requests** from people who signed up, with a *Generate Passphrase* button (single use, valid 1 hour)
- **Streamlings** — What kids profiles can watch
- **Profile Pictures** — Categories of pictures profiles can choose from, and who each category / picture is for (Streamers, Streamlings or both)
- **Genres** — Custom artwork for each genre
- **Settings** — Metadata sources and keys, encoding, Up Next, featured movie interval, branding (logo and/or
  STREAMULUS text, custom logo), remote access (public URL), regional settings

---

## Apps and remote access

- **Apple TV** — [`tv/appletv`](tv/appletv/README.md) (tvOS 26+)
- **iPhone & iPad** — [`mobile/ios/xcode-project`](mobile/ios/xcode-project/README.md) (iOS / iPadOS 26+)

Both connect to your server's address. To use them away from home without a VPN, give the server a public
HTTPS address — for example with [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
(`tailscale funnel 8096`) — and enter it in **Admin › Settings › Remote Access**. The apps learn it when they
connect at home and switch to it automatically when the home address doesn't answer. Friends can enter the
public address directly, or you can build it into the iPhone app (see its README).

The logo files live in [`branding/`](branding): the original artwork (`streamulus-logo.png`), light and dark SVGs
and the app icon.

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
│   ├── public/       # Favicons, logo
│   └── src/
│       ├── pages/    # Setup, Login, Home, Movies, TV, Genres, Watch, Admin
│       └── components/
├── tv/appletv/       # Apple TV app (Xcode project)
├── mobile/ios/xcode-project/  # iPhone & iPad app (Xcode project, self-contained;
│                              #   Streamulus/Shared is also used by the Apple TV app)
├── branding/         # Logo (PNG, light/dark SVG) and app icon
├── Dockerfile        # Multi-stage build
└── docker-compose.yml
```
