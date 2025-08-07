const express = require('express');
const pool = require('../database/db');
const router = express.Router();

// Get year distribution data
router.get('/year-distribution', async (req, res) => {
  try {
    const { 
      genre = null, 
      parent_genre = null,
      vegan_focus = null,
      advocacy_style = null,
      min_year = null,
      max_year = null 
    } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    // Add genre filtering
    if (genre) {
      whereConditions.push(`s.genre = $${paramIndex}`);
      params.push(genre);
      paramIndex++;
    }

    if (parent_genre) {
      whereConditions.push(`s.parent_genre = $${paramIndex}`);
      params.push(parent_genre);
      paramIndex++;
    }

    // Add vegan focus filtering
    if (vegan_focus) {
      whereConditions.push(`$${paramIndex} = ANY(s.vegan_focus)`);
      params.push(vegan_focus);
      paramIndex++;
    }

    // Add advocacy style filtering
    if (advocacy_style) {
      whereConditions.push(`$${paramIndex} = ANY(s.advocacy_style)`);
      params.push(advocacy_style);
      paramIndex++;
    }

    // Add year range filtering
    if (min_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) >= $${paramIndex}`);
      params.push(parseInt(min_year));
      paramIndex++;
    }

    if (max_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) <= $${paramIndex}`);
      params.push(parseInt(max_year));
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        EXTRACT(YEAR FROM al.release_date) as year,
        COUNT(*) as song_count
      FROM songs s
      LEFT JOIN albums al ON s.album_id = al.id
      ${whereClause ? whereClause + ' AND' : 'WHERE'} al.release_date IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM al.release_date)
      ORDER BY year ASC
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching year distribution:', error);
    res.status(500).json({ error: 'Failed to fetch year distribution' });
  }
});

// Get genre distribution data
router.get('/genre-distribution', async (req, res) => {
  try {
    const { 
      type = 'genre', // 'genre' or 'parent_genre'
      min_year = null,
      max_year = null,
      vegan_focus = null,
      advocacy_style = null,
      limit = 20
    } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    // Add year range filtering
    if (min_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) >= $${paramIndex}`);
      params.push(parseInt(min_year));
      paramIndex++;
    }

    if (max_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) <= $${paramIndex}`);
      params.push(parseInt(max_year));
      paramIndex++;
    }

    // Add vegan focus filtering
    if (vegan_focus) {
      whereConditions.push(`$${paramIndex} = ANY(s.vegan_focus)`);
      params.push(vegan_focus);
      paramIndex++;
    }

    // Add advocacy style filtering
    if (advocacy_style) {
      whereConditions.push(`$${paramIndex} = ANY(s.advocacy_style)`);
      params.push(advocacy_style);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const genreColumn = type === 'parent_genre' ? 's.parent_genre' : 's.genre';

    const query = `
      SELECT 
        ${genreColumn} as genre,
        COUNT(*) as song_count
      FROM songs s
      LEFT JOIN albums al ON s.album_id = al.id
      ${whereClause ? whereClause + ' AND' : 'WHERE'} ${genreColumn} IS NOT NULL
      GROUP BY ${genreColumn}
      ORDER BY song_count DESC
      LIMIT $${paramIndex}
    `;

    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching genre distribution:', error);
    res.status(500).json({ error: 'Failed to fetch genre distribution' });
  }
});

