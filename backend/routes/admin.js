// Admin API (password-protected via x-admin-password). Routes are grouped into
// six domains — Songs / curation · Enrichment · Data quality · Sync (import-only) ·
// Artists · Staging / lifecycle — per docs/ADMIN_AUDIT.md (Session 2.2).
const express = require('express');
const pool = require('../database/db');
const { getParentGenres, getAllSubgenres, getParentGenre } = require('../utils/genreMapping');
const staging = require('../services/staging');
const curation = require('../services/curation');
const videos = require('../services/videos');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const router = express.Router();

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
  const password = req.headers['x-admin-password'] || (req.body && req.body.admin_password) || req.query.admin_password;
  
  
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  next();
};

// Apply admin authentication to all routes
router.use(authenticateAdmin);

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// ==================== Songs / curation ====================

// Get all songs (both Spotify and manual) for management
router.get('/all-songs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    let whereClause = '';
    let havingClause = '';
    let params = [limit, offset];
    
    if (search) {
      whereClause = `WHERE (s.title ILIKE $3 OR EXISTS (
        SELECT 1 FROM song_artists sa2 
        JOIN artists a2 ON sa2.artist_id = a2.id 
        WHERE sa2.song_id = s.id AND a2.name ILIKE $3
      ))`;
      params.push(`%${search}%`);
    }
    
    const result = await pool.query(`
      SELECT 
        s.*,
        string_agg(a.name, ', ' ORDER BY a.name) as artists,
        al.name as album_name,
        ms.id as manual_song_id,
        ms.external_url,
        ms.audio_file_path,
        ms.lyrics,
        ms.notes,
        CASE WHEN s.data_source = 'manual' THEN 'Manual' ELSE 'Spotify' END as source_type,
        yv.youtube_id,
        yv.thumbnail_url as youtube_thumbnail,
        yv.video_type as youtube_video_type,
        yv.video_title as youtube_title
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN albums al ON s.album_id = al.id
      LEFT JOIN manual_songs ms ON s.manual_song_id = ms.id
      LEFT JOIN youtube_videos yv ON s.id = yv.song_id AND yv.is_primary = true
      ${whereClause}
      GROUP BY s.id, al.name, ms.id, ms.external_url, ms.audio_file_path, ms.lyrics, ms.notes, yv.youtube_id, yv.thumbnail_url, yv.video_type, yv.video_title
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

// Remove a song (mark as deleted or actually delete)
router.delete('/songs/:id', async (req, res) => {
  try {
    const songId = parseInt(req.params.id);
    const { reason = 'duplicate' } = req.body;
    
    console.log(`Removing song ${songId} for reason: ${reason}`);
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get song info before deletion
      const songInfo = await client.query(`
        SELECT s.id, s.title, s.spotify_id, string_agg(a.name, ', ') as artists
        FROM songs s
        LEFT JOIN song_artists sa ON s.id = sa.song_id
        LEFT JOIN artists a ON sa.artist_id = a.id
        WHERE s.id = $1
        GROUP BY s.id, s.title, s.spotify_id
      `, [songId]);
      
      if (songInfo.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Song not found' });
      }
      
      const song = songInfo.rows[0];
      
      // Delete related records (cascading should handle most, but let's be explicit)
      await client.query('DELETE FROM song_artists WHERE song_id = $1', [songId]);
      await client.query('DELETE FROM youtube_videos WHERE song_id = $1', [songId]);
      await client.query('DELETE FROM playlist_songs WHERE song_id = $1', [songId]);
      
      // Delete the song itself
      const deleteResult = await client.query('DELETE FROM songs WHERE id = $1', [songId]);
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: `Song "${song.title}" by ${song.artists} has been removed`,
        deletedSong: song,
        reason
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error removing song:', error);
    res.status(500).json({
      error: 'Failed to remove song',
      details: error.message
    });
  }
});

// ==================== Enrichment (YouTube / lyrics links / completion stats) ====================

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

// Get database completion statistics
router.get('/completion-stats', async (req, res) => {
  try {
    console.log('Fetching completion statistics...');
    
    // Get total song count
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM songs');
    const totalSongs = parseInt(totalResult.rows[0].total);

    // Basic metadata completion
    const metadataFields = [
      { field: 'title', label: 'Song Title', type: 'string' },
      { field: 'duration_ms', label: 'Duration', type: 'number' },
      { field: 'popularity', label: 'Popularity Score', type: 'number' },
      { field: 'explicit', label: 'Explicit Flag', type: 'boolean' },
      { field: 'album_id', label: 'Album Info', type: 'number' },
      { field: 'track_number', label: 'Track Number', type: 'number' },
      { field: 'genre', label: 'Genre', type: 'string' },
      { field: 'parent_genre', label: 'Parent Genre', type: 'string' }
    ];

    const metadataStats = {};
    for (const { field, label, type } of metadataFields) {
      let query;
      if (type === 'string') {
        query = `SELECT COUNT(*) as completed FROM songs WHERE ${field} IS NOT NULL AND TRIM(${field}) != ''`;
      } else if (type === 'boolean') {
        query = `SELECT COUNT(*) as completed FROM songs WHERE ${field} IS NOT NULL`;
      } else {
        query = `SELECT COUNT(*) as completed FROM songs WHERE ${field} IS NOT NULL AND ${field} != 0`;
      }
      
      const result = await pool.query(query);
      const completed = parseInt(result.rows[0].completed);
      metadataStats[field] = {
        label,
        completed,
        total: totalSongs,
        percentage: Math.round((completed / totalSongs) * 100)
      };
    }

    // Vegan categorization stats
    const veganFields = [
      'vegan_focus', 'animal_category', 'advocacy_style', 'advocacy_issues', 'lyrical_explicitness'
    ];

    const veganStats = {};
    for (const field of veganFields) {
      const result = await pool.query(`
        SELECT COUNT(*) as completed 
        FROM songs 
        WHERE ${field} IS NOT NULL AND array_length(${field}, 1) > 0
      `);
      const completed = parseInt(result.rows[0].completed);
      veganStats[field] = {
        completed,
        total: totalSongs,
        percentage: Math.round((completed / totalSongs) * 100)
      };
    }

    // YouTube video stats
    const youtubeResult = await pool.query(`
      SELECT COUNT(DISTINCT s.id) as songs_with_videos
      FROM songs s
      INNER JOIN youtube_videos yv ON s.id = yv.song_id
    `);
    const songsWithVideos = parseInt(youtubeResult.rows[0].songs_with_videos);
    const youtubeStats = {
      completed: songsWithVideos,
      total: totalSongs,
      percentage: Math.round((songsWithVideos / totalSongs) * 100),
      missing: totalSongs - songsWithVideos
    };

    // Audio features stats
    const audioFields = [
      'energy', 'danceability', 'valence', 'acousticness', 
      'instrumentalness', 'speechiness', 'tempo', 'loudness'
    ];

    const audioStats = {};
    for (const field of audioFields) {
      const result = await pool.query(`
        SELECT COUNT(*) as completed FROM songs WHERE ${field} IS NOT NULL
      `);
      const completed = parseInt(result.rows[0].completed);
      audioStats[field] = {
        completed,
        total: totalSongs,
        percentage: Math.round((completed / totalSongs) * 100)
      };
    }

    // Content stats (reviews, lyrics, etc.)
    const contentStats = {};
    
    // Reviews and ratings (in songs table)
    const reviewFields = [
      { field: 'your_review', table: 'songs', type: 'text' },
      { field: 'rating', table: 'songs', type: 'number' },
      { field: 'inclusion_notes', table: 'songs', type: 'text' }
    ];

    for (const { field, type } of reviewFields) {
      let query;
      if (type === 'text') {
        query = `SELECT COUNT(*) as completed FROM songs WHERE ${field} IS NOT NULL AND TRIM(${field}) != ''`;
      } else {
        query = `SELECT COUNT(*) as completed FROM songs WHERE ${field} IS NOT NULL AND ${field} > 0`;
      }
      
      const result = await pool.query(query);
      const completed = parseInt(result.rows[0].completed);
      contentStats[field] = {
        completed,
        total: totalSongs,
        percentage: Math.round((completed / totalSongs) * 100)
      };
    }

    // Lyrics URL and highlights tracking (in songs table)
    const lyricsFields = [
      { field: 'lyrics_url', type: 'text' },
      { field: 'lyrics_highlights', type: 'text' }
    ];
    
    for (const { field, type } of lyricsFields) {
      try {
        // Check if column exists first
        const columnExists = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'songs' 
          AND table_schema = 'public'
          AND column_name = $1
        `, [field]);
        
        if (columnExists.rows.length > 0) {
          const result = await pool.query(`
            SELECT COUNT(*) as completed FROM songs 
            WHERE ${field} IS NOT NULL AND TRIM(${field}) != ''
          `);
          const completed = parseInt(result.rows[0].completed);
          contentStats[field] = {
            completed,
            total: totalSongs,
            percentage: Math.round((completed / totalSongs) * 100)
          };
        } else {
          // Column doesn't exist - set to 0
          contentStats[field] = {
            completed: 0,
            total: totalSongs,
            percentage: 0
          };
        }
      } catch (error) {
        console.log(`Error checking ${field}:`, error.message);
        // Fallback to 0 if there's any error
        contentStats[field] = {
          completed: 0,
          total: totalSongs,
          percentage: 0
        };
      }
    }

    // Lyrics and notes (in manual_songs table)
    const manualFields = ['lyrics', 'notes'];
    for (const field of manualFields) {
      const result = await pool.query(`
        SELECT COUNT(*) as completed 
        FROM songs s
        LEFT JOIN manual_songs ms ON s.manual_song_id = ms.id
        WHERE ms.${field} IS NOT NULL AND TRIM(ms.${field}) != ''
      `);
      const completed = parseInt(result.rows[0].completed);
      contentStats[field] = {
        completed,
        total: totalSongs,
        percentage: Math.round((completed / totalSongs) * 100)
      };
    }

    // Most incomplete songs for recommendations
    const incompleteResult = await pool.query(`
      SELECT 
        s.id,
        s.title,
        string_agg(a.name, ', ') as artists,
        CASE WHEN yv.song_id IS NOT NULL THEN 1 ELSE 0 END as has_video,
        CASE WHEN s.vegan_focus IS NOT NULL AND array_length(s.vegan_focus, 1) > 0 THEN 1 ELSE 0 END as has_vegan_focus,
        CASE WHEN s.genre IS NOT NULL THEN 1 ELSE 0 END as has_genre
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN (SELECT DISTINCT song_id FROM youtube_videos) yv ON s.id = yv.song_id
      GROUP BY s.id, s.title, s.vegan_focus, s.genre, yv.song_id
      ORDER BY (CASE WHEN yv.song_id IS NOT NULL THEN 1 ELSE 0 END +
                CASE WHEN s.vegan_focus IS NOT NULL AND array_length(s.vegan_focus, 1) > 0 THEN 1 ELSE 0 END +
                CASE WHEN s.genre IS NOT NULL THEN 1 ELSE 0 END) ASC
      LIMIT 20
    `);

    const response = {
      total: totalSongs,
      metadata: metadataStats,
      vegan: veganStats,
      youtube: youtubeStats,
      audio: audioStats,
      content: contentStats,
      mostIncomplete: incompleteResult.rows,
      lastUpdated: new Date().toISOString()
    };

    console.log('Completion stats generated successfully');
    res.json(response);

  } catch (error) {
    console.error('Error generating completion stats:', error);
    res.status(500).json({ 
      error: 'Failed to generate completion statistics',
      details: error.message 
    });
  }
});

