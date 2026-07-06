-- Schema updates for Spotify playlist sync functionality
-- Adds columns to track songs removed from the playlist

-- Add columns to songs table for tracking playlist sync status
ALTER TABLE songs ADD COLUMN IF NOT EXISTS removed_from_playlist BOOLEAN DEFAULT false;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS removed_from_playlist_at TIMESTAMP;

-- Add index for faster queries on removed songs
CREATE INDEX IF NOT EXISTS idx_songs_removed_from_playlist 
ON songs(removed_from_playlist) 
WHERE removed_from_playlist = true;

-- Add index for sorting by removal date
CREATE INDEX IF NOT EXISTS idx_songs_removed_playlist_date 
ON songs(removed_from_playlist_at DESC) 
WHERE removed_from_playlist = true;

-- Comments for documentation
COMMENT ON COLUMN songs.removed_from_playlist IS 'Flag indicating if song was removed from the Spotify playlist';
COMMENT ON COLUMN songs.removed_from_playlist_at IS 'Timestamp when song was detected as removed from playlist';

-- Optional: View for easy access to removed songs
CREATE OR REPLACE VIEW removed_playlist_songs AS
SELECT 
  s.id,
  s.spotify_id,
  s.title,
  s.removed_from_playlist_at,
  s.popularity,
  s.spotify_url,
  string_agg(a.name, ', ' ORDER BY a.name) as artists,
  al.name as album_name,
  COUNT(yv.id) as youtube_videos_count,
  CASE WHEN s.lyrics_url IS NOT NULL THEN 1 ELSE 0 END as has_lyrics,
  CASE WHEN s.vegan_focus IS NOT NULL AND array_length(s.vegan_focus, 1) > 0 THEN 1 ELSE 0 END as has_categorization
FROM songs s
LEFT JOIN song_artists sa ON s.id = sa.song_id
LEFT JOIN artists a ON sa.artist_id = a.id
LEFT JOIN albums al ON s.album_id = al.id
LEFT JOIN youtube_videos yv ON s.id = yv.song_id
WHERE s.removed_from_playlist = true
GROUP BY s.id, s.spotify_id, s.title, s.removed_from_playlist_at, s.popularity, s.spotify_url, al.name, s.lyrics_url, s.vegan_focus
ORDER BY s.removed_from_playlist_at DESC;

COMMENT ON VIEW removed_playlist_songs IS 'View showing songs that have been removed from the Spotify playlist with additional metadata';