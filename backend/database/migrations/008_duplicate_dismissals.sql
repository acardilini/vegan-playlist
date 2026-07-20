-- Curator-rejected duplicate pairs. The /duplicate-songs detector excludes any
-- pair recorded here, so a "Not a duplicate" decision persists across scans.
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
  id           SERIAL PRIMARY KEY,
  song_id_a    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  song_id_b    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT duplicate_dismissals_order CHECK (song_id_a < song_id_b),
  CONSTRAINT duplicate_dismissals_unique UNIQUE (song_id_a, song_id_b)
);