// Save lyrics link endpoint (admin only)
router.post('/save-lyrics-link', async (req, res) => {
  try {
    const { song_id, lyrics_url, lyrics_source = 'other', lyrics_highlights = '', link_type = 'external' } = req.body;
    
    if (!song_id || !lyrics_url) {
      return res.status(400).json({
        success: false,
        error: 'Song ID and lyrics URL are required'
      });
    }

    // Validate URL format
    try {
      new URL(lyrics_url);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if song exists
      const songCheck = await client.query('SELECT id, title FROM songs WHERE id = $1', [song_id]);
      if (songCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Song not found'
        });
      }

      // Check if lyrics columns exist
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'songs' 
        AND table_schema = 'public'
        AND column_name IN ('lyrics_url', 'lyrics_source', 'lyrics_highlights')
      `);
      
      const existingColumns = columnCheck.rows.map(row => row.column_name);
      
      if (existingColumns.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Lyrics functionality not enabled. Please run the lyrics setup script.',
          setupRequired: true
        });
      }

      // Auto-detect source from URL if not provided
      let detectedSource = lyrics_source;
      if (lyrics_url.includes('genius.com')) {
        detectedSource = 'genius';
      } else if (lyrics_url.includes('bandcamp.com')) {
        detectedSource = 'bandcamp';
      }

      // Build update query based on available columns
      let updateQuery = 'UPDATE songs SET updated_at = CURRENT_TIMESTAMP';
      let params = [];
      let paramIndex = 1;
      
      if (existingColumns.includes('lyrics_url')) {
        updateQuery += `, lyrics_url = $${paramIndex}`;
        params.push(lyrics_url);
        paramIndex++;
      }
      
      if (existingColumns.includes('lyrics_source')) {
        updateQuery += `, lyrics_source = $${paramIndex}`;
        params.push(detectedSource);
        paramIndex++;
      }
      
      if (existingColumns.includes('lyrics_highlights') && lyrics_highlights.trim()) {
        updateQuery += `, lyrics_highlights = $${paramIndex}`;
        params.push(lyrics_highlights.trim());
        paramIndex++;
      }
      
      updateQuery += ` WHERE id = $${paramIndex} RETURNING title`;
      params.push(song_id);

      const updateResult = await client.query(updateQuery, params);
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Lyrics link saved successfully',
        song_title: updateResult.rows[0].title,
        source: detectedSource,
        columnsUpdated: existingColumns
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error saving lyrics link:', error);
    
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      res.status(400).json({
        success: false,
        error: 'Lyrics database columns not found. Please run the lyrics setup script.',
        setupRequired: true,
        details: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to save lyrics link',
        details: error.message
      });
    }
  }
});

// Get songs missing lyrics links (admin endpoint)
router.get('/songs-missing-lyrics', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // First check if lyrics columns exist
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'songs' 
      AND table_schema = 'public'
      AND column_name IN ('lyrics_url', 'lyrics_source')
    `);
    
    const hasLyricsColumns = columnCheck.rows.length > 0;
    
    let songsQuery, countQuery;
    
    if (hasLyricsColumns) {
      // Full query with lyrics support
      songsQuery = `
        SELECT 
          s.id,
          s.title,
          string_agg(a.name, ', ') as artists,
          s.popularity,
          s.lyrics_url,
          CASE 
            WHEN s.vegan_focus IS NOT NULL AND array_length(s.vegan_focus, 1) > 0 
            THEN 1 ELSE 0 
          END as has_vegan_focus,
          s.created_at
        FROM songs s
        LEFT JOIN song_artists sa ON s.id = sa.song_id
        LEFT JOIN artists a ON sa.artist_id = a.id
        WHERE s.lyrics_url IS NULL OR s.lyrics_url = ''
        GROUP BY s.id, s.title, s.popularity, s.lyrics_url, s.vegan_focus, s.created_at
        ORDER BY 
          (CASE WHEN s.vegan_focus IS NOT NULL AND array_length(s.vegan_focus, 1) > 0 THEN 1 ELSE 0 END) DESC,
          s.popularity DESC NULLS LAST, 
          s.title
        LIMIT $1 OFFSET $2
      `;
      
      countQuery = `
        SELECT COUNT(*) as total
        FROM songs s
        WHERE s.lyrics_url IS NULL OR s.lyrics_url = ''
      `;
    } else {
      // Fallback query without lyrics columns - show all songs
      songsQuery = `
        SELECT 
          s.id,
          s.title,
          string_agg(a.name, ', ') as artists,
          s.popularity,
          NULL as lyrics_url,
          CASE 
            WHEN s.vegan_focus IS NOT NULL AND array_length(s.vegan_focus, 1) > 0 
            THEN 1 ELSE 0 
          END as has_vegan_focus,
          s.created_at
        FROM songs s
        LEFT JOIN song_artists sa ON s.id = sa.song_id
        LEFT JOIN artists a ON sa.artist_id = a.id
        GROUP BY s.id, s.title, s.popularity, s.vegan_focus, s.created_at
        ORDER BY 
          (CASE WHEN s.vegan_focus IS NOT NULL AND array_length(s.vegan_focus, 1) > 0 THEN 1 ELSE 0 END) DESC,
          s.popularity DESC NULLS LAST, 
          s.title
        LIMIT $1 OFFSET $2
      `;
      
      countQuery = `SELECT COUNT(*) as total FROM songs`;
    }

    // Get songs
    const songsResult = await pool.query(songsQuery, [limit, offset]);

    // Get total count
    const countResult = await pool.query(countQuery);

    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      songs: songsResult.rows,
      hasLyricsSupport: hasLyricsColumns,
      pagination: {
        page,
        pages,
        limit,
        total,
        hasNext: page < pages,
        hasPrev: page > 1
      },
      message: hasLyricsColumns ? undefined : 'Lyrics columns not found - run setup script to enable lyrics functionality'
    });

  } catch (error) {
    console.error('Error fetching songs missing lyrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch songs missing lyrics',
      details: error.message
    });
  }
});

