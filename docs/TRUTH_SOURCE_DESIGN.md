# Truth-Source & Playlist-Management Design — Session 0.4 (Phase 0)

_Designed with the curator 2026-07-07 and approved. This is the decision record that closes
Phase 0 and the spec that drives Phase 1._

> **Addendum (Session 1.2b, 2026-07-07):** a `published` flag now sits alongside `status` —
> the public site shows `status='included' AND published=true`, and publishing is an
> explicit curator action. See [`PUBLICATION_STAGING_DESIGN.md`](./PUBLICATION_STAGING_DESIGN.md).

## The model in one paragraph

**A song is in the catalogue because the curator says so.** The `songs` table becomes the
authoritative catalogue with a curator-owned `status` (`pending` → `included` / `rejected`).
Spotify is optional enrichment attached to a song, never the reason it exists — and the sync
direction is **import-only** (the website reports differences with the Spotify playlist; the
curator updates Spotify by hand if desired). Songs that aren't on Spotify are first-class
citizens with Bandcamp / YouTube / SoundCloud links. Full lyrics are stored **locally only**
for analysis and are never committed to git, served by the API, or migrated to production.

## Source spreadsheets (gitignored at `docs/playlist/` — contain lyrics)

| File | Rows | Meaning (per curator) |
|---|---|---|
| `playlist_with_lyrics_processed.xlsx` | 711 | Existing playlist songs. `Status="✅ Valid"` (318): Lyrics URL + full lyrics are good. `Status="?"` (393): lyrics not found; the Lyrics URL is a junk search link — **discard**. |
| `missing_from_playlist_processed_song_list_hybrid_with_lyrics.xlsx` | 1,013 | Candidates. `Processed` starting with `1` (574) = include (variants note "not on spotify" etc.). `0` (256) = reject. `Can't find lyrics` (123) and `?` (56) = **still pending review**. `URL`/`Scraped Lyrics` where present. |

Overlap measured 2026-07-07 (normalised artist+title): file 1 matches the DB 659 exact + 45
title-only + 7 unmatched; of file 2's includes, 382 are already in the DB and **192 are new**;
only 2–4 of the pending/reject rows are in the DB; 65 rows appear in both files.

## Curator decisions (2026-07-07)

