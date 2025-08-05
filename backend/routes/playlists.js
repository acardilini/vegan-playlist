const express = require('express');
const pool = require('../database/db');
const router = express.Router();

// Get all playlists
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const result = await pool.query(`
      SELECT 
        p.*,
        COUNT(ps.song_id) as song_count
      FROM playlists p
      LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
      WHERE p.is_public = true
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    // Get total count for pagination
    const countResult = await pool.query(`
      SELECT COUNT(*) 
      FROM playlists 
      WHERE is_public = true
    `);
    const total = parseInt(countResult.rows[0].count);
    
    res.json({
      playlists: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// Get single playlist with songs
router.get('/:id', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    
    // Get playlist info
    const playlistResult = await pool.query(`
      SELECT * FROM playlists WHERE id = $1 AND is_public = true
    `, [playlistId]);
    
    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    // Get playlist songs with full song details
    const songsResult = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.energy,
        s.danceability,
        s.valence,
        s.custom_mood,
        ps.position,
        ps.added_at,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT genre_elem) FILTER (WHERE genre_elem IS NOT NULL) as artist_genres
      FROM playlist_songs ps
      JOIN songs s ON ps.song_id = s.id
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS genre_elem ON true
      WHERE ps.playlist_id = $1
      GROUP BY s.id, ps.position, ps.added_at, al.name, al.release_date, al.images
      ORDER BY ps.position ASC, ps.added_at ASC
    `, [playlistId]);
    
    res.json({
      playlist: playlistResult.rows[0],
      songs: songsResult.rows
    });
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// Create new playlist
router.post('/', async (req, res) => {
  try {
    const { name, description, creator = 'Anonymous', is_public = true } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }
    
    const result = await pool.query(`
      INSERT INTO playlists (name, description, creator, is_public)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name.trim(), description || null, creator, is_public]);
    
    res.status(201).json({
      message: 'Playlist created successfully',
      playlist: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// Add song to playlist
router.post('/:id/songs', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    const { song_id } = req.body;
    
    if (!song_id) {
      return res.status(400).json({ error: 'Song ID is required' });
    }
    
    // Check if playlist exists
    const playlistCheck = await pool.query(
      'SELECT id FROM playlists WHERE id = $1', 
      [playlistId]
    );
    
    if (playlistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    // Check if song exists
    const songCheck = await pool.query(
      'SELECT id FROM songs WHERE id = $1', 
      [song_id]
    );
    
    if (songCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    
    // Get next position
    const positionResult = await pool.query(`
      SELECT COALESCE(MAX(position), 0) + 1 as next_position 
      FROM playlist_songs 
      WHERE playlist_id = $1
    `, [playlistId]);
    
    const nextPosition = positionResult.rows[0].next_position;
    
    // Add song to playlist
    const result = await pool.query(`
      INSERT INTO playlist_songs (playlist_id, song_id, position)
      VALUES ($1, $2, $3)
      ON CONFLICT (playlist_id, song_id) DO NOTHING
      RETURNING *
    `, [playlistId, song_id, nextPosition]);
    
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Song already exists in playlist' });
    }
    
    res.status(201).json({
      message: 'Song added to playlist successfully',
      playlist_song: result.rows[0]
    });
  } catch (error) {
    console.error('Error adding song to playlist:', error);
    res.status(500).json({ error: 'Failed to add song to playlist' });
  }
});

// Remove song from playlist
router.delete('/:id/songs/:songId', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    const songId = parseInt(req.params.songId);
    
    const result = await pool.query(`
      DELETE FROM playlist_songs 
      WHERE playlist_id = $1 AND song_id = $2
      RETURNING *
    `, [playlistId, songId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found in playlist' });
    }
    
    res.json({
      message: 'Song removed from playlist successfully'
    });
  } catch (error) {
    console.error('Error removing song from playlist:', error);
    res.status(500).json({ error: 'Failed to remove song from playlist' });
  }
});

// Update playlist
router.put('/:id', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    const { name, description, is_public } = req.body;
    
    const result = await pool.query(`
      UPDATE playlists 
      SET 
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        is_public = COALESCE($4, is_public)
      WHERE id = $1
      RETURNING *
    `, [playlistId, name, description, is_public]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    res.json({
      message: 'Playlist updated successfully',
      playlist: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating playlist:', error);
    res.status(500).json({ error: 'Failed to update playlist' });
  }
});

// Delete playlist
router.delete('/:id', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    
    const result = await pool.query(`
      DELETE FROM playlists WHERE id = $1 RETURNING *
    `, [playlistId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    res.json({
      message: 'Playlist deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

module.exports = router;