// ==================== Data quality ====================

// Detect potential duplicate songs
router.get('/duplicate-songs', async (req, res) => {
  try {
    console.log('Detecting duplicate songs...');
    
    // Get all songs with basic info
    const songsResult = await pool.query(`
      SELECT 
        s.id,
        s.title,
        s.spotify_id,
        s.duration_ms,
        s.popularity,
        s.data_source,
        s.created_at,
        string_agg(a.name, ', ' ORDER BY a.name) as artists,
        al.name as album_name
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN albums al ON s.album_id = al.id
      GROUP BY s.id, s.title, s.spotify_id, s.duration_ms, s.popularity, s.data_source, s.created_at, al.name
      ORDER BY s.title, s.created_at
    `);
    
    const songs = songsResult.rows;
    const duplicateGroups = [];
    const processed = new Set();
    
    // Helper function to normalize text for comparison
    const normalize = (text) => {
      if (!text) return '';
      return text.toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ')     // Normalize whitespace
        .trim();
    };
    
    // Helper function to calculate similarity score
    const calculateSimilarity = (song1, song2) => {
      let score = 0;
      
      // Title similarity (weighted heavily)
      const title1 = normalize(song1.title);
      const title2 = normalize(song2.title);
      
      if (title1 === title2) {
        score += 50; // Exact title match
      } else if (title1.includes(title2) || title2.includes(title1)) {
        score += 30; // One title contains the other
      } else {
        // Check for significant word overlap
        const words1 = title1.split(' ').filter(w => w.length > 2);
        const words2 = title2.split(' ').filter(w => w.length > 2);
        const commonWords = words1.filter(w => words2.includes(w));
        if (commonWords.length > 0 && words1.length > 0) {
          score += (commonWords.length / Math.max(words1.length, words2.length)) * 25;
        }
      }
      
      // Artist similarity
      const artists1 = normalize(song1.artists || '');
      const artists2 = normalize(song2.artists || '');
      
      if (artists1 === artists2) {
        score += 30; // Same artists
      } else if (artists1.includes(artists2) || artists2.includes(artists1)) {
        score += 20; // One artist list contains the other
      }
      
      // Duration similarity (within 5 seconds)
      if (song1.duration_ms && song2.duration_ms) {
        const durationDiff = Math.abs(song1.duration_ms - song2.duration_ms);
        if (durationDiff <= 5000) { // Within 5 seconds
          score += 15;
        } else if (durationDiff <= 10000) { // Within 10 seconds
          score += 10;
        }
      }
      
      // Album similarity
      const album1 = normalize(song1.album_name || '');
      const album2 = normalize(song2.album_name || '');
      
      if (album1 && album2 && album1 === album2) {
        score += 10; // Same album
      }
      
      return score;
    };
    
    // Find potential duplicates
    for (let i = 0; i < songs.length; i++) {
      if (processed.has(songs[i].id)) continue;
      
      const currentSong = songs[i];
      const potentialDuplicates = [currentSong];
      
      for (let j = i + 1; j < songs.length; j++) {
        if (processed.has(songs[j].id)) continue;
        
        const compareSong = songs[j];
        const similarity = calculateSimilarity(currentSong, compareSong);
        
        // Consider songs with similarity score >= 60 as potential duplicates
        if (similarity >= 60) {
          potentialDuplicates.push(compareSong);
          processed.add(compareSong.id);
        }
      }
      
      if (potentialDuplicates.length > 1) {
        // Sort by creation date (oldest first) and popularity (highest first)
        potentialDuplicates.sort((a, b) => {
          if (a.created_at !== b.created_at) {
            return new Date(a.created_at) - new Date(b.created_at);
          }
          return (b.popularity || 0) - (a.popularity || 0);
        });
        
        duplicateGroups.push({
          groupId: duplicateGroups.length + 1,
          songs: potentialDuplicates,
          confidence: potentialDuplicates.length > 2 ? 'high' : 'medium',
          recommendedAction: `Keep "${potentialDuplicates[0].title}" by ${potentialDuplicates[0].artists} (oldest/most popular)`
        });
      }
      
      processed.add(currentSong.id);
    }
    
    console.log(`Found ${duplicateGroups.length} potential duplicate groups`);
    
    res.json({
      success: true,
      duplicateGroups,
      summary: {
        totalSongs: songs.length,
        duplicateGroups: duplicateGroups.length,
        songsInDuplicates: duplicateGroups.reduce((sum, group) => sum + group.songs.length, 0)
      }
    });
    
  } catch (error) {
    console.error('Error detecting duplicate songs:', error);
    res.status(500).json({ 
      error: 'Failed to detect duplicate songs', 
      details: error.message 
    });
  }
});

