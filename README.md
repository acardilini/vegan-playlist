# Vegan Playlist

A web-based resource for vegan-themed music. Curated database of songs sourced from a Spotify playlist, with categorization, YouTube video links, lyrics references, and an admin interface for ongoing curation.

**Current database (as of last sync):** ~1,208 songs · 558 artists · 721 albums · 671 YouTube videos

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Environment Variables](#environment-variables)
4. [Database Schema](#database-schema)
5. [Updating the Database from Spotify](#updating-the-database-from-spotify)
6. [Admin Workflows](#admin-workflows)
7. [Backend Scripts Reference](#backend-scripts-reference)
8. [Coming Back After a Break](#coming-back-after-a-break)

---

## Quick Start

**Prerequisites:** Node.js, PostgreSQL running, Spotify API credentials

### Easiest: launcher scripts (Windows)

Double-click **`start-vegan-playlist.bat`** in the repo root — it opens the backend and
frontend in their own log windows and opens the site in your browser. Double-click
**`stop-vegan-playlist.bat`** to stop everything (it kills whatever is listening on ports
5000 and 5173). Running start twice is safe; already-running servers are skipped.

### Manual: 1. Backend

```bash
cd backend
npm install
npm run dev        # runs on http://localhost:5000
```

### Manual: 2. Frontend

```bash
cd frontend
npm install
npm run dev        # runs on http://localhost:5173
```

The frontend proxies API calls to the backend at `http://localhost:5000/api`.

---

## Architecture

```
vegan-playlist/
├── backend/
│   ├── server.js                  # Express entry point
│   ├── routes/
│   │   ├── spotify.js             # Song/artist/album queries + Spotify API
│   │   ├── admin.js               # Admin CRUD operations
│   │   ├── youtube.js             # YouTube video management
│   │   ├── lyrics.js              # Lyrics URL management
│   │   ├── submissions.js         # User song submissions
│   │   ├── analytics.js           # Stats and data dashboard
│   │   └── playlists.js           # Playlist management
│   ├── database/
│   │   ├── db.js                  # PostgreSQL connection pool
│   │   ├── schema.sql             # Core tables (run first)
│   │   ├── manual_additions_schema.sql  # Manual entry support + constraints
│   │   ├── youtube_videos_schema.sql    # YouTube videos table
│   │   ├── lyrics_schema_update.sql     # Lyrics URL fields
│   │   ├── song_submissions_schema.sql  # User submissions table
│   │   └── playlist_sync_schema.sql     # Removed-song tracking
│   └── scripts/                   # One-off and maintenance scripts
└── frontend/
    └── src/
        ├── App.jsx                # Router + all page components
        ├── api/spotifyService.js  # API client
        └── components/            # Individual UI components
```

### Frontend Routes

| Path | Page |
|------|------|
| `/` | Home — featured songs, stats |
| `/search` | Search and filter all songs |
| `/song/:id` | Song detail with YouTube embed |
| `/artists` | Artist search and browse |
| `/artist/:id` | Artist detail with discography |
| `/playlists` | Playlist browser |
| `/submit` | Public song submission form |
| `/dashboard` | Data completion dashboard |
| `/admin` | Admin interface (curation tools) |
| `/about` | About page |

### Backend API Routes

| Prefix | Purpose |
|--------|---------|
| `/api/spotify` | Songs, artists, albums, search, featured |
| `/api/admin` | Bulk edit, categorization, cleanup |
| `/api/youtube` | YouTube video CRUD |
| `/api/lyrics` | Lyrics URL management |
| `/api/submissions` | Song submission review |
| `/api/analytics` | Stats, data completion metrics |
| `/api/playlists` | Playlist CRUD |

---

## Environment Variables

Create `backend/.env` with the following:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
DATABASE_URL=your_postgresql_connection_string
PORT=5000
```

Get Spotify credentials from: https://developer.spotify.com/dashboard

---

## Database Schema

### Setup Order

Run the SQL files in this order against your PostgreSQL database:

```
1. backend/database/schema.sql                  # Core tables
2. backend/database/manual_additions_schema.sql  # Manual entry support
3. backend/database/youtube_videos_schema.sql    # YouTube videos
4. backend/database/lyrics_schema_update.sql     # Lyrics fields
5. backend/database/song_submissions_schema.sql  # Submissions
6. backend/database/playlist_sync_schema.sql     # Removed-song tracking
```

### Core Tables

| Table | Description |
|-------|-------------|
| `songs` | Core song records — title, Spotify metadata, categorization fields, lyrics URL |
| `artists` | Artist records with Spotify metadata and bio |
| `albums` | Album records linked to songs |
| `song_artists` | Many-to-many: songs ↔ artists |
| `youtube_videos` | YouTube video associations per song (one primary per song) |
| `song_submissions` | Public submissions for new songs (status: pending/approved/rejected) |
| `playlists` | User-created playlists |
| `playlist_songs` | Many-to-many: playlists ↔ songs |
| `manual_categorizations` | Manual category overrides that take precedence over Spotify data |
| `spotify_update_log` | Audit trail for all Spotify sync operations |

### Key Fields on `songs`

| Field | Purpose |
|-------|---------|
| `spotify_id` | Unique Spotify track ID |
| `data_source` | `'spotify'` or `'manual'` |
| `vegan_focus` | TEXT[] — e.g. `['animals', 'environment', 'health']` |
| `animal_category` | TEXT[] — e.g. `['farm_animals', 'wild_animals']` |
| `advocacy_style` | TEXT[] — e.g. `['direct', 'educational', 'subtle']` |
| `advocacy_issues` | TEXT[] — e.g. `['vivisection', 'eating_animals']` |
| `lyrical_explicitness` | TEXT[] — e.g. `['confrontational', 'subtle']` |
| `rating` | Integer 1–5 |
| `your_review` | Personal review text |
| `lyrics_url` | External link to lyrics (Genius, Bandcamp etc.) |

---

## Updating the Database from Spotify

**The database is the source of truth** (a song is in the catalogue because the curator says so — see `docs/TRUTH_SOURCE_DESIGN.md`). Spotify is optional enrichment and the sync is **import-only**: playlist tracks missing from the catalogue are added as `pending` for curator review; nothing is ever auto-removed or overwritten.

Two ways to sync:

- **Admin UI (usual way):** Admin > Staging > Add candidates > "Sync from playlist" (or "Check playlist mismatch" for a read-only report first). New tracks land in the To-process queue.
- **Script (bulk enrichment):** `cd backend && node scripts/enrichFromSpotify.js` — dry-run by default; add `--apply` to write. Also backfills album art, artist genres, and Spotify attachments for manual songs. See `backend/scripts/README.md`.

### Important notes

- Both paths require `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `backend/.env`.
- Songs with `data_source = 'spotify'` must have a `spotify_id` — enforced by a database constraint; the sync handles this automatically.
- Duplicates are handled in Admin > Cleanup > "Find Duplicates" (data-quality only — no playlist-removal workflow; the old flag-removed scripts are gone).

---

## Admin Workflows

Navigate to `/admin` in the running app. Key sections:

| Section | What you can do |
|---------|----------------|
| **Bulk Edit** | Select multiple songs and edit categorization fields in bulk |
| **Categorization** | Step through uncategorized songs and assign vegan focus, advocacy style etc. |
| **YouTube Videos** | Add/edit YouTube video links per song |
| **Lyrics** | Add external lyrics URLs (Genius, Bandcamp etc.) |
| **Submissions** | Review public song submissions — approve & add to the pending queue, reject, or mark resolved |
| **Staging** | Work the publication queues (To process / To finalise / Live) and import new songs (Add candidates / Sync from playlist) |
| **Cleanup > Find Duplicates** | Identify duplicate songs by title/artist |
| **Data Dashboard** | See completion stats — how many songs have categorization, lyrics, YouTube videos |

---

## Backend Scripts Reference

Four maintenance scripts live in `backend/scripts/` — see [`backend/scripts/README.md`](backend/scripts/README.md) for full usage. Run with `node scripts/<filename>.js` from the `backend/` directory.

| Script | Purpose |
|--------|---------|
| `consolidateSpreadsheets.js` | Truth-source import from the curator's spreadsheets (idempotent, dry-run by default) |
| `enrichFromSpotify.js` | Spotify enrichment pipeline + import-only playlist diff (dry-run by default) |
| `auditDatabase.js` | Read-only field-completion audit |
| `exportAllSongsData.js` | Read-only CSV export of the full song dataset |

Schema changes are SQL files in `backend/database/migrations/`, applied with psql. The ~37 one-off setup/debug/test scripts that used to live here were removed in Session 2.3 (git history preserves them).

---

## Coming Back After a Break

Quick checklist to get back up to speed:

- [ ] Start PostgreSQL
- [ ] Start backend: `cd backend && npm run dev`
- [ ] Start frontend: `cd frontend && npm run dev`
- [ ] Check current DB stats by visiting `/dashboard` in the app
- [ ] Pick up any new playlist additions: Admin > Staging > Add candidates > "Sync from playlist" (import-only — new tracks land in the To-process queue)
- [ ] Review any pending song submissions at `/admin` > Submissions
- [ ] Check data completion at `/dashboard` — how many songs still need categorization, lyrics, YouTube videos
