-- 022 - a third junk-lyrics kind: 'placeholder' (stored text that stands in for lyrics: 'NA', '[object Object]', ...).
-- Widens the CHECK from 012. Additive and idempotent: dropping and re-adding the same-named constraint is safe to re-run.
ALTER TABLE song_lyrics DROP CONSTRAINT IF EXISTS song_lyrics_junk_kind_check;
ALTER TABLE song_lyrics ADD CONSTRAINT song_lyrics_junk_kind_check
  CHECK (junk_kind IS NULL OR junk_kind IN ('error','youtube_description','placeholder'));
