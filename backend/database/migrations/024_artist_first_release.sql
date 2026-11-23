-- 024 - an artist's first-release year, with the source that supplied it (same shape as last_release_year /
-- last_release_source). Together they give the public artist page a range of published work ("Released 1996-2024").
-- Additive; no backfill. artists.active_override (migration 016) is no longer read or written by the app and is left in place.
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS first_release_year   INTEGER,
  ADD COLUMN IF NOT EXISTS first_release_source TEXT;
