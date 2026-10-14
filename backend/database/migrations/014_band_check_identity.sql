-- 014 — band check identity (sub-project H). Where a band lives on the two non-Spotify sources the
-- Band check merges; set only by the curator's confirm step. Additive, idempotent. spotify_id already exists.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS bandcamp_url VARCHAR(500);
ALTER TABLE artists ADD COLUMN IF NOT EXISTS musicbrainz_id UUID;
