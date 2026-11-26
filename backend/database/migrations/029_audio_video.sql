-- 029 - the curator can pick which YouTube video the audio analysis should hear (e.g. the album recording while a live
-- video is the primary). NULL = use the primary video. Written only by services/videos.js setAudioVideo; READ by the
-- analysis project: the video is COALESCE(audio_video_id's youtube_id, the primary's youtube_id). audio_video_set_at is
-- stamped on every change (including back to the default) so a stale analysis/cache can be told from a fresh one.
-- Additive and idempotent. Deleting the chosen video falls back to the primary (ON DELETE SET NULL).
ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_video_id INTEGER REFERENCES youtube_videos(id) ON DELETE SET NULL;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_video_set_at TIMESTAMPTZ;