// Check for Spotify songs that may have been removed/unavailable
router.get('/spotify-validation', async (req, res) => {
  try {
    console.log('Validating Spotify songs...');
    
    // Get songs that might have issues (no preview URL, very low popularity, etc.)
    const suspiciousResult = await pool.query(`
      SELECT 
        s.id,
        s.title,
        s.spotify_id,
        s.spotify_url,
        s.preview_url,
        s.popularity,
        s.available_markets,
        s.created_at,
        string_agg(a.name, ', ' ORDER BY a.name) as artists,
        al.name as album_name
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN albums al ON s.album_id = al.id
      WHERE s.data_source = 'spotify' AND (
        s.popularity = 0 OR 
        s.preview_url IS NULL
      )
      GROUP BY s.id, s.title, s.spotify_id, s.spotify_url, s.preview_url, s.popularity, s.available_markets, s.created_at, al.name
      ORDER BY s.popularity ASC, s.created_at DESC
    `);
    
    const suspiciousSongs = suspiciousResult.rows
      .map(song => ({
        ...song,
        marketCount: song.available_markets ? song.available_markets.length : 0,
        issues: [
          ...(song.popularity === 0 ? ['Zero popularity score'] : []),
          ...(!song.preview_url ? ['No preview URL available'] : []),
          ...(!song.available_markets || song.available_markets.length < 10 ? ['Limited market availability'] : [])
        ]
      }))
      .filter(song => song.issues.length > 0); // Only return songs with actual issues
    
    res.json({
      success: true,
      suspiciousSongs,
      summary: {
        totalChecked: suspiciousSongs.length,
        zeroPopularity: suspiciousSongs.filter(s => s.popularity === 0).length,
        noPreview: suspiciousSongs.filter(s => !s.preview_url).length,
        limitedMarkets: suspiciousSongs.filter(s => !s.available_markets || s.available_markets.length < 10).length
      }
    });
    
  } catch (error) {
    console.error('Error validating Spotify songs:', error);
    res.status(500).json({ 
      error: 'Failed to validate Spotify songs', 
      details: error.message 
    });
  }
});

