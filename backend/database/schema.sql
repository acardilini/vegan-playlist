-- Artists table
CREATE TABLE artists (
    id SERIAL PRIMARY KEY,
    spotify_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    spotify_url VARCHAR(500),
    genres TEXT[],
    images JSONB,
    followers INTEGER,
    popularity INTEGER,
    bio TEXT,
    vegan_advocacy_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Albums table
CREATE TABLE albums (
    id SERIAL PRIMARY KEY,
    spotify_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    release_date DATE,
    images JSONB,
    total_tracks INTEGER,
    spotify_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Songs table
CREATE TABLE songs (
    id SERIAL PRIMARY KEY,
    spotify_id VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    album_id INTEGER REFERENCES albums(id),
    duration_ms INTEGER,
    popularity INTEGER,
    spotify_url VARCHAR(500),
    preview_url VARCHAR(500),
    explicit BOOLEAN,
    
    -- Your custom categorizations (flexible)
    vegan_focus TEXT[], -- ['animals', 'environment', 'health']
    animal_category TEXT[], -- ['farm_animals', 'wild_animals', 'all_animals']
    advocacy_style TEXT[], -- ['direct', 'educational', 'subtle', 'storytelling']
    advocacy_issues TEXT[], -- ['vivisection', 'eating_animals', 'healthy_eating']
    lyrical_explicitness TEXT[], -- ['direct', 'confrontational', 'educational', 'subtle']
    
    -- Analysis fields
    your_review TEXT,
    audio_review_url VARCHAR(500),
    inclusion_notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    
    -- Metadata
    date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Song-Artist relationship (many-to-many)
CREATE TABLE song_artists (
    id SERIAL PRIMARY KEY,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    artist_id INTEGER REFERENCES artists(id) ON DELETE CASCADE,
    UNIQUE(song_id, artist_id)
);

-- Categories system (for future flexibility)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    category_type VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Song categories (many-to-many)
CREATE TABLE song_categories (
    id SERIAL PRIMARY KEY,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE(song_id, category_id)
);

-- User playlists (for future)
CREATE TABLE playlists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    creator VARCHAR(100),
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Playlist songs
CREATE TABLE playlist_songs (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(playlist_id, song_id)
);

-- Indexes for performance
CREATE INDEX idx_songs_spotify_id ON songs(spotify_id);
CREATE INDEX idx_artists_spotify_id ON artists(spotify_id);
CREATE INDEX idx_albums_spotify_id ON albums(spotify_id);
CREATE INDEX idx_songs_title ON songs(title);
CREATE INDEX idx_artists_name ON artists(name);