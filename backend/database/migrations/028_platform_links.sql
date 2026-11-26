-- 028 - links to the song on other listening platforms (Deezer, Apple Music, later Tidal), and the song's ISRC.
-- Web-owned and additive; no backfill (the admin "Find links" run fills them). Spotify stays on songs.spotify_url.
-- A Deezer link found by ISRC is saved confirmed (exact). An Apple Music link found by title + artist search is saved
-- proposed with what Apple called the track, and only a curator's Confirm makes it public. A rejected row is kept so the
-- run never proposes it again. Deleting a song removes its rows.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS isrc TEXT;

CREATE TABLE IF NOT EXISTS song_platform_links (
  song_id      INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  platform     TEXT    NOT NULL CHECK (platform IN ('deezer', 'apple_music', 'tidal')),
  url          TEXT    NOT NULL CHECK (url ~* '^https?://'),
  status       TEXT    NOT NULL CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  source       TEXT    NOT NULL CHECK (source IN ('isrc', 'search')),
  match_title  TEXT,
  match_artist TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (song_id, platform)
);
CREATE INDEX IF NOT EXISTS song_platform_links_proposed_idx ON song_platform_links (song_id) WHERE status = 'proposed';