// ==================== Sync (import-only — website is master) ====================

// Sync with Spotify playlist to detect changes
// IMPORT-ONLY sync (Session 1.2 rebuild — docs/TRUTH_SOURCE_DESIGN.md).
// The website is master: playlist tracks missing from the catalogue are added as
// status='pending' for the curator to review; nothing is flagged as removed and no
// existing song is modified. Included songs absent from the playlist are reported
// only — the curator updates Spotify by hand if desired.
router.post('/sync-spotify-playlist', async (req, res) => {
  try {
    const { getSpotifyClient, fetchPlaylistTracks, computeDiff, addTracksAsPending, DEFAULT_PLAYLIST_ID } = require('../utils/playlistSync');
    const { playlistId = DEFAULT_PLAYLIST_ID } = req.body;

    const spotifyApi = await getSpotifyClient();
    const tracks = await fetchPlaylistTracks(spotifyApi, playlistId);
    const diff = await computeDiff(pool, tracks);
    const added = await addTracksAsPending(pool, diff.missingFromCatalogue);

    res.json({
      success: true,
      summary: {
        playlistTracks: diff.playlistTrackCount,
        addedAsPending: added,
        includedNotOnPlaylist: diff.includedNotOnPlaylist.length,
        nonIncludedOnPlaylist: diff.nonIncludedOnPlaylist.length
      },
      addedSongs: diff.missingFromCatalogue.slice(0, 10).map(t => ({
        spotify_id: t.spotify_id, title: t.title,
        artists: t.artists.map(a => a.name).join(', ')
      })),
      includedNotOnPlaylist: diff.includedNotOnPlaylist.slice(0, 10),
      message: `Import-only sync: added ${added} playlist track(s) to the pending queue. ` +
        `${diff.includedNotOnPlaylist.length} included song(s) are not on the Spotify playlist ` +
        `(informational — update Spotify manually if desired). No songs were changed or flagged.`
    });

  } catch (error) {
    console.error('Error syncing Spotify playlist:', error);
    res.status(500).json({
      error: 'Failed to sync Spotify playlist', 
      details: error.message 
    });
  }
});