// Get audio features analysis
router.get('/audio-features', async (req, res) => {
  try {
    const { 
      genre = null,
      parent_genre = null,
      min_year = null,
      max_year = null,
      feature = 'energy' // energy, danceability, valence
    } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    // Add filtering conditions
    if (genre) {
      whereConditions.push(`s.genre = $${paramIndex}`);
      params.push(genre);
      paramIndex++;
    }

    if (parent_genre) {
      whereConditions.push(`s.parent_genre = $${paramIndex}`);
      params.push(parent_genre);
      paramIndex++;
    }

    if (min_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) >= $${paramIndex}`);
      params.push(parseInt(min_year));
      paramIndex++;
    }

    if (max_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) <= $${paramIndex}`);
      params.push(parseInt(max_year));
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // Validate feature parameter
    const validFeatures = ['energy', 'danceability', 'valence'];
    const selectedFeature = validFeatures.includes(feature) ? feature : 'energy';

    const query = `
      SELECT 
        CASE 
          WHEN ${selectedFeature}::numeric >= 0.8 THEN 'Very High'
          WHEN ${selectedFeature}::numeric >= 0.6 THEN 'High'
          WHEN ${selectedFeature}::numeric >= 0.4 THEN 'Medium'
          WHEN ${selectedFeature}::numeric >= 0.2 THEN 'Low'
          ELSE 'Very Low'
        END as feature_level,
        COUNT(*) as song_count
      FROM songs s
      LEFT JOIN albums al ON s.album_id = al.id
      ${whereClause ? whereClause + ' AND' : 'WHERE'} s.${selectedFeature} IS NOT NULL
      GROUP BY CASE 
        WHEN ${selectedFeature}::numeric >= 0.8 THEN 'Very High'
        WHEN ${selectedFeature}::numeric >= 0.6 THEN 'High'
        WHEN ${selectedFeature}::numeric >= 0.4 THEN 'Medium'
        WHEN ${selectedFeature}::numeric >= 0.2 THEN 'Low'
        ELSE 'Very Low'
      END
      ORDER BY 
        CASE 
          WHEN CASE 
            WHEN ${selectedFeature}::numeric >= 0.8 THEN 'Very High'
            WHEN ${selectedFeature}::numeric >= 0.6 THEN 'High'
            WHEN ${selectedFeature}::numeric >= 0.4 THEN 'Medium'
            WHEN ${selectedFeature}::numeric >= 0.2 THEN 'Low'
            ELSE 'Very Low'
          END = 'Very High' THEN 1
          WHEN CASE 
            WHEN ${selectedFeature}::numeric >= 0.8 THEN 'Very High'
            WHEN ${selectedFeature}::numeric >= 0.6 THEN 'High'
            WHEN ${selectedFeature}::numeric >= 0.4 THEN 'Medium'
            WHEN ${selectedFeature}::numeric >= 0.2 THEN 'Low'
            ELSE 'Very Low'
          END = 'High' THEN 2
          WHEN CASE 
            WHEN ${selectedFeature}::numeric >= 0.8 THEN 'Very High'
            WHEN ${selectedFeature}::numeric >= 0.6 THEN 'High'
            WHEN ${selectedFeature}::numeric >= 0.4 THEN 'Medium'
            WHEN ${selectedFeature}::numeric >= 0.2 THEN 'Low'
            ELSE 'Very Low'
          END = 'Medium' THEN 3
          WHEN CASE 
            WHEN ${selectedFeature}::numeric >= 0.8 THEN 'Very High'
            WHEN ${selectedFeature}::numeric >= 0.6 THEN 'High'
            WHEN ${selectedFeature}::numeric >= 0.4 THEN 'Medium'
            WHEN ${selectedFeature}::numeric >= 0.2 THEN 'Low'
            ELSE 'Very Low'
          END = 'Low' THEN 4
          ELSE 5
        END
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching audio features:', error);
    res.status(500).json({ error: 'Failed to fetch audio features' });
  }
});

// Get vegan themes analysis
router.get('/vegan-themes', async (req, res) => {
  try {
    const { 
      genre = null,
      parent_genre = null,
      min_year = null,
      max_year = null 
    } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    // Add filtering conditions
    if (genre) {
      whereConditions.push(`s.genre = $${paramIndex}`);
      params.push(genre);
      paramIndex++;
    }

    if (parent_genre) {
      whereConditions.push(`s.parent_genre = $${paramIndex}`);
      params.push(parent_genre);
      paramIndex++;
    }

    if (min_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) >= $${paramIndex}`);
      params.push(parseInt(min_year));
      paramIndex++;
    }

    if (max_year) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) <= $${paramIndex}`);
      params.push(parseInt(max_year));
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        unnest(s.vegan_focus) as theme,
        COUNT(*) as song_count
      FROM songs s
      LEFT JOIN albums al ON s.album_id = al.id
      ${whereClause ? whereClause + ' AND' : 'WHERE'} s.vegan_focus IS NOT NULL 
      AND array_length(s.vegan_focus, 1) > 0
      GROUP BY theme
      ORDER BY song_count DESC
      LIMIT 15
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vegan themes:', error);
    res.status(500).json({ error: 'Failed to fetch vegan themes' });
  }
});

// Get dashboard summary stats
router.get('/summary', async (req, res) => {
  try {
    const queries = [
      'SELECT COUNT(*) as total_songs FROM songs',
      'SELECT COUNT(DISTINCT s.genre) as total_genres FROM songs s WHERE s.genre IS NOT NULL',
      `SELECT 
         MIN(EXTRACT(YEAR FROM al.release_date)) as earliest_year,
         MAX(EXTRACT(YEAR FROM al.release_date)) as latest_year
       FROM songs s 
       LEFT JOIN albums al ON s.album_id = al.id 
       WHERE al.release_date IS NOT NULL`,
      'SELECT COUNT(*) as songs_with_vegan_focus FROM songs WHERE vegan_focus IS NOT NULL AND array_length(vegan_focus, 1) > 0'
    ];

    const results = await Promise.all(queries.map(query => pool.query(query)));

    const summary = {
      total_songs: parseInt(results[0].rows[0].total_songs),
      total_genres: parseInt(results[1].rows[0].total_genres),
      year_range: {
        earliest: parseInt(results[2].rows[0].earliest_year),
        latest: parseInt(results[2].rows[0].latest_year)
      },
      songs_with_themes: parseInt(results[3].rows[0].songs_with_vegan_focus)
    };

    res.json(summary);
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// Get available filter options
router.get('/filter-options', async (req, res) => {
  try {
    const queries = [
      'SELECT DISTINCT genre FROM songs WHERE genre IS NOT NULL ORDER BY genre',
      'SELECT DISTINCT parent_genre FROM songs WHERE parent_genre IS NOT NULL ORDER BY parent_genre',
      'SELECT DISTINCT unnest(vegan_focus) as theme FROM songs WHERE vegan_focus IS NOT NULL ORDER BY theme',
      'SELECT DISTINCT unnest(advocacy_style) as style FROM songs WHERE advocacy_style IS NOT NULL ORDER BY style'
    ];

    const results = await Promise.all(queries.map(query => pool.query(query)));

    const options = {
      genres: results[0].rows.map(row => row.genre),
      parent_genres: results[1].rows.map(row => row.parent_genre),
      vegan_themes: results[2].rows.map(row => row.theme),
      advocacy_styles: results[3].rows.map(row => row.style)
    };

    res.json(options);
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

module.exports = router;