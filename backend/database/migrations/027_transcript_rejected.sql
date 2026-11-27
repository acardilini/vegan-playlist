-- 027 - the curator can reject an AI draft transcript (e.g. one that is only "[inaudible]"). Web-owned: the analysis
-- project's song_audio_transcripts is never written here, so the rejection is stamped on the song. A draft stays hidden
-- until the analysis writes a NEWER transcript for the song (transcribed_at later than this stamp). Additive and idempotent.
-- (Numbered 027 because 026 is taken by artist_merges on the enrichment branch.)
ALTER TABLE songs ADD COLUMN IF NOT EXISTS transcript_rejected_at TIMESTAMPTZ;