// Read-only playlist diff (Session 1.2 rebuild): reports differences between the
// catalogue and the Spotify playlist in both directions. Website is master — this
// endpoint never writes anything.
router.get('/spotify-playlist-mismatch', async (req, res) => {
  try {
    const { getSpotifyClient, fetchPlaylistTracks, computeDiff, DEFAULT_PLAYLIST_ID } = require('../utils/playlistSync');
    const { playlistId = DEFAULT_PLAYLIST_ID } = req.query;

    const spotifyApi = await getSpotifyClient();
    const tracks = await fetchPlaylistTracks(spotifyApi, playlistId);
    const diff = await computeDiff(pool, tracks);

    res.json({
      success: true,
      mismatchSongs: diff.includedNotOnPlaylist.map(song => ({
        ...song,
        recommendation: 'Website is master — update the Spotify playlist manually if desired'
      })),
      playlistTracksNotInCatalogue: diff.missingFromCatalogue.map(t => ({
        spotify_id: t.spotify_id, title: t.title,
        artists: t.artists.map(a => a.name).join(', '),
        recommendation: 'Run the import-only sync to add to the pending queue'
      })),
      nonIncludedOnPlaylist: diff.nonIncludedOnPlaylist,
      summary: {
        totalPlaylistTracks: diff.playlistTrackCount,
        includedNotOnPlaylist: diff.includedNotOnPlaylist.length,
        playlistTracksNotInCatalogue: diff.missingFromCatalogue.length,
        nonIncludedOnPlaylist: diff.nonIncludedOnPlaylist.length,
        playlistId: playlistId
      },
      message: `${diff.includedNotOnPlaylist.length} included song(s) not on the playlist; ` +
        `${diff.missingFromCatalogue.length} playlist track(s) not in the catalogue. Read-only report — nothing was changed.`
    });

  } catch (error) {
    console.error('Error detecting Spotify playlist mismatches:', error);
    res.status(500).json({
      error: 'Failed to detect Spotify playlist mismatches',
      details: error.message
    });
  }
});

// ==================== Artists ====================

// Get all artists for admin management
router.get('/all-artists', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const reviewedFilter = req.query.reviewed; // 'true', 'false', or undefined for all
    const sortBy = req.query.sortBy || 'name';
    const sortOrder = req.query.sortOrder || 'asc';
    
    let whereClause = 'WHERE 1=1';
    let params = [limit, offset];
    let paramIndex = 3;
    
    if (search) {
      whereClause += ` AND (LOWER(a.name) LIKE LOWER($${paramIndex}) OR LOWER(a.bio) LIKE LOWER($${paramIndex}) OR LOWER(a.vegan_advocacy_notes) LIKE LOWER($${paramIndex}))`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (reviewedFilter === 'true') {
      whereClause += ' AND a.discography_reviewed = true';
    } else if (reviewedFilter === 'false') {
      whereClause += ' AND (a.discography_reviewed = false OR a.discography_reviewed IS NULL)';
    }
    
    // Map frontend sort fields to database fields
    const sortFieldMap = {
      'name': 'a.name',
      'song_count': 'COUNT(sa.song_id)',
      'followers': 'a.followers',
      'popularity': 'a.popularity',
      'discography_reviewed': 'a.discography_reviewed',
      'updated_at': 'a.updated_at',
      'created_at': 'a.created_at'
    };
    
    const validSortField = sortFieldMap[sortBy] || 'a.name';
    const validSortOrder = (sortOrder === 'desc') ? 'DESC' : 'ASC';
    const orderByClause = `ORDER BY ${validSortField} ${validSortOrder}, a.name ASC`;
    
    const artistsResult = await pool.query(`
      SELECT 
        a.id,
        a.spotify_id,
        a.name,
        a.spotify_url,
        a.genres,
        a.images,
        a.followers,
        a.popularity,
        a.bio,
        a.vegan_advocacy_notes,
        a.website_url,
        a.discography_reviewed,
        a.discography_reviewed_date,
        a.discography_review_notes,
        a.data_source,
        a.created_at,
        a.updated_at,
        COUNT(sa.song_id) as song_count,
        string_agg(DISTINCT s.title, ', ' ORDER BY s.title) as sample_songs
      FROM artists a
      LEFT JOIN song_artists sa ON a.id = sa.artist_id
      LEFT JOIN songs s ON sa.song_id = s.id
      ${whereClause}
      GROUP BY a.id, a.spotify_id, a.name, a.spotify_url, a.genres, a.images,
               a.followers, a.popularity, a.bio, a.vegan_advocacy_notes, a.website_url,
               a.discography_reviewed, a.discography_reviewed_date,
               a.discography_review_notes, a.data_source, a.created_at, a.updated_at
      ${orderByClause}
      LIMIT $1 OFFSET $2
    `, params);
    
    // Get total count
    let countParams = params.slice(2); // Remove limit and offset
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM artists a
      ${whereClause}
    `, countParams);
    
    const total = parseInt(countResult.rows[0].total);
    
    res.json({
      artists: artistsResult.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching artists:', error);
    res.status(500).json({ error: 'Failed to fetch artists', details: error.message });
  }
});

// Update artist
router.put('/artists/:id', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    const {
      name,
      bio,
      vegan_advocacy_notes,
      website_url,
      discography_reviewed,
      discography_review_notes,
      genres
    } = req.body;
    
    console.log(`Updating artist ${artistId}:`, req.body);
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Prepare the update query
      let updateFields = [];
      let params = [];
      let paramIndex = 1;
      
      if (name !== undefined) {
        updateFields.push(`name = $${paramIndex}`);
        params.push(name);
        paramIndex++;
      }
      
      if (bio !== undefined) {
        updateFields.push(`bio = $${paramIndex}`);
        params.push(bio);
        paramIndex++;
      }
      
      if (vegan_advocacy_notes !== undefined) {
        updateFields.push(`vegan_advocacy_notes = $${paramIndex}`);
        params.push(vegan_advocacy_notes);
        paramIndex++;
      }

      if (website_url !== undefined) {
        updateFields.push(`website_url = $${paramIndex}`);
        params.push(website_url || null);
        paramIndex++;
      }
      
      if (genres !== undefined) {
        updateFields.push(`genres = $${paramIndex}`);
        params.push(genres);
        paramIndex++;
      }
      
      if (discography_reviewed !== undefined) {
        updateFields.push(`discography_reviewed = $${paramIndex}`);
        params.push(discography_reviewed);
        paramIndex++;
        
        // If marking as reviewed, set the date
        if (discography_reviewed) {
          updateFields.push(`discography_reviewed_date = CURRENT_TIMESTAMP`);
        } else {
          // If unmarking, clear the date
          updateFields.push(`discography_reviewed_date = NULL`);
        }
      }
      
      if (discography_review_notes !== undefined) {
        updateFields.push(`discography_review_notes = $${paramIndex}`);
        params.push(discography_review_notes);
        paramIndex++;
      }
      
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(artistId);
      
      const updateQuery = `
        UPDATE artists 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, params);
      
      await client.query('COMMIT');
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Artist not found' });
      }
      
      res.json({
        success: true,
        artist: result.rows[0],
        message: `Artist "${name || result.rows[0].name}" updated successfully`
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error updating artist:', error);
    res.status(500).json({ 
      error: 'Failed to update artist', 
      details: error.message 
    });
  }
});

