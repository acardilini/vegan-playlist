-- 016 - artist facts. Country, years and the Active override live on artists, each fact with the source that supplied it
-- ('MusicBrainz' or 'Added by curator'); members get their own table with a curator-only vegan mark. Additive, idempotent.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS country_source TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS formed_year INTEGER;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS formed_source TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS disbanded_year INTEGER;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS disbanded_source TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS last_release_year INTEGER;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS last_release_source TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS active_override BOOLEAN;

CREATE TABLE IF NOT EXISTS artist_members (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  vegan BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'Added by curator',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS artist_members_artist_idx ON artist_members(artist_id);
