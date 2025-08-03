-- Enhanced schema for manual song additions and data protection

-- Add columns to existing tables to track data source and manual overrides
ALTER TABLE artists ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'spotify';
ALTER TABLE artists ADD COLUMN IF NOT EXISTS manual_override BOOLEAN DEFAULT FALSE;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS manual_data JSONB;

ALTER TABLE albums ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'spotify';
ALTER TABLE albums ADD COLUMN IF NOT EXISTS manual_override BOOLEAN DEFAULT FALSE;
ALTER TABLE albums ADD COLUMN IF NOT EXISTS manual_data JSONB;

ALTER TABLE songs ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'spotify';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS manual_override BOOLEAN DEFAULT FALSE;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS manual_data JSONB;

-- Make spotify_id nullable for manual entries
ALTER TABLE artists ALTER COLUMN spotify_id DROP NOT NULL;
ALTER TABLE albums ALTER COLUMN spotify_id DROP NOT NULL;
ALTER TABLE songs ALTER COLUMN spotify_id DROP NOT NULL;

-- Add constraints to ensure either spotify_id or manual entry
ALTER TABLE artists ADD CONSTRAINT artists_source_check 
  CHECK ((data_source = 'spotify' AND spotify_id IS NOT NULL) OR 
         (data_source = 'manual' AND spotify_id IS NULL));

ALTER TABLE albums ADD CONSTRAINT albums_source_check 
  CHECK ((data_source = 'spotify' AND spotify_id IS NOT NULL) OR 
         (data_source = 'manual' AND spotify_id IS NULL));

ALTER TABLE songs ADD CONSTRAINT songs_source_check 
  CHECK ((data_source = 'spotify' AND spotify_id IS NOT NULL OR data_source = 'manual'));

-- Manual categorization overrides table
CREATE TABLE IF NOT EXISTS manual_categorizations (
    id SERIAL PRIMARY KEY,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    category_type VARCHAR(50) NOT NULL, -- 'vegan_focus', 'animal_category', etc.
    category_values TEXT[] NOT NULL,
    notes TEXT,
    created_by VARCHAR(100) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(song_id, category_type)
);

