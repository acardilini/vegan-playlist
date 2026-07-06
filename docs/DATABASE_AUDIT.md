# Database Audit — Session 0.2 (Phase 0)

_Compiled 2026-07-07 from read-only queries against the live PostgreSQL database, compared
with `backend/database/schema.sql` and the six add-on SQL files._

## Headline findings

1. **The curated dataset is NOT in this database.** Every curatorial field is empty across
   all 1,208 songs: `vegan_focus`, `animal_category`, `advocacy_style`, `advocacy_issues`,
   `lyrical_explicitness`, `your_review`, `rating`, `inclusion_notes` — **all zero rows**.
   The database is a Spotify playlist mirror enriched with 671 YouTube videos, 10 lyrics
   links, 654 mood tags, and 493 genre tags. The 7 years of curation lives in the curator's
   external files (the "messy song lists"). **This reshapes Phase 1: the truth source must be
   built by importing curatorial data, not by protecting what's in the DB.**

2. **The 1,208-vs-~650 mystery is solved — it's two bulk imports:**

   | When (`created_at`) | Rows | Notes |
   |---|---|---|
   | 2025-07-22 | 632 | Original import; these (plus the next two) carry `playlist_added_at` (674 total) and `custom_mood` (654) |
   | 2025-07-30 | 22 | Top-up sync |
   | 2025-08-21 | 20 | Top-up sync |
   | 2026-04-06 | 534 | Second bulk import — **no** `playlist_added_at`, no mood, sparse genres |

   674 + 534 = 1,208. The April 2026 batch is likely either (a) a `sync-spotify-playlist`
   run after the Spotify playlist grew by ~534 tracks, or (b) an import of the
   newly-identified songs list. **⚑ curator to confirm** which — it decides whether these
   534 are already "curated in" or still pending review.

3. **Heavy historic churn:** the `songs` id sequence is at 5,195 but only 1,208 rows remain —
   roughly 4,000 rows have been inserted and deleted over the project's life. Ids in the
   duplicate pairs below show the same song existing once from the 2025 import (low id) and
   once from the 2026 import (id ≥ ~4,600).

4. **No audio features anywhere.** `energy`, `tempo`, `acousticness`, etc. are NULL for all
   1,208 songs, and `preview_url` is empty for all songs (Spotify removed both from its API
   for apps like ours in Nov 2024 — they cannot be backfilled from Spotify). The Song Detail
   "Audio Characteristics" panel and the Dashboard audio-features chart therefore never render
   data. Decide in Session 0.3/0.4 whether to drop these UI elements or source features
   elsewhere (e.g. the empty `manual_audio_features` table was built for exactly this).

## Live schema vs. the SQL files

The live `songs` table has **51 columns**; `schema.sql` defines 23. The drift got there via
the six add-on files **plus changes that exist in no file** (applied by scripts or HTTP-DDL):

- **In no SQL file:** audio-feature columns (`energy`, `danceability`, `valence`,
  `acousticness`, `instrumentalness`, `liveness`, `speechiness`, `tempo`, `loudness`, `key`,
  `mode`, `time_signature`), `custom_mood`, `genre`, `parent_genre`, `track_number`,
  `disc_number`, `available_markets`, `playlist_added_at`, `playlist_added_by`,
  `manual_song_id`; on `albums`: `album_type`, `label`; on `artists`:
  `discography_reviewed`, `discography_reviewed_date`, `discography_review_notes`; plus the
  `manual_audio_features` and `protected_fields` tables and the
  `songs_with_manual_categories` view.
- `database/migrations/` is **empty** — `runMigration.js` has nothing tracked.
- Phase 2 should snapshot the live schema (`pg_dump --schema-only`) as the new baseline
  `schema.sql` and adopt migration files from there.

**Live tables (15) + 2 views:** songs (1,208) · artists (558) · albums (721) · song_artists ·
youtube_videos (671) · playlists (1) · playlist_songs (1) · song_submissions (0) ·
categories (0) · song_categories (0) · manual_songs (0) · manual_categorizations (0) ·
manual_audio_features (0) · spotify_update_log (0) · protected_fields (0) · views
`removed_playlist_songs`, `songs_with_manual_categories`.

