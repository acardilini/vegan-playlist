-- 011 — songs.spotify_dormant: the stored Spotify link no longer plays (track removed / unavailable).
-- The URL and spotify_id are kept (Spotify tooling still keys on them); the song page hides the Spotify chip
-- and the Spotify push skips the song. Additive, idempotent.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS spotify_dormant BOOLEAN NOT NULL DEFAULT FALSE;