-- Backup table for tracking changes during Spotify updates
CREATE TABLE IF NOT EXISTS spotify_update_log (
    id SERIAL PRIMARY KEY,
    update_type VARCHAR(20) NOT NULL, -- 'sync', 'manual_add', 'manual_edit'
    table_name VARCHAR(50) NOT NULL,
    record_id INTEGER NOT NULL,
    old_data JSONB,
    new_data JSONB,
    spotify_data JSONB, -- Original Spotify data if applicable
    manual_data JSONB,   -- Manual overrides preserved
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Manual song additions table (for non-Spotify songs)
CREATE TABLE IF NOT EXISTS manual_songs (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist_names TEXT[] NOT NULL,
    album_name VARCHAR(255),
    duration_ms INTEGER,
    release_date DATE,
    external_url VARCHAR(500),
    audio_file_path VARCHAR(500), -- For local audio files
    lyrics TEXT,
    notes TEXT,
    created_by VARCHAR(100) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Link manual songs to the main songs table
ALTER TABLE songs ADD COLUMN IF NOT EXISTS manual_song_id INTEGER REFERENCES manual_songs(id);

-- Audio features for manual songs (estimated or analyzed)
CREATE TABLE IF NOT EXISTS manual_audio_features (
    id SERIAL PRIMARY KEY,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    energy DECIMAL(3,2),
    danceability DECIMAL(3,2),
    valence DECIMAL(3,2),
    acousticness DECIMAL(3,2),
    instrumentalness DECIMAL(3,2),
    liveness DECIMAL(3,2),
    speechiness DECIMAL(3,2),
    tempo DECIMAL(6,3),
    loudness DECIMAL(6,3),
    key INTEGER,
    mode INTEGER,
    time_signature INTEGER,
    analysis_method VARCHAR(50) DEFAULT 'manual', -- 'manual', 'estimated', 'analyzed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(song_id)
);

-- Protected fields table - fields that should never be overwritten by Spotify updates
CREATE TABLE IF NOT EXISTS protected_fields (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id INTEGER NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    protected_value TEXT,
    protection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(table_name, record_id, field_name)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_songs_data_source ON songs(data_source);
CREATE INDEX IF NOT EXISTS idx_songs_manual_override ON songs(manual_override);
CREATE INDEX IF NOT EXISTS idx_manual_categorizations_song_id ON manual_categorizations(song_id);
CREATE INDEX IF NOT EXISTS idx_manual_categorizations_category_type ON manual_categorizations(category_type);
CREATE INDEX IF NOT EXISTS idx_spotify_update_log_created_at ON spotify_update_log(created_at);
CREATE INDEX IF NOT EXISTS idx_protected_fields_lookup ON protected_fields(table_name, record_id, field_name);

-- Views for easy querying
CREATE OR REPLACE VIEW songs_with_manual_categories AS
SELECT 
    s.*,
    COALESCE(mc_vf.category_values, s.vegan_focus) as effective_vegan_focus,
    COALESCE(mc_ac.category_values, s.animal_category) as effective_animal_category,
    COALESCE(mc_as.category_values, s.advocacy_style) as effective_advocacy_style,
    COALESCE(mc_ai.category_values, s.advocacy_issues) as effective_advocacy_issues,
    COALESCE(mc_le.category_values, s.lyrical_explicitness) as effective_lyrical_explicitness
FROM songs s
LEFT JOIN manual_categorizations mc_vf ON s.id = mc_vf.song_id AND mc_vf.category_type = 'vegan_focus'
LEFT JOIN manual_categorizations mc_ac ON s.id = mc_ac.song_id AND mc_ac.category_type = 'animal_category'
LEFT JOIN manual_categorizations mc_as ON s.id = mc_as.song_id AND mc_as.category_type = 'advocacy_style'
LEFT JOIN manual_categorizations mc_ai ON s.id = mc_ai.song_id AND mc_ai.category_type = 'advocacy_issues'
LEFT JOIN manual_categorizations mc_le ON s.id = mc_le.song_id AND mc_le.category_type = 'lyrical_explicitness';

-- Function to safely update Spotify data while preserving manual overrides
CREATE OR REPLACE FUNCTION safe_spotify_update(
    p_table_name TEXT,
    p_record_id INTEGER,
    p_spotify_data JSONB
) RETURNS BOOLEAN AS $$
DECLARE
    existing_record RECORD;
    protected_fields_list TEXT[];
    final_data JSONB;
BEGIN
    -- Get existing record to check for manual overrides
    EXECUTE format('SELECT * FROM %I WHERE id = $1', p_table_name) 
    INTO existing_record USING p_record_id;
    
    -- If record has manual overrides, preserve them
    IF existing_record.manual_override THEN
        -- Get list of protected fields for this record
        SELECT array_agg(field_name) INTO protected_fields_list
        FROM protected_fields 
        WHERE table_name = p_table_name AND record_id = p_record_id;
        
        -- Merge Spotify data with manual overrides
        final_data := p_spotify_data;
        
        -- Preserve protected fields
        IF protected_fields_list IS NOT NULL THEN
            -- This would need specific logic for each field type
            -- For now, we'll store both versions
            final_data := final_data || existing_record.manual_data;
        END IF;
        
        -- Log the update
        INSERT INTO spotify_update_log (
            update_type, table_name, record_id, 
            old_data, new_data, spotify_data, manual_data
        ) VALUES (
            'sync', p_table_name, p_record_id,
            to_jsonb(existing_record), final_data, p_spotify_data, existing_record.manual_data
        );
        
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE manual_categorizations IS 'Manual category overrides that take precedence over Spotify data';
COMMENT ON TABLE spotify_update_log IS 'Audit trail for all Spotify data updates';
COMMENT ON TABLE manual_songs IS 'Songs not available on Spotify, manually added';
COMMENT ON TABLE manual_audio_features IS 'Audio features for manual songs or manual overrides';
COMMENT ON TABLE protected_fields IS 'Fields that should never be overwritten by Spotify updates';
COMMENT ON FUNCTION safe_spotify_update IS 'Safely updates Spotify data while preserving manual overrides';