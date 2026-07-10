-- 005: curator-maintained artist website link (Session 3.2 follow-up)
-- Shown on the public artist page as a "Bandcamp" or "Website" button next to
-- "Open in Spotify". Curator-owned (set via the admin Artists tab) — never
-- written by any sync/enrichment path.

ALTER TABLE artists ADD COLUMN IF NOT EXISTS website_url VARCHAR(500);

COMMENT ON COLUMN artists.website_url IS
  'Curator-set link to the artist''s Bandcamp page or official website (public artist page button)';
