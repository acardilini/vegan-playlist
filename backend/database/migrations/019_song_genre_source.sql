-- 019 - where a song's own genre came from, mirroring artists.*_source.
-- 'manual' = the curator set it; 'audio_gemini' / 'audio_local_mir' = inferred from the audio by the
-- analysis project (only for songs with no genre). NULL with a genre present = legacy, provenance
-- unknown (deliberately not backfilled: manual_override is false on every legacy row, so it cannot
-- tell a curator edit from a Spotify import). NULL with no genre = nothing to attribute.
-- No CHECK constraint: the analysis project may add a source value without a migration here.
-- Idempotent.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS genre_source VARCHAR(32);
