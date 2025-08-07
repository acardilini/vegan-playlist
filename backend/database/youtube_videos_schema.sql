-- YouTube Videos Table Schema
-- Stores YouTube video associations for songs

CREATE TABLE IF NOT EXISTS youtube_videos (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    youtube_id VARCHAR(20) NOT NULL, -- YouTube video ID (e.g., 'dQw4w9WgXcQ')
    video_title TEXT,
    video_description TEXT,
    thumbnail_url VARCHAR(500),
    video_type VARCHAR(50) DEFAULT 'official', -- 'official', 'live', 'lyric', 'fan-made'
    is_primary BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_youtube_id CHECK (youtube_id ~ '^[a-zA-Z0-9_-]{11}$'),
    CONSTRAINT valid_video_type CHECK (video_type IN ('official', 'live', 'lyric', 'fan-made', 'other'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_youtube_videos_song_id ON youtube_videos(song_id);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_primary ON youtube_videos(song_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_youtube_id ON youtube_videos(youtube_id);

-- Comments for documentation
COMMENT ON TABLE youtube_videos IS 'Stores YouTube video associations for songs in the vegan playlist';
COMMENT ON COLUMN youtube_videos.youtube_id IS 'YouTube video ID extracted from URL (11 characters)';
COMMENT ON COLUMN youtube_videos.video_type IS 'Type of video: official, live, lyric, fan-made, other';
COMMENT ON COLUMN youtube_videos.is_primary IS 'Whether this is the primary video to display for the song';

-- Ensure only one primary video per song
CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_videos_one_primary_per_song 
ON youtube_videos(song_id) WHERE is_primary = true;