// Get artist statistics
router.get('/artists-stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_artists,
        COUNT(*) FILTER (WHERE discography_reviewed = true) as reviewed_artists,
        COUNT(*) FILTER (WHERE discography_reviewed = false OR discography_reviewed IS NULL) as unreviewed_artists,
        COUNT(*) FILTER (WHERE vegan_advocacy_notes IS NOT NULL AND vegan_advocacy_notes != '') as artists_with_notes,
        COUNT(*) FILTER (WHERE data_source = 'spotify') as spotify_artists,
        COUNT(*) FILTER (WHERE data_source = 'manual') as manual_artists
      FROM artists
    `);
    
    res.json({
      success: true,
      stats: stats.rows[0]
    });
    
  } catch (error) {
    console.error('Error fetching artist stats:', error);
    res.status(500).json({
      error: 'Failed to fetch artist statistics',
      details: error.message
    });
  }
});

// ==================== Staging / lifecycle ====================

// --- Publication staging (Session 1.2b — docs/PUBLICATION_STAGING_DESIGN.md) ---
// status stays the curator's inclusion decision; published is the "ready to show"
// dimension. Publishing is always an explicit curator action.

router.post('/songs/:id/publish', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE songs SET published = true, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'included'
      RETURNING id, title, published, published_at`, [req.params.id]);
    if (result.rows.length === 0) {
      const exists = await pool.query(`SELECT status FROM songs WHERE id = $1`, [req.params.id]);
      if (exists.rows.length === 0) return res.status(404).json({ error: 'Song not found' });
      return res.status(409).json({
        error: `Only included songs can be published (song is '${exists.rows[0].status}')`
      });
    }
    res.json({ success: true, song: result.rows[0], message: `Published: ${result.rows[0].title}` });
  } catch (error) {
    console.error('Error publishing song:', error);
    res.status(500).json({ error: 'Failed to publish song', details: error.message });
  }
});

router.post('/songs/:id/unpublish', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE songs SET published = false, published_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title, published`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Song not found' });
    res.json({ success: true, song: result.rows[0], message: `Unpublished: ${result.rows[0].title}` });
  } catch (error) {
    console.error('Error unpublishing song:', error);
    res.status(500).json({ error: 'Failed to unpublish song', details: error.message });
  }
});

// ---- Session 1.4 staging queue ----
router.get('/staging', async (req, res) => {
  try {
    const { queue, q, limit, offset } = req.query;
    const out = await staging.listQueue(pool, {
      queue, q: q || '', limit: limit ? parseInt(limit) : null, offset: offset ? parseInt(offset) : 0,
    });
    res.json(out);
  } catch (e) {
    if (e.code === 'BAD_QUEUE') return res.status(400).json({ error: 'Unknown queue' });
    if (e.code === 'Q_REQUIRED') return res.status(400).json({ error: 'A search term (q) is required for the live queue' });
    console.error('staging list error:', e);
    res.status(500).json({ error: 'Failed to list queue', details: e.message });
  }
});

router.post('/songs/:id/include', async (req, res) => {
  try {
    const song = await staging.includeSong(pool, parseInt(req.params.id), { publish: req.body && req.body.publish === true });
    res.json({ success: true, song, message: `Included${song.published ? ' & published' : ''}: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('include error:', e);
    res.status(500).json({ error: 'Failed to include song', details: e.message });
  }
});

