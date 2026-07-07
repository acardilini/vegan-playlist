-- Migration 001 — Truth source (Session 1.1)
-- Spec: docs/TRUTH_SOURCE_DESIGN.md (approved 2026-07-07)
-- Additive only. Existing 1,208 songs become status='included' via the default.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'included'
  CHECK (status IN ('pending','included','rejected'));

-- e.g. 'not on spotify', reject reason, unresolved-import flags
ALTER TABLE songs ADD COLUMN IF NOT EXISTS status_notes TEXT;

ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_status VARCHAR(20) NOT NULL DEFAULT 'not_searched'
  CHECK (lyrics_status IN ('found','not_found','not_searched'));

ALTER TABLE songs ADD COLUMN IF NOT EXISTS bandcamp_url VARCHAR(500);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS soundcloud_url VARCHAR(500);
-- (YouTube links live in the existing youtube_videos table)

-- LOCAL ONLY: never committed to git, never SELECTed by any API route, and
-- excluded from production dumps (pg_dump --exclude-table-data=song_lyrics).
-- Full lyrics are copyrighted; only local analysis scripts may read this table.
CREATE TABLE IF NOT EXISTS song_lyrics (
  song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  lyrics TEXT NOT NULL,
  source_url VARCHAR(500),
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
