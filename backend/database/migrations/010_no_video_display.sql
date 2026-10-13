-- 010 — songs.no_video_display: the curator has looked and there is no video for this song.
-- NULL = not marked; 'hide' = song page omits the video section; 'cover' = song page shows the album cover there.
-- Public catalogue metadata (the song page reads it), so it lives on songs, not song_processing. Additive, idempotent.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS no_video_display VARCHAR(10)
  CHECK (no_video_display IS NULL OR no_video_display IN ('hide','cover'));