## Data coverage (1,208 songs, all `data_source='spotify'`, none flagged removed)

| Field | Populated | Notes |
|---|---|---|
| Spotify basics (title, spotify_id, album, artists, duration, urls) | 1,208 | Complete; spotify_id unique — no dup ids |
| `custom_mood` | 654 | Only the 2025 import batch (script-derived) |
| `genre` / `parent_genre` (song-level) | 493 | Only part of the 2025 batch |
| `playlist_added_at` | 674 | 2025 batches only; earliest add 2017-12-16, latest 2025-08-12 |
| YouTube video (1 per song, all "official/primary") | 671 | The most complete enrichment |
| `lyrics_url` / `lyrics_highlights` | 10 / 7 | Curator has many more in external lists (Phase 1 import) |
| `featured` | 2 | Homepage pinning |
| `explicit` | 348 | From Spotify |
| `popularity` > 0 | 817 | From Spotify |
| Artist `genres` | 218 of 558 | Spotify only tags established artists |
| **All curatorial fields** | **0** | See headline finding 1 |
| Audio features, `preview_url` | 0 | See headline finding 4 |

## Duplicates

- **18 true duplicate pairs** (same title + same artist set, different Spotify IDs — e.g.
  album vs compilation release): A Better Way/Ecostrike (183, 4873) · Biomachines/Earth
  Crisis (499, 5184) · Forced Diet Reassignment/To the Grave (5022, 5176) · In the Embrace of
  Truth/Arkangel (199, 4731) · Liberation Not Experimentation/ALS (4706, 4707) · Long Distance
  Runner/Promoe (2591, 4972) · Meat Is Murder/Diegojah (2584, 4854) · Meat Means
  Murder/Conflict (137, 1290) · Mindless Human Consumption/Mass Extinction (4940, 5175) · New
  Ethic/Earth Crisis (1334, 4871) · Plant Deh Vegetables/Joseph Cotton (2592, 5155) · Prey to
  Human Silence/One King Down (78, 4960) · Sawed Off/To the Grave (5032, 5043) · Terrorist
  Threat/To the Grave (187, 5037) · The Devil Is Near/Architects (213, 4725) · This Is the
  A.L.F./Conflict (177, 4819) · Total Liberation/Gather (41, 4920) · Tough Shit
  Mickey/Conflict (1549, 4820). Most pair a 2025-import id with a 2026-import id.
  **De-dup in Session 1.1** (pick canonical release, merge enrichment, delete the other).
- 57 same-title groups exist beyond these, but they are different songs that share a name
  ("Vegan" ×11, "Animal Liberation" ×8...) — not duplicates.

## Integrity

- 0 songs without artists; 0 songs without an album.
- 2 orphan artists (Queen V, Flaex) and 14 orphan albums — harmless leftovers from
  deletions; clean up in Session 1.3.
- FKs with `ON DELETE CASCADE` protect the join tables; `song_submissions.existing_song_id`
  uses `SET NULL`. No dangling references found.

## Built-but-unused infrastructure

`categories`/`song_categories`, `manual_songs`, `manual_categorizations`,
`manual_audio_features`, `spotify_update_log`, `protected_fields`, artist discography-review
columns, the playlists feature (1 playlist, 1 song) — all effectively empty. The Phase 0.4
truth-source design should decide which of these earn a place (the manual-override/protected
pattern is a promising skeleton for "Spotify never overwrites curation") and which get
dropped as YAGNI.

## Open questions for the curator — ANSWERED 2026-07-07

1. The 2026-04-06 batch of 534 songs is a **vetted batch of new songs** (the Spotify playlist
   grew; Session 0.3 confirmed the live playlist has 1,216 tracks). They were imported by
   `simpleSyncSpotify.js` without album art/dates or artist genres — backfill queued for
   Phase 1 (see `SPOTIFY_API_AUDIT.md` §6).
2. The curatorial coding lives in **a couple of spreadsheets** — Phase 1's import will be
   designed around them (get them into a known location before Session 1.1).
3. Mood/genre tags are **regenerable enrichment**, not curation — a more robust generation
   approach is future work.
4. **Drop audio features** — remove the UI panels and analytics endpoint (Phase 2/3).
