-- Migration 003 — Lyrics link columns (catch-up, Session 2.2)
-- Documents DDL already applied to the live DB by the deleted admin route
-- POST /api/admin/setup-lyrics (DDL-over-HTTP, removed 2026-07-08) and by
-- database/lyrics_schema_update.sql. Idempotent; running it is a no-op on the
-- live DB. Links/excerpts only — full lyrics live in the LOCAL-ONLY
-- song_lyrics table (migration 001), never in these columns.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_url VARCHAR(500);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_source VARCHAR(50) DEFAULT 'other';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_highlights TEXT;

CREATE INDEX IF NOT EXISTS idx_songs_lyrics_url
ON songs(lyrics_url)
WHERE lyrics_url IS NOT NULL AND lyrics_url != '';

COMMENT ON COLUMN songs.lyrics_url IS 'External URL linking to lyrics (Genius, Bandcamp, etc.) - no copyrighted content stored';
COMMENT ON COLUMN songs.lyrics_source IS 'Source of lyrics link: genius, bandcamp, or other';
COMMENT ON COLUMN songs.lyrics_highlights IS 'Brief excerpts highlighting vegan/animal themes for analytical purposes';
