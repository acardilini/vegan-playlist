-- Migration: Add featured field to songs table
-- This allows admins to manually pin songs as featured

ALTER TABLE songs ADD COLUMN featured BOOLEAN DEFAULT FALSE;

-- Create index for better performance when querying featured songs
CREATE INDEX idx_songs_featured ON songs(featured) WHERE featured = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN songs.featured IS 'Manually pinned featured songs for homepage display';