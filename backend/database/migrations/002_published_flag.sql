-- Migration 002 — Publication staging (Session 1.2b)
-- Spec: docs/PUBLICATION_STAGING_DESIGN.md (approved 2026-07-07)
-- status stays the curator's inclusion decision; published is the orthogonal
-- "ready to show" dimension. Public routes filter on BOTH.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

-- Only included songs can be live; a status change away from 'included' must unpublish.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'songs_published_check') THEN
    ALTER TABLE songs ADD CONSTRAINT songs_published_check
      CHECK (NOT published OR status = 'included');
  END IF;
END $$;

-- Grandfather complete included songs (curator decision 2026-07-07): a play link
-- (Spotify/Bandcamp/SoundCloud URL or a YouTube video) AND album artwork.
UPDATE songs s SET published = true, published_at = CURRENT_TIMESTAMP
WHERE s.status = 'included'
  AND s.published = false
  AND (s.spotify_url IS NOT NULL OR s.bandcamp_url IS NOT NULL OR s.soundcloud_url IS NOT NULL
       OR EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id))
  AND EXISTS (SELECT 1 FROM albums al WHERE al.id = s.album_id
              AND al.images IS NOT NULL AND al.images::text NOT IN ('null','[]'));
