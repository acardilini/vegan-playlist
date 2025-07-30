const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const pool = require('../database/db');
const router = express.Router();

// Initialize Spotify API
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Get access token (for public playlists, we don't need user auth)
const getAccessToken = async () => {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    return data.body['access_token'];
  } catch (error) {
    console.error('Error getting access token:', error);
    throw error;
  }
};

// Test Spotify connection
router.get('/test', async (req, res) => {
  try {
    await getAccessToken();
    res.json({ message: 'Spotify API connected successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to Spotify API' });
  }
});

// Get playlist tracks
router.get('/playlist/:playlistId', async (req, res) => {
  try {
    await getAccessToken();
    const { playlistId } = req.params;
    
    // Get playlist info
    const playlistData = await spotifyApi.getPlaylist(playlistId);
    
    // Get all tracks (handle pagination)
    let allTracks = [];
    let offset = 0;
    const limit = 50;
    
    while (true) {
      const tracksData = await spotifyApi.getPlaylistTracks(playlistId, {
        offset: offset,
        limit: limit,
        fields: 'items(track(id,name,artists,album,duration_ms,popularity,external_urls,preview_url)),next'
      });
      
      allTracks = allTracks.concat(tracksData.body.items);
      
      if (!tracksData.body.next) break;
      offset += limit;
    }
    
    // Format the data
    const formattedTracks = allTracks.map(item => {
      const track = item.track;
      return {
        spotifyId: track.id,
        title: track.name,
        artists: track.artists.map(artist => ({
          id: artist.id,
          name: artist.name,
          spotifyUrl: artist.external_urls?.spotify
        })),
        album: {
          id: track.album.id,
          name: track.album.name,
          releaseDate: track.album.release_date,
          images: track.album.images
        },
        duration: track.duration_ms,
        popularity: track.popularity,
        spotifyUrl: track.external_urls?.spotify,
        previewUrl: track.preview_url
      };
    });
    
    res.json({
      playlist: {
        id: playlistData.body.id,
        name: playlistData.body.name,
        description: playlistData.body.description,
        trackCount: playlistData.body.tracks.total
      },
      tracks: formattedTracks
    });
    
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ error: 'Failed to fetch playlist data' });
  }
});

// Get additional track features
router.get('/features/:trackIds', async (req, res) => {
  try {
    await getAccessToken();
    const trackIds = req.params.trackIds.split(',');
    
    const features = await spotifyApi.getAudioFeaturesForTracks(trackIds);
    res.json(features.body);
  } catch (error) {
    console.error('Error fetching audio features:', error);
    res.status(500).json({ error: 'Failed to fetch audio features' });
  }
});

// Get artist details
router.get('/artist/:artistId', async (req, res) => {
  try {
    await getAccessToken();
    const { artistId } = req.params;
    
    const artistData = await spotifyApi.getArtist(artistId);
    res.json(artistData.body);
  } catch (error) {
    console.error('Error fetching artist:', error);
    res.status(500).json({ error: 'Failed to fetch artist data' });
  }
});

