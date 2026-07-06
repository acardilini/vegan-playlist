# Spotify API Audit — Session 0.3 (Phase 0)

_Compiled 2026-07-07. Method: read the import/sync code paths, then exercised the live
Spotify Web API with the app's own credentials (read-only calls). One code fix shipped this
session (wrong default playlist ID — see §4)._

## 1. Headlines

1. **Album covers are still fully available from Spotify — the missing covers are our bug.**
   Live tests confirm every relevant endpoint (playlist tracks, single track, search) returns
   `album.images` in three sizes. The covers are missing because the April 2026 sync
   (`scripts/simpleSyncSpotify.js`) inserts albums with *name + spotify_id only* — no images,
   release_date, album_type, or label. Result in the DB: all 674 songs from the 2025 imports
   have artwork; **450 of the 534 April songs don't** (275 bare albums). Same story for the
   sync-created artists (no genres/images → only 218/558 artists have genres, 313/558 images).
   **All of it is backfillable** because the spotify_ids were saved (§6).

2. **Confirmed dead for this app** (tested live, and Spotify removed them for apps registered
   after Nov 27 2024): audio features (`403`), recommendations (`404`), related artists
   (`404`), and 30-second `preview_url` (returns `null` everywhere, including search). Matches
   the curator's decision to **drop the audio-features UI** and the 0.2 finding that these
   columns are all NULL.

3. **The live playlist is "Animal Lib & Vegan Songs" (owner: Jessica Moore), 1,216 tracks.**
   The DB holds 1,208 — 8 tracks behind. The April 2026 batch was a sync of this playlist
   after it grew, which the curator confirms is a vetted batch.

## 2. Auth & credentials

- **Flow:** client-credentials grant (`spotify-web-api-node`), token valid 3600 s. Public
  data only — sufficient for everything the app does (no user-scoped features).
- Credentials live in `backend/.env` (`SPOTIFY_CLIENT_ID`/`SECRET`); grant verified working.
- Tokens are requested per call-site; there's no shared token cache (fine at our volume;
  tidy in Phase 2 if convenient).

## 3. What each code path pulls (and drops)

| Field from Spotify | `importSpotifyDataEnhanced.js` (2025 import) | `simpleSyncSpotify.js` (Apr 2026) | `/api/admin/sync-spotify-playlist` |
|---|---|---|---|
| Track: id, title, duration, popularity, url, explicit | ✅ | ✅ | ✅ |
| Track: `playlist_added_at` | ✅ | ❌ | ⚠ set to *now*, not the playlist's real `added_at` |
| Album: spotify_id | ✅ | ✅ | ❌ (name only) |
| Album: **images**, release_date, type, label | ✅ | ❌ | ❌ |
| Artist: spotify_id | ✅ | ✅ | ❌ (name only) |
| Artist: genres, images, followers, popularity | ✅ | ❌ | ❌ |

The enhanced import is the only complete path. The Phase 1 enrichment pipeline should be the
single replacement for all three (fetch track + full album + full artist, batched).

## 4. Fix shipped this session: wrong default playlist ID

`/api/admin/sync-spotify-playlist` and `/api/admin/spotify-playlist-mismatch` defaulted to
playlist `0vvXsWCC9xrXsKd4FyS8kM`, which is **"Lofi Girl — beats to relax/study to"** (500
tracks), not the vegan playlist. The admin Duplicate Manager's "Sync" button posts an empty
body, so one click would have imported ~500 lofi tracks and flagged the entire vegan catalogue
as "removed from playlist". It had never been run (0 removed flags, no lofi rows). Both
defaults now point at the verified vegan playlist `5hVygGomw9zax38quC6mhi`. (The standalone
scripts always had the correct ID; the sync endpoint is still slated for a Phase 1 rebuild.)
Smoke test: server reloads clean, routes respond; the sync itself was deliberately not run.

## 5. What the API still offers (tested where noted)

- **Playlists:** metadata + paged tracks (100/page) incl. full album objects with images and
  each item's real `added_at` ✅ tested.
- **Tracks:** single + batch (50/call) ✅ tested; `available_markets`, `track_number`, etc.
- **Artists:** single + batch (50/call) with genres, images, follower counts ✅ tested.
- **Albums:** single + batch (20/call) with images, release dates, label.
- **Search** (tracks/artists/albums) ✅ tested.
- **Rate limits:** not published; enforced on a rolling ~30 s window per app, `429` +
  `Retry-After` on excess. Our batch sizes (≤1,216 tracks → ~25 playlist pages, ~28 artist
  batches) are trivial; just honour `Retry-After` and batch endpoints in the pipeline.
- **Gone for this app:** audio features/analysis, recommendations, related artists, preview
  URLs (all verified failing live).

## 6. Backfill opportunity (queue for Phase 1)

The 534 April songs (275 albums, ~245 artists) have spotify_ids, so one enrichment run can
restore covers, release dates, genres, and images via the batch endpoints (~40 API calls
total). This also fixes the 275 dateless albums that are invisible to year filters/analytics,
and closes the 8-track gap to the live playlist.

## 7. Truth vs. enrichment (input to Session 0.4)

Per the curator's decisions (2026-07-07):

| Class | Fields | Rule |
|---|---|---|
| **Truth (curator-owned)** | song's existence in the catalogue, categorisations (`vegan_focus`, `animal_category`, `advocacy_style`, `advocacy_issues`, `lyrical_explicitness`), `your_review`, `rating`, `inclusion_notes`, lyrics links/highlights, featured | Lives in the curator's spreadsheets today; imported in Phase 1; **never** written by any sync |
| **Enrichment (Spotify-owned)** | spotify ids/urls, duration, popularity, explicit, album (name/images/date/type/label), artist (genres/images/followers), `playlist_added_at` | Refreshable any time; sync may overwrite freely |
| **Regenerable enrichment (derived)** | `custom_mood`, song `genre`/`parent_genre` | Script-derived; rebuild when a more robust approach lands (curator decision) — don't treat as curation |
| **Dropped** | audio features (12 columns), `preview_url`, `manual_audio_features` table | No data, no API source; remove UI panels + analytics endpoint (Phase 2/3) |
