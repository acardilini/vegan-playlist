const express = require('express');
const pool = require('../database/db');
const { getParentGenres, getAllSubgenres, getParentGenre } = require('../utils/genreMapping');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const router = express.Router();

// Test PUT route BEFORE auth middleware
router.put('/test-update/:id', (req, res) => {
  console.log('TEST UPDATE ENDPOINT HIT!', req.params.id, req.body);
  res.json({ message: 'Test update works!', id: req.params.id, body: req.body });
});

// Test featured route BEFORE auth middleware
router.put('/test-featured-noauth/:id', async (req, res) => {
  console.log('TEST FEATURED NO AUTH ENDPOINT HIT!', req.params.id, req.body);
  try {
    const songId = parseInt(req.params.id);
    const featured = req.body.featured;
    
    console.log('Updating featured status (no auth):', { songId, featured });
    
    // Update the database
    const result = await pool.query(`
      UPDATE songs 
      SET featured = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [songId, featured]);
    
    console.log('Database update result - rows affected:', result.rowCount);
    
    // Query the updated record
    const verifyQuery = await pool.query('SELECT id, title, featured FROM songs WHERE id = $1', [songId]);
    console.log('Verify query result:', verifyQuery.rows[0]);
    
    res.json({
      success: true,
      song: verifyQuery.rows[0],
      debug: { songId, featured, rowsAffected: result.rowCount }
    });
  } catch (error) {
    console.error('Test featured error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
  const password = req.headers['x-admin-password'] || (req.body && req.body.admin_password) || req.query.admin_password;
  
  console.log('Auth check - provided password:', password);
  console.log('Expected password:', process.env.ADMIN_PASSWORD);
  
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  next();
};

// Apply admin authentication to all routes
router.use(authenticateAdmin);

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Test route
router.get('/test', (req, res) => {
  res.json({ message: 'Admin routes are working!' });
});

// Test PUT route
router.put('/test-update/:id', (req, res) => {
  console.log('TEST UPDATE ENDPOINT HIT!', req.params.id, req.body);
  res.json({ message: 'Test update works!', id: req.params.id, body: req.body });
});

// Test featured update route
router.put('/test-featured/:id', async (req, res) => {
  console.log('TEST FEATURED ENDPOINT HIT!', req.params.id, req.body);
  try {
    const songId = parseInt(req.params.id);
    const featured = req.body.featured;
    
    console.log('Updating featured status:', { songId, featured });
    
    // Update the database
    const result = await pool.query(`
      UPDATE songs 
      SET featured = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [songId, featured]);
    
    console.log('Database update result - rows affected:', result.rowCount);
    
    // Query the updated record
    const verifyQuery = await pool.query('SELECT id, title, featured FROM songs WHERE id = $1', [songId]);
    console.log('Verify query result:', verifyQuery.rows[0]);
    
    res.json({
      success: true,
      song: verifyQuery.rows[0],
      debug: { songId, featured, rowsAffected: result.rowCount }
    });
  } catch (error) {
    console.error('Test featured error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Simple test route
router.get('/simple-test', (req, res) => {
  res.json({ message: 'Simple test works!' });
});

// Get all playlists for admin (new route)
router.get('/admin-playlists', async (req, res) => {
  console.log('Admin playlists route hit!');
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    console.log('Querying database for playlists...');
    const result = await pool.query(`
      SELECT 
        p.*,
        COUNT(ps.song_id) as song_count
      FROM playlists p
      LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    console.log('Found', result.rows.length, 'playlists');
    
    // Get total count for pagination
    const countResult = await pool.query(`SELECT COUNT(*) FROM playlists`);
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
    console.error('Error fetching playlists for admin:', error);
    res.status(500).json({ error: 'Failed to fetch playlists', details: error.message });
  }
});

// Get all playlists for admin management
router.get('/playlists', async (req, res) => {
  console.log('Admin playlists route hit!');
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    console.log('Querying database for playlists...');
    const result = await pool.query(`
      SELECT 
        p.*,
        COUNT(ps.song_id) as song_count
      FROM playlists p
      LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    console.log('Found', result.rows.length, 'playlists');
    
    // Get total count for pagination
    const countResult = await pool.query(`SELECT COUNT(*) FROM playlists`);
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
    console.error('Error fetching playlists for admin:', error);
    res.status(500).json({ error: 'Failed to fetch playlists', details: error.message });
  }
});

// Delete a playlist (admin only)
router.delete('/playlists/:id', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    
    const result = await pool.query(`
      DELETE FROM playlists WHERE id = $1 RETURNING *
    `, [playlistId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    res.json({
      message: 'Playlist deleted successfully',
      playlist: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

// Get all songs (both Spotify and manual) for management
router.get('/all-songs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    let whereClause = '';
    let params = [limit, offset];
    
    if (search) {
      whereClause = `WHERE (s.title ILIKE $3 OR string_agg(a.name, ', ') ILIKE $3)`;
      params.push(`%${search}%`);
    }
    
    const result = await pool.query(`
      SELECT 
        s.*,
        string_agg(a.name, ', ') as artists,
        al.name as album_name,
        ms.id as manual_song_id,
        ms.external_url,
        ms.audio_file_path,
        ms.lyrics,
        ms.notes,
        CASE WHEN s.data_source = 'manual' THEN 'Manual' ELSE 'Spotify' END as source_type
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN albums al ON s.album_id = al.id
      LEFT JOIN manual_songs ms ON s.manual_song_id = ms.id
      GROUP BY s.id, al.name, ms.id, ms.external_url, ms.audio_file_path, ms.lyrics, ms.notes
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);
    
    const countParams = search ? [`%${search}%`] : [];
    const countWhereClause = search ? `WHERE (s.title ILIKE $1 OR EXISTS (SELECT 1 FROM song_artists sa JOIN artists a ON sa.artist_id = a.id WHERE sa.song_id = s.id AND a.name ILIKE $1))` : '';
    
    const countResult = await pool.query(`
      SELECT COUNT(DISTINCT s.id) 
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      ${countWhereClause}
    `, countParams);
    
    const total = parseInt(countResult.rows[0].count);
    
    res.json({
      songs: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching all songs:', error);
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

// Get all manual songs
router.get('/manual-songs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const result = await pool.query(`
      SELECT 
        ms.*,
        s.id as song_id,
        s.vegan_focus,
        s.animal_category,
        s.advocacy_style,
        s.advocacy_issues,
        s.lyrical_explicitness,
        s.your_review,
        s.rating
      FROM manual_songs ms
      LEFT JOIN songs s ON s.manual_song_id = ms.id
      ORDER BY ms.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    const countResult = await pool.query('SELECT COUNT(*) FROM manual_songs');
    const total = parseInt(countResult.rows[0].count);
    
    res.json({
      manual_songs: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching manual songs:', error);
    res.status(500).json({ error: 'Failed to fetch manual songs' });
  }
});

// Add a new manual song
router.post('/manual-songs', async (req, res) => {
  try {
    const {
      title,
      artist_names,
      album_name,
      duration_ms,
      release_date,
      external_url,
      audio_file_path,
      lyrics,
      notes,
      popularity,
      explicit,
      track_number,
      disc_number,
      custom_mood,
      // Genre
      genre,
      parent_genre,
      // Categorization
      vegan_focus,
      animal_category,
      advocacy_style,
      advocacy_issues,
      lyrical_explicitness,
      your_review,
      audio_review_url,
      inclusion_notes,
      rating,
      // Audio features
      energy,
      danceability,
      valence,
      acousticness,
      instrumentalness,
      liveness,
      speechiness,
      tempo,
      loudness,
      key,
      mode,
      time_signature
    } = req.body;

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 1. Insert into manual_songs
      const manualSongResult = await client.query(`
        INSERT INTO manual_songs (
          title, artist_names, album_name, duration_ms, release_date,
          external_url, audio_file_path, lyrics, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [
        title, artist_names, album_name, duration_ms, release_date,
        external_url, audio_file_path, lyrics, notes, 'admin'
      ]);
      
      const manualSongId = manualSongResult.rows[0].id;
      
      // 2. Create or find artists
      const artistIds = [];
      for (const artistName of artist_names) {
        // Check if artist exists
        let artistResult = await client.query(
          'SELECT id FROM artists WHERE LOWER(name) = LOWER($1) AND data_source = $2',
          [artistName, 'manual']
        );
        
        if (artistResult.rows.length === 0) {
          // Create new manual artist
          artistResult = await client.query(`
            INSERT INTO artists (name, data_source, created_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            RETURNING id
          `, [artistName, 'manual']);
        }
        
        artistIds.push(artistResult.rows[0].id);
      }
      
      // 3. Create or find album
      let albumId = null;
      if (album_name) {
        let albumResult = await client.query(
          'SELECT id FROM albums WHERE LOWER(name) = LOWER($1) AND data_source = $2',
          [album_name, 'manual']
        );
        
        if (albumResult.rows.length === 0) {
          albumResult = await client.query(`
            INSERT INTO albums (name, release_date, data_source, created_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            RETURNING id
          `, [album_name, release_date, 'manual']);
        }
        
        albumId = albumResult.rows[0].id;
      }
      
      // 4. Insert into main songs table
      // Calculate parent_genre if not provided
      const finalParentGenre = parent_genre || (genre ? getParentGenre(genre) : null);
      
      const songResult = await client.query(`
        INSERT INTO songs (
          title, album_id, duration_ms, popularity, explicit, track_number, disc_number,
          custom_mood, genre, parent_genre, data_source, manual_song_id, vegan_focus, animal_category, 
          advocacy_style, advocacy_issues, lyrical_explicitness, your_review, 
          audio_review_url, inclusion_notes, rating, energy, danceability, valence, 
          acousticness, instrumentalness, liveness, speechiness, tempo, loudness, 
          key, mode, time_signature, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        title, albumId, duration_ms, popularity, explicit, track_number, disc_number,
        custom_mood, genre, finalParentGenre, 'manual', manualSongId, vegan_focus, animal_category, 
        advocacy_style, advocacy_issues, lyrical_explicitness, your_review, 
        audio_review_url, inclusion_notes, rating, energy, danceability, valence, 
        acousticness, instrumentalness, liveness, speechiness, tempo, loudness, 
        key, mode, time_signature
      ]);
      
      const songId = songResult.rows[0].id;
      
      // 5. Link artists to song
      for (const artistId of artistIds) {
        await client.query(
          'INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2)',
          [songId, artistId]
        );
      }
      
      // Audio features are now stored directly in the songs table
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        manual_song_id: manualSongId,
        song_id: songId,
        message: 'Manual song added successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error adding manual song:', error);
    res.status(500).json({ error: 'Failed to add manual song', details: error.message });
  }
});

// Update an existing manual song
router.put('/manual-songs/:id', async (req, res) => {
  try {
    const manualSongId = req.params.id;
    const updates = req.body;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Update manual_songs table - add any missing fields that should be in manual_songs
      const manualSongFields = [
        'title', 'artist_names', 'album_name', 'duration_ms', 'release_date',
        'external_url', 'audio_file_path', 'lyrics', 'notes'
      ];
      
      const updateParts = [];
      const values = [];
      let paramIndex = 1;
      
      manualSongFields.forEach(field => {
        if (updates[field] !== undefined) {
          updateParts.push(`${field} = $${paramIndex}`);
          values.push(updates[field]);
          paramIndex++;
        }
      });
      
      if (updateParts.length > 0) {
        updateParts.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(manualSongId);
        
        await client.query(`
          UPDATE manual_songs 
          SET ${updateParts.join(', ')}
          WHERE id = $${paramIndex}
        `, values);
      }
      
      // Update categorizations in songs table if song exists
      const songResult = await client.query(
        'SELECT id FROM songs WHERE manual_song_id = $1',
        [manualSongId]
      );
      
      if (songResult.rows.length > 0) {
        const songId = songResult.rows[0].id;
        
        // Update all song fields
        const categoryFields = [
          'popularity', 'explicit', 'track_number', 'disc_number', 'custom_mood',
          'genre', 'parent_genre', 'vegan_focus', 'animal_category', 'advocacy_style', 'advocacy_issues', 
          'lyrical_explicitness', 'your_review', 'audio_review_url', 'inclusion_notes', 
          'rating', 'energy', 'danceability', 'valence', 'acousticness', 
          'instrumentalness', 'liveness', 'speechiness', 'tempo', 'loudness', 
          'key', 'mode', 'time_signature'
        ];
        
        const categoryUpdates = [];
        const categoryValues = [];
        let categoryParamIndex = 1;
        
        categoryFields.forEach(field => {
          if (updates[field] !== undefined) {
            categoryUpdates.push(`${field} = $${categoryParamIndex}`);
            categoryValues.push(updates[field]);
            categoryParamIndex++;
          }
        });
        
        if (categoryUpdates.length > 0) {
          categoryUpdates.push(`updated_at = CURRENT_TIMESTAMP`);
          categoryValues.push(songId);
          
          await client.query(`
            UPDATE songs 
            SET ${categoryUpdates.join(', ')}
            WHERE id = $${categoryParamIndex}
          `, categoryValues);
        }
        
        // Audio features are now stored directly in the songs table
      }
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Manual song updated successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error updating manual song:', error);
    res.status(500).json({ error: 'Failed to update manual song', details: error.message });
  }
});

// Delete a manual song
router.delete('/manual-songs/:id', async (req, res) => {
  try {
    const manualSongId = req.params.id;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get the song_id to clean up related records
      const songResult = await client.query(
        'SELECT id FROM songs WHERE manual_song_id = $1',
        [manualSongId]
      );
      
      if (songResult.rows.length > 0) {
        const songId = songResult.rows[0].id;
        
        // Delete from songs table (cascades to song_artists)
        await client.query('DELETE FROM songs WHERE id = $1', [songId]);
      }
      
      // Delete from manual_songs
      await client.query('DELETE FROM manual_songs WHERE id = $1', [manualSongId]);
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Manual song deleted successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error deleting manual song:', error);
    res.status(500).json({ error: 'Failed to delete manual song', details: error.message });
  }
});

// Get categorization options
router.get('/categorization-options', async (req, res) => {
  try {
    // Get existing category values from songs
    const queries = {
      vegan_focus: `SELECT DISTINCT UNNEST(vegan_focus) as value FROM songs WHERE vegan_focus IS NOT NULL`,
      animal_category: `SELECT DISTINCT UNNEST(animal_category) as value FROM songs WHERE animal_category IS NOT NULL`,
      advocacy_style: `SELECT DISTINCT UNNEST(advocacy_style) as value FROM songs WHERE advocacy_style IS NOT NULL`,
      advocacy_issues: `SELECT DISTINCT UNNEST(advocacy_issues) as value FROM songs WHERE advocacy_issues IS NOT NULL`,
      lyrical_explicitness: `SELECT DISTINCT UNNEST(lyrical_explicitness) as value FROM songs WHERE lyrical_explicitness IS NOT NULL`
    };
    
    const results = {};
    
    for (const [category, query] of Object.entries(queries)) {
      const result = await pool.query(query);
      results[category] = result.rows.map(row => row.value).sort();
    }
    
    // Add genre options from the hierarchy
    results.parent_genres = getParentGenres();
    results.subgenres = getAllSubgenres();
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching categorization options:', error);
    res.status(500).json({ error: 'Failed to fetch categorization options' });
  }
});

// Update categorizations for any song (Spotify or manual)
router.put('/songs/:id/categorize', async (req, res) => {
  try {
    const songId = req.params.id;
    const {
      // Basic info
      title,
      album_name,
      duration_ms,
      popularity,
      explicit,
      track_number,
      disc_number,
      custom_mood,
      external_url,
      audio_file_path,
      lyrics,
      notes,
      // Genre
      genre,
      parent_genre,
      // Categorization
      vegan_focus,
      animal_category,
      advocacy_style,
      advocacy_issues,
      lyrical_explicitness,
      your_review,
      audio_review_url,
      inclusion_notes,
      rating,
      // Audio features
      energy,
      danceability,
      valence,
      acousticness,
      instrumentalness,
      liveness,
      speechiness,
      tempo,
      loudness,
      key,
      mode,
      time_signature
    } = req.body;

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Update the songs table directly
      const updateFields = [];
      const values = [];
      let paramIndex = 1;
      
      // Basic info fields
      if (title !== undefined) {
        updateFields.push(`title = $${paramIndex++}`);
        values.push(title);
      }
      if (duration_ms !== undefined) {
        updateFields.push(`duration_ms = $${paramIndex++}`);
        values.push(duration_ms);
      }
      if (popularity !== undefined) {
        updateFields.push(`popularity = $${paramIndex++}`);
        values.push(popularity);
      }
      if (explicit !== undefined) {
        updateFields.push(`explicit = $${paramIndex++}`);
        values.push(explicit);
      }
      if (track_number !== undefined) {
        updateFields.push(`track_number = $${paramIndex++}`);
        values.push(track_number);
      }
      if (disc_number !== undefined) {
        updateFields.push(`disc_number = $${paramIndex++}`);
        values.push(disc_number);
      }
      if (custom_mood !== undefined) {
        updateFields.push(`custom_mood = $${paramIndex++}`);
        values.push(custom_mood);
      }
      if (audio_review_url !== undefined) {
        updateFields.push(`audio_review_url = $${paramIndex++}`);
        values.push(audio_review_url);
      }
      if (inclusion_notes !== undefined) {
        updateFields.push(`inclusion_notes = $${paramIndex++}`);
        values.push(inclusion_notes);
      }
      
      // Genre fields
      if (genre !== undefined) {
        updateFields.push(`genre = $${paramIndex++}`);
        values.push(genre);
      }
      if (parent_genre !== undefined) {
        updateFields.push(`parent_genre = $${paramIndex++}`);
        values.push(parent_genre);
      } else if (genre !== undefined) {
        // Auto-calculate parent_genre if genre is provided but parent_genre is not
        const calculatedParentGenre = getParentGenre(genre);
        updateFields.push(`parent_genre = $${paramIndex++}`);
        values.push(calculatedParentGenre);
      }
      
      // Categorization fields
      if (vegan_focus !== undefined) {
        updateFields.push(`vegan_focus = $${paramIndex++}`);
        values.push(vegan_focus);
      }
      if (animal_category !== undefined) {
        updateFields.push(`animal_category = $${paramIndex++}`);
        values.push(animal_category);
      }
      if (advocacy_style !== undefined) {
        updateFields.push(`advocacy_style = $${paramIndex++}`);
        values.push(advocacy_style);  
      }
      if (advocacy_issues !== undefined) {
        updateFields.push(`advocacy_issues = $${paramIndex++}`);
        values.push(advocacy_issues);
      }
      if (lyrical_explicitness !== undefined) {
        updateFields.push(`lyrical_explicitness = $${paramIndex++}`);
        values.push(lyrical_explicitness);
      }
      if (your_review !== undefined) {
        updateFields.push(`your_review = $${paramIndex++}`);
        values.push(your_review);
      }
      if (rating !== undefined) {
        updateFields.push(`rating = $${paramIndex++}`);
        values.push(rating ? parseInt(rating) : null);
      }
      
      // Audio features
      if (energy !== undefined) {
        updateFields.push(`energy = $${paramIndex++}`);
        values.push(energy);
      }
      if (danceability !== undefined) {
        updateFields.push(`danceability = $${paramIndex++}`);
        values.push(danceability);
      }
      if (valence !== undefined) {
        updateFields.push(`valence = $${paramIndex++}`);
        values.push(valence);
      }
      if (acousticness !== undefined) {
        updateFields.push(`acousticness = $${paramIndex++}`);
        values.push(acousticness);
      }
      if (instrumentalness !== undefined) {
        updateFields.push(`instrumentalness = $${paramIndex++}`);
        values.push(instrumentalness);
      }
      if (liveness !== undefined) {
        updateFields.push(`liveness = $${paramIndex++}`);
        values.push(liveness);
      }
      if (speechiness !== undefined) {
        updateFields.push(`speechiness = $${paramIndex++}`);
        values.push(speechiness);
      }
      if (tempo !== undefined) {
        updateFields.push(`tempo = $${paramIndex++}`);
        values.push(tempo);
      }
      if (loudness !== undefined) {
        updateFields.push(`loudness = $${paramIndex++}`);
        values.push(loudness);
      }
      if (key !== undefined) {
        updateFields.push(`key = $${paramIndex++}`);
        values.push(key);
      }
      if (mode !== undefined) {
        updateFields.push(`mode = $${paramIndex++}`);
        values.push(mode);
      }
      if (time_signature !== undefined) {
        updateFields.push(`time_signature = $${paramIndex++}`);
        values.push(time_signature);
      }
      
      if (updateFields.length > 0) {
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(songId);
        
        await client.query(`
          UPDATE songs 
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex}
        `, values);
      }
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Song categorization updated successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error updating song categorization:', error);
    res.status(500).json({ error: 'Failed to update song categorization' });
  }
});

// Bulk categorize existing songs
router.post('/categorize-songs', async (req, res) => {
  try {
    const { song_ids, categories } = req.body;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const songId of song_ids) {
        // Insert or update manual categorizations
        for (const [categoryType, categoryValues] of Object.entries(categories)) {
          if (categoryValues && categoryValues.length > 0) {
            await client.query(`
              INSERT INTO manual_categorizations (song_id, category_type, category_values, created_by)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (song_id, category_type) DO UPDATE SET
                category_values = EXCLUDED.category_values,
                updated_at = CURRENT_TIMESTAMP
            `, [songId, categoryType, categoryValues, 'admin']);
          }
        }
      }
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: `Successfully categorized ${song_ids.length} songs`
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error categorizing songs:', error);
    res.status(500).json({ error: 'Failed to categorize songs', details: error.message });
  }
});

// Bulk upload CSV endpoint
router.post('/bulk-upload', upload.single('csv'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    filePath = req.file.path;
    const results = [];
    const errors = [];
    let processed = 0;
    let updated = 0;

    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Processing ${results.length} rows from CSV`);

    // Process each row
    for (const row of results) {
      processed++;
      
      try {
        const songId = parseInt(row.ID || row.id);
        
        if (!songId || isNaN(songId)) {
          errors.push(`Row ${processed}: Invalid or missing song ID`);
          continue;
        }

        // Parse array fields (comma-separated values)
        const parseArrayField = (value) => {
          if (!value || value.trim() === '') return null;
          return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
        };

        const updateData = {
          vegan_focus: parseArrayField(row['Vegan Focus'] || row.vegan_focus),
          animal_category: parseArrayField(row['Animal Category'] || row.animal_category),
          advocacy_style: parseArrayField(row['Advocacy Style'] || row.advocacy_style),
          advocacy_issues: parseArrayField(row['Advocacy Issues'] || row.advocacy_issues),
          lyrical_explicitness: parseArrayField(row['Lyrical Explicitness'] || row.lyrical_explicitness)
        };

        // Update song in database
        const updateResult = await pool.query(`
          UPDATE songs 
          SET 
            vegan_focus = $2,
            animal_category = $3,
            advocacy_style = $4,
            advocacy_issues = $5,
            lyrical_explicitness = $6,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [
          songId,
          updateData.vegan_focus,
          updateData.animal_category,
          updateData.advocacy_style,
          updateData.advocacy_issues,
          updateData.lyrical_explicitness
        ]);

        if (updateResult.rowCount > 0) {
          updated++;
        } else {
          errors.push(`Row ${processed}: Song ID ${songId} not found`);
        }

      } catch (rowError) {
        console.error(`Error processing row ${processed}:`, rowError);
        errors.push(`Row ${processed}: ${rowError.message}`);
      }
    }

    // Clean up uploaded file
    if (filePath) {
      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      processed,
      updated,
      errors: errors.length,
      errorDetails: errors.slice(0, 10) // Return first 10 errors
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    
    // Clean up uploaded file on error
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.status(500).json({ 
      error: 'Failed to process CSV upload', 
      details: error.message 
    });
  }
});

// Update single song endpoint (for individual edits)
console.log('Registering PUT /update-song/:id route');
router.put('/update-song/:id', async (req, res) => {
  try {
    console.log('=== UPDATE-SONG ENDPOINT HIT ===');
    console.log('PUT /update-song/:id called with params:', req.params);
    console.log('Request body:', req.body);
    
    const songId = parseInt(req.params.id);
    
    // If only featured is being updated, do a simpler query
    if (typeof req.body.featured === 'boolean' && Object.keys(req.body).length === 1) {
      const featured = req.body.featured;
      console.log('Updating featured status:', { songId, featured });
      
      try {
        // First, let's check what columns exist
        const checkResult = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'songs' AND column_name = 'featured'
        `);
        console.log('Featured column exists:', checkResult.rows.length > 0);

        // Try a simple select first
        const selectResult = await pool.query(`
          SELECT id, title, featured FROM songs WHERE id = $1
        `, [songId]);
        console.log('Current song data:', selectResult.rows[0]);

        const result = await pool.query(`
          UPDATE songs 
          SET featured = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING id, title, featured
        `, [songId, featured]);

        console.log('Update result:', result.rows[0]);
        console.log('Row count:', result.rowCount);

        if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Song not found' });
        }

        // Since the RETURNING clause isn't working, let's manually construct the response
        // and verify the update worked by querying again
        console.log('FEATURED UPDATE: Querying database after update...');
        const verifyQuery = await pool.query('SELECT id, title, featured FROM songs WHERE id = $1', [songId]);
        console.log('FEATURED UPDATE: Verify query result:', verifyQuery.rows[0]);
        
        const responseData = {
          success: true,
          song: verifyQuery.rows[0] || {
            id: songId,
            title: 'Unknown',
            featured: featured
          }
        };
        console.log('FEATURED UPDATE: Sending response:', responseData);
        
        return res.json(responseData);
      } catch (dbError) {
        console.error('Database error in featured update:', dbError);
        return res.status(500).json({ error: 'Database error: ' + dbError.message });
      }
    }

    // Handle categorization updates
    const {
      vegan_focus,
      animal_category,
      advocacy_style,
      advocacy_issues,
      lyrical_explicitness,
      featured
    } = req.body;

    // Build dynamic query based on provided fields
    const fields = [];
    const values = [songId];
    let paramCount = 1;

    if (vegan_focus !== undefined) {
      paramCount++;
      fields.push(`vegan_focus = $${paramCount}`);
      values.push(vegan_focus || null);
    }
    if (animal_category !== undefined) {
      paramCount++;
      fields.push(`animal_category = $${paramCount}`);
      values.push(animal_category || null);
    }
    if (advocacy_style !== undefined) {
      paramCount++;
      fields.push(`advocacy_style = $${paramCount}`);
      values.push(advocacy_style || null);
    }
    if (advocacy_issues !== undefined) {
      paramCount++;
      fields.push(`advocacy_issues = $${paramCount}`);
      values.push(advocacy_issues || null);
    }
    if (lyrical_explicitness !== undefined) {
      paramCount++;
      fields.push(`lyrical_explicitness = $${paramCount}`);
      values.push(lyrical_explicitness || null);
    }
    if (featured !== undefined) {
      paramCount++;
      fields.push(`featured = $${paramCount}`);
      values.push(featured);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    const result = await pool.query(`
      UPDATE songs 
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING id, title, featured
    `, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    res.json({
      success: true,
      song: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating song:', error);
    res.status(500).json({ 
      error: 'Failed to update song', 
      details: error.message 
    });
  }
});

console.log('About to define playlist routes...');

// Test route before playlists
router.get('/test-playlists', (req, res) => {
  res.json({ message: 'Test route before playlists works!' });
});

// Get all playlists for admin management
router.get('/playlists', async (req, res) => {
  console.log('Admin playlists route hit!');
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
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    // Get total count for pagination
    const countResult = await pool.query(`SELECT COUNT(*) FROM playlists`);
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
    console.error('Error fetching playlists for admin:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// Delete a playlist (admin only)
router.delete('/playlists/:id', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    
    const result = await pool.query(`
      DELETE FROM playlists WHERE id = $1 RETURNING *
    `, [playlistId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    res.json({
      message: 'Playlist deleted successfully',
      playlist: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

// Save YouTube video endpoint (admin only)
router.post('/save-youtube-video', async (req, res) => {
  try {
    const { song_id, youtube_url } = req.body;
    
    if (!song_id || !youtube_url) {
      return res.status(400).json({
        success: false,
        error: 'Song ID and YouTube URL are required'
      });
    }
    
    // Utility function to extract YouTube video ID from URL
    const extractYouTubeId = (url) => {
      if (!url) return null;
      
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
      ];
      
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
      }
      
      return null;
    };
    
    // Extract YouTube ID from URL
    const youtubeId = extractYouTubeId(youtube_url);
    if (!youtubeId || !/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL or video ID'
      });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if video already exists for this song
      const existingVideo = await client.query(
        'SELECT id FROM youtube_videos WHERE song_id = $1 AND youtube_id = $2',
        [song_id, youtubeId]
      );
      
      if (existingVideo.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.json({
          success: true,
          message: 'Video already exists for this song'
        });
      }
      
      // Unset other primary videos for this song
      await client.query(
        'UPDATE youtube_videos SET is_primary = false WHERE song_id = $1',
        [song_id]
      );
      
      // Generate thumbnail URL
      const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
      
      // Insert new video
      const result = await client.query(`
        INSERT INTO youtube_videos (
          song_id, youtube_id, thumbnail_url, video_type, is_primary, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *
      `, [song_id, youtubeId, thumbnailUrl, 'official', true]);
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        video: result.rows[0],
        message: 'YouTube video saved successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error saving YouTube video:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save YouTube video',
      details: error.message
    });
  }
});

module.exports = router;