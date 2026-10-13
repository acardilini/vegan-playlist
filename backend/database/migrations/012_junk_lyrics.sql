-- 012 — junk-lyrics flag (sub-project G). The detector (services/lyricsQuality.js) sets junk_kind;
-- 'Not junk' sets junk_dismissed so scans skip the row. Flagged <=> junk_kind IS NOT NULL.
-- Additive, idempotent. song_lyrics stays LOCAL ONLY.
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS junk_kind VARCHAR(30)
  CHECK (junk_kind IS NULL OR junk_kind IN ('error','youtube_description'));
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS junk_dismissed BOOLEAN NOT NULL DEFAULT FALSE;
