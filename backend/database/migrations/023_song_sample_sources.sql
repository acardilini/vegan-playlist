-- 023 - the curator's own source name for an audio sample (a quoted voice, a documentary clip).
-- The analysis project owns song_audio_analysis.sample_details and a re-run overwrites it, so a curator-identified source
-- cannot live there. It lives here, web-owned, and is overlaid when sample items are built. A row is keyed by the sample's
-- type and timestamp exactly as the analysis wrote them; if a re-run moves a timestamp the row stops matching and the admin
-- Audio panel lists it as an orphan. Additive; no backfill. Deleting a song removes its rows.
CREATE TABLE IF NOT EXISTS song_sample_sources (
  song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  sample_type TEXT    NOT NULL,
  timestamp   TEXT    NOT NULL,
  source      TEXT    NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 200),
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (song_id, sample_type, timestamp)
);
