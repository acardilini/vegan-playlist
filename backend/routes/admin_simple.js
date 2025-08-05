const express = require('express');
const pool = require('../database/db');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const router = express.Router();

console.log('ADMIN_SIMPLE.JS LOADED - FEATURED ROUTES SHOULD BE AVAILABLE');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Test route
router.get('/test', (req, res) => {
  res.json({ message: 'Admin routes are working!' });
});

router.post('/test-featured', async (req, res) => {
  try {
    const { songId, featured } = req.body;
    
    if (!songId || typeof featured !== 'boolean') {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    // Update featured status
    const result = await pool.query(
      'UPDATE songs SET featured = $1 WHERE id = $2 RETURNING id, title, featured',
      [featured, parseInt(songId)]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    
    res.json({
      message: `Song ${featured ? 'pinned as featured' : 'unpinned from featured'}`,
      song: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error toggling featured status:', error);
    res.status(500).json({ 
      error: 'Failed to update featured status', 
      details: error.message 
    });
  }
});

// Simple featured test
router.get('/simple-test', (req, res) => {
  res.json({ message: 'Simple test works!' });
});

// Test featured route
router.get('/test-featured-simple', (req, res) => {
  res.json({ message: 'Featured routes test!' });
});

// Toggle featured status for a song
router.patch('/toggle-featured/:id', async (req, res) => {
  try {
    const songId = parseInt(req.params.id);
    const { featured } = req.body;
    
    if (isNaN(songId)) {
      return res.status(400).json({ error: 'Invalid song ID' });
    }
    
    if (typeof featured !== 'boolean') {
      return res.status(400).json({ error: 'Featured must be a boolean value' });
    }
    
    // Check if song exists
    const songCheck = await pool.query('SELECT id FROM songs WHERE id = $1', [songId]);
    if (songCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    
    // Update featured status
    const result = await pool.query(
      'UPDATE songs SET featured = $1 WHERE id = $2 RETURNING id, title, featured',
      [featured, songId]
    );
    
    res.json({
      message: `Song ${featured ? 'pinned as featured' : 'unpinned from featured'}`,
      song: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error toggling featured status:', error);
    res.status(500).json({ 
      error: 'Failed to update featured status', 
      details: error.message 
    });
  }
});

// Get all songs (simplified version)
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
        CASE WHEN s.data_source = 'manual' THEN 'Manual' ELSE 'Spotify' END as source_type
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN albums al ON s.album_id = al.id
      GROUP BY s.id, al.name
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
    
    // Add some hardcoded genre options for now
    results.parent_genres = ['Rock', 'Metal', 'Punk', 'Folk', 'Electronic', 'Hip Hop', 'Reggae'];
    results.subgenres = ['hardcore', 'punk rock', 'folk punk', 'death metal', 'ska punk'];
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching categorization options:', error);
    res.status(500).json({ error: 'Failed to fetch categorization options' });
  }
});

// Update single song endpoint (for individual edits)
router.put('/update-song/:id', async (req, res) => {
  try {
    
    const songId = parseInt(req.params.id);
    
    // If only featured is being updated, do a simpler query
    if (typeof req.body.featured === 'boolean' && Object.keys(req.body).length === 1) {
      const featured = req.body.featured;
      const result = await pool.query(`
        UPDATE songs 
        SET featured = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, title, featured
      `, [songId, featured]);
      
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Song not found' });
      }

      res.json({
        success: true,
        message: `Song ${featured ? 'pinned as featured' : 'unpinned from featured'}`,
        song: result.rows[0],
        path: 'featured-only'
      });
      return;
    }

    // Full update for other fields - destructure here
    const {
      vegan_focus,
      animal_category,
      advocacy_style,
      advocacy_issues,
      lyrical_explicitness,
      featured
    } = req.body;
    
    const result = await pool.query(`
      UPDATE songs 
      SET 
        vegan_focus = COALESCE($2, vegan_focus),
        animal_category = COALESCE($3, animal_category),
        advocacy_style = COALESCE($4, advocacy_style),
        advocacy_issues = COALESCE($5, advocacy_issues),
        lyrical_explicitness = COALESCE($6, lyrical_explicitness),
        featured = COALESCE($7, featured),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title, featured
    `, [
      songId,
      vegan_focus || null,
      animal_category || null,
      advocacy_style || null,
      advocacy_issues || null,
      lyrical_explicitness || null,
      typeof featured === 'boolean' ? featured : null
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    res.json({
      success: true,
      message: `Song updated successfully`,
      song: result.rows[0],
      path: 'full-update'
    });

  } catch (error) {
    console.error('Error updating song:', error);
    res.status(500).json({ 
      error: 'Failed to update song', 
      details: error.message 
    });
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


module.exports = router;