1. `Can't find lyrics` rows = **pending review** (inclusion undecided), not included/excluded.
2. All undecided rows (`?`, can't-find) **are imported** as an explicit pending queue to be
   processed in the website — the spreadsheets retire.
3. Full lyrics live in a **local-only DB table** (`song_lyrics`), joinable for analysis.
4. Junk/search-page URLs are **discarded** on import.
5. Rejected candidates (256) **are imported as `rejected`** so nothing re-surfaces them.
6. Relationship to Spotify playlist: **website is master, import-only** diff reporting.
   Push-to-Spotify (OAuth) is deferred — could be added later.
7. Non-Spotify platforms to support: **Bandcamp, YouTube, SoundCloud**.
8. Add/process flow must include **categorisation at add-time**, **bulk candidate intake**
   (paste artist+title lists → pending queue), and **lyrics-hunting helpers** (search links +
   recorded not-found status).

## Data model changes (all additive; approach: extend existing `songs` table)

```sql
ALTER TABLE songs ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'included'
  CHECK (status IN ('pending','included','rejected'));   -- existing 1,208 rows are included
ALTER TABLE songs ADD COLUMN status_notes TEXT;           -- e.g. 'not on spotify', reject reason
ALTER TABLE songs ADD COLUMN lyrics_status VARCHAR(20) NOT NULL DEFAULT 'not_searched'
  CHECK (lyrics_status IN ('found','not_found','not_searched'));
ALTER TABLE songs ADD COLUMN bandcamp_url VARCHAR(500);
ALTER TABLE songs ADD COLUMN soundcloud_url VARCHAR(500); -- YouTube: existing youtube_videos table

CREATE TABLE song_lyrics (              -- LOCAL ONLY: never in git, API, or production
  song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  lyrics TEXT NOT NULL,
  source_url VARCHAR(500),
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- **Every public route** gains `WHERE status = 'included'` (songs, search, artists' song
  lists, stats, analytics, featured, similar). Admin routes see all statuses.
- Rejected rows imported minimally (title, artist, status, notes) — no enrichment fetched.
- These DDL changes go in a migration file under `backend/database/migrations/` (the first
  entry in the new migration discipline; live-schema snapshot happens in Phase 2).

## Copyright guardrails

1. `docs/playlist/` is gitignored (done 2026-07-07) — spreadsheets contain lyrics.
2. `song_lyrics` is never SELECTed by any API route; grep-able rule: the only code that may
   read it is local analysis scripts.
3. Phase 4 deploy runbook must exclude `song_lyrics` from the production dump
   (`pg_dump --exclude-table-data=song_lyrics`) — record this in the Phase 4 session notes.
4. The public site shows only `lyrics_url` links and the short `lyrics_highlights` excerpts.

## Consolidation import (Session 1.1 spec)

One idempotent script (`backend/scripts/consolidateSpreadsheets.js` or similar), **dry-run
mode by default**, full DB backup before the real run. Matching key: normalised artist+title
(lowercase, accents stripped, bracketed suffixes and punctuation removed).

1. **File 1 valid rows (318):** set `lyrics_url` + `lyrics_status='found'`, insert full
   lyrics into `song_lyrics`. File 1 `?` rows (393): `lyrics_status='not_found'`, junk URL
   discarded. All file-1 songs are already `included`.
2. **File 2 includes (574):** 382 matched → ensure `included`, apply lyrics/URL as above;
   192 unmatched → **insert as new songs** `status='included'`, `data_source='manual'` until
   Session 1.2 attaches Spotify matches; "not on spotify" variants noted in `status_notes`
   (URL goes to `bandcamp_url`/`soundcloud_url`/lyrics URL as appropriate).
3. **File 2 rejects (256):** insert as `status='rejected'` with notes.
4. **File 2 pending (179):** insert as `status='pending'`; scraped lyrics (where present, 170)
   go into `song_lyrics` with `lyrics_status='found'` only if the curator's row didn't say
   can't-find; otherwise store but flag in `status_notes` for review.
5. **Review report** (not auto-applied): file 1's 45 title-only matches + 7 unmatched, plus
   any file-2 row matching multiple DB songs. Curator resolves these in the admin UI or a
   follow-up pass.
6. Where both files cover the same song (65), file 1's valid lyrics win; conflicts reported.
7. Output: counts per action, written to the console and a log file (gitignored if it quotes
   lyrics).

Expected end state: catalogue ≈ 1,208 + 192 included +
256 rejected + 179 pending, with ~800+ songs carrying local lyrics.

## Ongoing workflow (admin UI; minimal version = new Session 1.4)

- **Pending queue tab:** list `status='pending'` songs; per song — play/search links
  (Spotify, Bandcamp, YouTube, Google/Genius lyrics search), paste lyrics (→ local table),
  set lyrics URL, categorise (existing categorisation UI), then Include / Reject.
- **Bulk candidate intake:** paste artist–title lines (or CSV) → pending queue rows.
- **Add song:** search Spotify and attach the match, or manual entry with platform links.
- **Playlist diff (rebuilt sync, Session 1.2):** import-only report — playlist tracks not in
  catalogue (one-click "add as pending"), catalogue `included` songs not on the playlist
  (informational; curator updates Spotify manually). No automatic writes to song statuses,
  no flag-as-removed behaviour.

## Deferred (YAGNI, recorded)

- Push-to-Spotify playlist sync (OAuth user auth).
- Vegan-theme coding workstream (will use the local lyrics; future project phase).
- More robust mood/genre generation (current tags are regenerable enrichment).

## Phase 1 sequencing (updates PROJECT_PLAN)

1. **1.1** Schema migration + consolidation import (this spec).
2. **1.2** Enrichment pipeline rebuild: Spotify attach for the 192, backfill the 534 bare
   albums/artists, close the 8-track playlist gap, import-only diff report.
3. **1.3** Integrity pass: merge the 18 duplicate pairs, clean 2 orphan artists / 14 orphan
   albums, re-point `featured`/videos/lyrics of merged songs.
4. **1.4** Minimal pending-queue admin UI so spreadsheet workflows can retire.