router.post('/songs/:id/reject', async (req, res) => {
  try {
    const song = await staging.rejectSong(pool, parseInt(req.params.id));
    res.json({ success: true, song, message: `Rejected: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('reject error:', e);
    res.status(500).json({ error: 'Failed to reject song', details: e.message });
  }
});

router.post('/songs/:id/play-link', async (req, res) => {
  try {
    const song = await staging.setPlayLink(pool, parseInt(req.params.id), req.body || {});
    res.json({ success: true, song, message: `Play link saved: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('play-link error:', e);
    res.status(500).json({ error: 'Failed to save play link', details: e.message });
  }
});

router.post('/songs/:id/attach-spotify', async (req, res) => {
  try {
    const result = await staging.attachSpotifyToSong(pool, parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('attach-spotify error:', e);
    res.status(500).json({ error: 'Failed to attach Spotify', details: e.message });
  }
});

router.post('/staging/candidates', async (req, res) => {
  try {
    const urls = (req.body && req.body.urls) || [];
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'Provide urls: [] (Spotify track/playlist URLs)' });
    const { tracks, invalid } = await staging.resolveSpotifyUrls(urls);
    const { added, skippedExisting } = await staging.insertCandidates(pool, tracks);
    res.json({ success: true, added, skippedExisting, invalid });
  } catch (e) {
    console.error('candidates error:', e);
    res.status(500).json({ error: 'Failed to import candidates', details: e.message });
  }
});

// Submissions → pending bridge (Session 2.2, curator-approved): adds an approved
// community submission to the pending queue via the staging candidate intake.
router.post('/submissions/:id/add-to-pending', async (req, res) => {
  try {
    const result = await staging.addSubmissionAsPending(pool, parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Submission not found' });
    console.error('add-to-pending error:', e);
    res.status(500).json({ error: 'Failed to add submission to pending queue', details: e.message });
  }
});

// ==================== Curation workbench (Sub-project A) ====================

router.get('/curation/queue', async (req, res) => {
  try {
    const { queue, q, limit, offset } = req.query;
    const out = await curation.listCurationQueue(pool, {
      queue, q: q || '', limit: limit ? parseInt(limit) : null, offset: offset ? parseInt(offset) : 0,
    });
    res.json(out);
  } catch (e) {
    if (e.code === 'BAD_QUEUE') return res.status(400).json({ error: 'Unknown queue' });
    console.error('curation queue error:', e);
    res.status(500).json({ error: 'Failed to list queue', details: e.message });
  }
});

router.get('/curation/counts', async (req, res) => {
  try {
    res.json(await curation.queueCounts(pool));
  } catch (e) {
    console.error('curation counts error:', e);
    res.status(500).json({ error: 'Failed to load queue counts', details: e.message });
  }
});

router.get('/curation/catalogue-stats', async (req, res) => {
  try {
    res.json(await curation.catalogueStats(pool));
  } catch (e) {
    console.error('catalogue-stats error:', e);
    res.status(500).json({ error: 'Failed to load catalogue stats', details: e.message });
  }
});

router.get('/curation/recent', async (req, res) => {
  try {
    res.json(await curation.recentlyEdited(pool, req.query.limit));
  } catch (e) {
    console.error('curation recent error:', e);
    res.status(500).json({ error: 'Failed to load recent activity', details: e.message });
  }
});

router.post('/curation/quick-capture', async (req, res) => {
  try {
    const { id } = await curation.quickCapture(pool, req.body || {});
    res.json({ success: true, id });
  } catch (e) {
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('quick-capture error:', e);
    res.status(500).json({ error: 'Failed to add song', details: e.message });
  }
});

router.get('/workbench/:id', async (req, res) => {
  try {
    res.json(await curation.getWorkbench(pool, parseInt(req.params.id)));
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('workbench read error:', e);
    res.status(500).json({ error: 'Failed to load workbench', details: e.message });
  }
});

router.put('/workbench/:id/processing', async (req, res) => {
  try {
    const row = await curation.setProcessing(pool, parseInt(req.params.id), req.body || {});
    res.json({ success: true, processing: row });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('processing save error:', e);
    res.status(500).json({ error: 'Failed to save processing state', details: e.message });
  }
});

// Shared handler for the per-panel saves that return the reassembled workbench.
function panelSave(fn) {
  return async (req, res) => {
    try {
      const wb = await fn(pool, parseInt(req.params.id), req.body || {});
      res.json({ success: true, workbench: wb });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
      if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
      console.error('workbench save error:', e);
      res.status(500).json({ error: 'Failed to save', details: e.message });
    }
  };
}
router.put('/workbench/:id/details',    panelSave(curation.saveDetails));
router.put('/workbench/:id/lyrics',     panelSave(curation.saveLyrics));
router.put('/workbench/:id/highlights', panelSave(curation.saveHighlights));
router.put('/workbench/:id/links',      panelSave(curation.saveLinks));
router.put('/workbench/:id/cover',      panelSave(curation.setCover));

router.post('/workbench/:id/videos', async (req, res) => {
  try {
    const row = await videos.addVideo(pool, parseInt(req.params.id), req.body || {});
    res.json({ success: true, video: row });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('add video error:', e);
    res.status(500).json({ error: 'Failed to add video', details: e.message });
  }
});
router.put('/workbench/videos/:videoId', async (req, res) => {
  try {
    res.json({ success: true, video: await videos.updateVideo(pool, parseInt(req.params.videoId), req.body || {}) });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Video not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('update video error:', e);
    res.status(500).json({ error: 'Failed to update video', details: e.message });
  }
});
router.put('/workbench/videos/:videoId/primary', async (req, res) => {
  try {
    res.json({ success: true, video: await videos.setPrimaryVideo(pool, parseInt(req.params.videoId)) });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Video not found' });
    console.error('set primary error:', e);
    res.status(500).json({ error: 'Failed to set primary', details: e.message });
  }
});
router.delete('/workbench/videos/:videoId', async (req, res) => {
  try {
    res.json({ success: true, ...(await videos.deleteVideo(pool, parseInt(req.params.videoId))) });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Video not found' });
    console.error('delete video error:', e);
    res.status(500).json({ error: 'Failed to delete video', details: e.message });
  }
});

module.exports = router;