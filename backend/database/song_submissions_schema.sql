-- Song Submissions Table
-- This table stores user suggestions for songs to be added to the vegan playlist

CREATE TABLE song_submissions (
  id SERIAL PRIMARY KEY,
  
  -- Required fields
  song_title VARCHAR(255) NOT NULL,
  artist_name VARCHAR(255) NOT NULL,
  
  -- Optional fields
  album_name VARCHAR(255),
  release_year INTEGER,
  youtube_url TEXT,
  lyrics_excerpt TEXT,
  submission_reason TEXT,
  
  -- Submitter information (optional)
  submitter_name VARCHAR(100),
  submitter_email VARCHAR(255),
  
  -- System fields
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'resolved'
  existing_song_id INTEGER, -- Reference to songs table if song already exists
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100), -- Admin who resolved the submission
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected', 'resolved')),
  CONSTRAINT valid_year CHECK (release_year IS NULL OR (release_year >= 1900 AND release_year <= EXTRACT(YEAR FROM CURRENT_DATE) + 1)),
  CONSTRAINT valid_email CHECK (submitter_email IS NULL OR submitter_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  
  -- Foreign key to songs table if the song already exists
  FOREIGN KEY (existing_song_id) REFERENCES songs(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX idx_song_submissions_status ON song_submissions(status);
CREATE INDEX idx_song_submissions_created_at ON song_submissions(created_at DESC);
CREATE INDEX idx_song_submissions_artist_title ON song_submissions(artist_name, song_title);
CREATE INDEX idx_song_submissions_existing_song ON song_submissions(existing_song_id);

-- Update trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_song_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_song_submissions_updated_at
  BEFORE UPDATE ON song_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_song_submissions_updated_at();

-- Comments for documentation
COMMENT ON TABLE song_submissions IS 'User submissions for songs to be added to the vegan playlist';
COMMENT ON COLUMN song_submissions.song_title IS 'Title of the suggested song (required)';
COMMENT ON COLUMN song_submissions.artist_name IS 'Name of the artist (required)';
COMMENT ON COLUMN song_submissions.submission_reason IS 'User explanation for why this song should be added';
COMMENT ON COLUMN song_submissions.existing_song_id IS 'Set if the song already exists in the database';
COMMENT ON COLUMN song_submissions.status IS 'Current status: pending, approved, rejected, or resolved';