// Database test routes
router.get('/db-stats', async (req, res) => {
  try {
    const songCount = await pool.query('SELECT COUNT(*) FROM songs');
    const artistCount = await pool.query('SELECT COUNT(*) FROM artists');
    const albumCount = await pool.query('SELECT COUNT(*) FROM albums');
    
    res.json({
      songs: parseInt(songCount.rows[0].count),
      artists: parseInt(artistCount.rows[0].count),
      albums: parseInt(albumCount.rows[0].count)
    });
  } catch (error) {
    console.error('Database stats error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/db-songs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.title, a.name as artist, al.name as album, 
             s.duration_ms, s.popularity, s.spotify_url
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      JOIN albums al ON s.album_id = al.id
      ORDER BY s.title
      LIMIT 20
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Database songs error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all songs with pagination
router.get('/songs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.preview_url,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT a.spotify_id) as artist_ids
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      GROUP BY s.id, al.id
      ORDER BY s.title
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    // Get total count for pagination
    const countResult = await pool.query('SELECT COUNT(*) FROM songs');
    const totalSongs = parseInt(countResult.rows[0].count);
    
    res.json({
      songs: result.rows,
      pagination: {
        page,
        limit,
        total: totalSongs,
        pages: Math.ceil(totalSongs / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching songs:', error);
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

// Get featured/random songs for homepage - WITH CUSTOM MOODS
router.get('/songs/featured', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.playlist_added_at,
        s.energy,
        s.danceability,
        s.valence,
        s.tempo,
        s.custom_mood,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        COALESCE(
          ARRAY_AGG(a.name) FILTER (WHERE a.name IS NOT NULL), 
          ARRAY[]::text[]
        ) as artists,
        COALESCE(
          ARRAY_AGG(a.genres) FILTER (WHERE a.genres IS NOT NULL), 
          ARRAY[]::text[]
        ) as artist_genres
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      GROUP BY s.id, s.spotify_id, s.title, s.duration_ms, s.popularity, s.spotify_url, 
               s.playlist_added_at, s.energy, s.danceability, s.valence, s.tempo, s.custom_mood,
               al.name, al.release_date, al.images
      HAVING COUNT(a.id) > 0
      ORDER BY RANDOM()
      LIMIT $1
    `, [limit]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching enhanced featured songs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch enhanced featured songs',
      details: error.message 
    });
  }
});

// Get single song by ID
router.get('/songs/:id', async (req, res) => {
  try {
    const songId = req.params.id;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.preview_url,
        s.explicit,
        s.track_number,
        s.disc_number,
        s.playlist_added_at,
        s.energy,
        s.danceability,
        s.valence,
        s.acousticness,
        s.instrumentalness,
        s.liveness,
        s.speechiness,
        s.tempo,
        s.loudness,
        s.key,
        s.mode,
        s.time_signature,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        al.spotify_url as album_spotify_url,
        ARRAY_AGG(DISTINCT jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'spotify_id', a.spotify_id,
          'spotify_url', a.spotify_url,
          'genres', a.genres,
          'popularity', a.popularity,
          'followers', a.followers
        )) as artists
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE s.id = $1
      GROUP BY s.id, al.id
    `, [songId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching song:', error);
    res.status(500).json({ error: 'Failed to fetch song' });
  }
});

// Get all artists
router.get('/artists', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id,
        a.name,
        a.spotify_id,
        a.spotify_url,
        COUNT(DISTINCT s.id) as song_count
      FROM artists a
      JOIN song_artists sa ON a.id = sa.artist_id
      JOIN songs s ON sa.song_id = s.id
      GROUP BY a.id
      ORDER BY song_count DESC, a.name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching artists:', error);
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

// Search songs
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }
    
    const searchTerm = `%${query}%`;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a.name) as artists
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE 
        LOWER(s.title) LIKE LOWER($1) OR 
        LOWER(a.name) LIKE LOWER($1) OR
        LOWER(al.name) LIKE LOWER($1)
      GROUP BY s.id, al.id
      ORDER BY s.popularity DESC, s.title
      LIMIT 50
    `, [searchTerm]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching songs:', error);
    res.status(500).json({ error: 'Failed to search songs' });
  }
});

// Check database contents
router.get('/database-check', async (req, res) => {
  try {
    // Count totals
    const songCount = await pool.query('SELECT COUNT(*) FROM songs');
    const artistCount = await pool.query('SELECT COUNT(*) FROM artists');
    const albumCount = await pool.query('SELECT COUNT(*) FROM albums');
    
    // Sample data
    const sampleData = await pool.query(`
      SELECT 
        s.title, 
        s.spotify_id,
        s.date_added,
        s.vegan_focus,
        s.animal_category,
        array_agg(a.name) as artists
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      GROUP BY s.id, s.title, s.spotify_id, s.date_added, s.vegan_focus, s.animal_category
      LIMIT 5
    `);
    
    const schemaCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'songs' 
      ORDER BY ordinal_position
    `);
    
    res.json({
      totals: {
        songs: parseInt(songCount.rows[0].count),
        artists: parseInt(artistCount.rows[0].count),
        albums: parseInt(albumCount.rows[0].count)
      },
      sampleData: sampleData.rows,
      songsSchema: schemaCheck.rows
    });
  } catch (error) {
    console.error('Database check error:', error);
    res.status(500).json({ error: 'Database check failed' });
  }
});

// Debug endpoint to check audio features
router.get('/debug/audio-features', async (req, res) => {
  try {
    // Check if any songs have audio features
    const withFeatures = await pool.query(`
      SELECT COUNT(*) as count
      FROM songs 
      WHERE energy IS NOT NULL OR danceability IS NOT NULL
    `);
    
    // Get a sample of songs with and without features
    const sampleWithFeatures = await pool.query(`
      SELECT title, energy, danceability, valence, tempo
      FROM songs 
      WHERE energy IS NOT NULL 
      LIMIT 5
    `);
    
    const sampleWithoutFeatures = await pool.query(`
      SELECT title, spotify_id, energy, danceability, valence, tempo
      FROM songs 
      WHERE energy IS NULL 
      LIMIT 5
    `);
    
    res.json({
      summary: {
        songs_with_features: parseInt(withFeatures.rows[0].count),
        total_songs: await pool.query('SELECT COUNT(*) FROM songs').then(r => parseInt(r.rows[0].count))
      },
      samples: {
        with_features: sampleWithFeatures.rows,
        without_features: sampleWithoutFeatures.rows
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;