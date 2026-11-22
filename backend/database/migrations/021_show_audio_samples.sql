-- 021 - the curator's per-song decision on showing audio-sample details on the public song page.
-- NULL = not reviewed (treated as hidden), TRUE = show, FALSE = hidden after review. Additive; no backfill, so
-- every existing song starts hidden. Samples are third-party speech/sound clips described by the analysis
-- project; nothing about a sample (details, types, filter membership, reference counts) is public until TRUE.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS show_audio_samples BOOLEAN;
