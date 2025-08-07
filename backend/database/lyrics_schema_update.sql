-- Add lyrics fields to songs table for storing external lyrics links
-- This is copyright-safe as we only store URLs/references, never actual lyrics content

-- Add lyrics_url column to store external links to lyrics
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_url VARCHAR(500);

-- Add lyrics_source column to track where the lyrics link comes from
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_source VARCHAR(50) DEFAULT 'other';

-- Add lyrics_highlights column for brief vegan/animal-themed excerpts
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_highlights TEXT;

-- Create index for faster queries on songs with lyrics links
CREATE INDEX IF NOT EXISTS idx_songs_lyrics_url 
ON songs(lyrics_url) 
WHERE lyrics_url IS NOT NULL AND lyrics_url != '';

-- Create index for lyrics source filtering
CREATE INDEX IF NOT EXISTS idx_songs_lyrics_source 
ON songs(lyrics_source) 
WHERE lyrics_source IS NOT NULL;

-- Create index for lyrics highlights search
CREATE INDEX IF NOT EXISTS idx_songs_lyrics_highlights 
ON songs USING gin(to_tsvector('english', lyrics_highlights))
WHERE lyrics_highlights IS NOT NULL AND lyrics_highlights != '';

-- Add comments to document the purpose
COMMENT ON COLUMN songs.lyrics_url IS 'External URL linking to lyrics (Genius, Bandcamp, etc.) - no copyrighted content stored';
COMMENT ON COLUMN songs.lyrics_source IS 'Source of lyrics link: genius, bandcamp, or other';
COMMENT ON COLUMN songs.lyrics_highlights IS 'Brief excerpts highlighting vegan/animal themes for analytical purposes';