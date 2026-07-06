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
| `removed_from_playlist` | Flag set when song leaves the Spotify playlist |

---

## Updating the Database from Spotify

The Spotify playlist is the source of truth. When it changes, sync it to the database.

### Sync new/updated songs

```bash
cd backend
node scripts/simpleSyncSpotify.js
```

This fetches all tracks from the playlist (paginated, handles 1000+ songs), inserts new ones, and skips existing songs. Safe to run repeatedly — it uses `ON CONFLICT DO NOTHING`.

### Full duplicate management workflow

Use this when you've removed duplicate songs from the Spotify playlist and want to clean them out of the database:

1. **Find duplicates** — Admin > Cleanup > "Find Duplicates"
2. **Remove from Spotify** — delete the unwanted duplicates from the Spotify playlist manually
3. **Sync the playlist** — pulls the updated playlist into the database:
   ```bash
   node scripts/simpleSyncSpotify.js
   ```
4. **Flag removed songs** — marks any songs no longer in the playlist:
   ```bash
   node scripts/flagRemovedSongs.js
   ```
5. **Preview what will be deleted** (optional):
   ```bash
   node scripts/showRemovedSongs.js
   ```
6. **Delete from database** — Admin > Cleanup > "Removed from Playlist"
7. **Verify** — Admin > Cleanup > "Find Duplicates" to confirm clean state

### Important notes

- **Run these in a bash shell, not PowerShell.** PowerShell does not support `&&`. Either run the commands separately, or use Claude Code's terminal which runs bash.
- The sync script requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `backend/.env`.
- Songs with `data_source = 'spotify'` must have a `spotify_id` — this is enforced by a database constraint. The sync script handles this automatically.

---

## Admin Workflows

Navigate to `/admin` in the running app. Key sections:

| Section | What you can do |
|---------|----------------|
| **Bulk Edit** | Select multiple songs and edit categorization fields in bulk |
| **Categorization** | Step through uncategorized songs and assign vegan focus, advocacy style etc. |
| **YouTube Videos** | Add/edit YouTube video links per song |
| **Lyrics** | Add external lyrics URLs (Genius, Bandcamp etc.) |
| **Submissions** | Review public song submissions — approve, reject, or mark resolved |
| **Cleanup > Find Duplicates** | Identify duplicate songs by title/artist |
| **Cleanup > Removed from Playlist** | View and permanently delete songs flagged as removed |
| **Data Dashboard** | See completion stats — how many songs have categorization, lyrics, YouTube videos |

---

## Backend Scripts Reference

All scripts are in `backend/scripts/`. Run with `node scripts/<filename>.js` from the `backend/` directory.

### Database sync

| Script | Purpose |
|--------|---------|
| `simpleSyncSpotify.js` | **Primary sync script.** Fetches full playlist from Spotify, adds new songs. Safe to re-run. |
| `flagRemovedSongs.js` | Compares database against live Spotify playlist, flags songs no longer present. |
| `showRemovedSongs.js` | Prints songs currently flagged as removed — preview before deleting. |

### Database inspection

| Script | Purpose |
|--------|---------|
| `auditDatabase.js` | Full audit — counts, missing data, inconsistencies |
| `checkSchema.js` | Verifies expected columns and constraints exist |
| `checkMissingSongs.js` | Finds songs in DB missing key metadata |
| `exportAllSongsData.js` | Exports full song dataset to JSON/CSV |
| `createDataSummary.js` | Generates a human-readable data summary |

### Genre / categorization

| Script | Purpose |
|--------|---------|
| `migrateGenres.js` | Migrates old genre data to current schema |
| `checkGenreMappings.js` | Audits genre mapping completeness |
| `fixGenreMappings.js` | Fixes known bad genre mappings |
| `addCustomMoodData.js` | Adds mood/vibe categorization data |

### Setup / migrations

| Script | Purpose |
|--------|---------|
| `addFeaturedField.js` | Adds `featured` boolean to songs table |
| `addLyricsFields.js` | Adds lyrics URL columns (covered by `lyrics_schema_update.sql`) |
| `setupLyrics.js` | Initialises lyrics data |
| `setupSubmissions.js` | Initialises submissions table |
| `createYouTubeTable.js` | Creates YouTube videos table (covered by `youtube_videos_schema.sql`) |
| `runMigration.js` | Generic migration runner |

---

## Coming Back After a Break

Quick checklist to get back up to speed:

- [ ] Start PostgreSQL
- [ ] Start backend: `cd backend && npm run dev`
- [ ] Start frontend: `cd frontend && npm run dev`
- [ ] Check current DB stats by visiting `/dashboard` in the app
- [ ] Sync from Spotify to pick up any new playlist additions:
  ```bash
  cd backend && node scripts/simpleSyncSpotify.js
  ```
- [ ] Review any pending song submissions at `/admin` > Submissions
- [ ] Check data completion at `/dashboard` — how many songs still need categorization, lyrics, YouTube videos
