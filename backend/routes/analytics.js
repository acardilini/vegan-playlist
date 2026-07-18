const express = require('express');
const pool = require('../database/db');
const analysis = require('../services/analysis');
const router = express.Router();

// Get year distribution data
router.get('/year-distribution', async (req, res) => {
  try {
    const {
      genre = null,
      parent_genre = null,
      min_year = null,
      max_year = null
    } = req.query;

    let whereConditions = [`s.status = 'included' AND s.published = true`];
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
      limit = 20
    } = req.query;

    let whereConditions = [`s.status = 'included' AND s.published = true`];
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

// Get vegan themes analysis
router.get('/vegan-themes', async (req, res) => {
  try {
    const rows = await analysis.themeCounts(pool, 15);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching vegan themes:', error);
    res.status(500).json({ error: 'Failed to fetch vegan themes' });
  }
});

// Get dashboard summary stats
router.get('/summary', async (req, res) => {
  try {
    const queries = [
      `SELECT COUNT(*) as total_songs FROM songs WHERE status = 'included' AND published = true`,
      `SELECT COUNT(DISTINCT s.genre) as total_genres FROM songs s WHERE s.genre IS NOT NULL AND s.status = 'included' AND s.published = true`,
      `SELECT
         MIN(EXTRACT(YEAR FROM al.release_date)) as earliest_year,
         MAX(EXTRACT(YEAR FROM al.release_date)) as latest_year
       FROM songs s
       LEFT JOIN albums al ON s.album_id = al.id
       WHERE al.release_date IS NOT NULL AND s.status = 'included' AND s.published = true`,
      `SELECT COUNT(DISTINCT sa.song_id) as songs_with_themes
       FROM song_lyric_analysis sa JOIN songs s ON s.id = sa.song_id
       WHERE sa.model_used = '${analysis.DEFAULT_MODEL}' AND s.status = 'included' AND s.published = true`
    ];

    const results = await Promise.all(queries.map(query => pool.query(query)));

    const summary = {
      total_songs: parseInt(results[0].rows[0].total_songs),
      total_genres: parseInt(results[1].rows[0].total_genres),
      year_range: {
        earliest: parseInt(results[2].rows[0].earliest_year),
        latest: parseInt(results[2].rows[0].latest_year)
      },
      songs_with_themes: parseInt(results[3].rows[0].songs_with_themes)
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
      `SELECT DISTINCT genre FROM songs WHERE genre IS NOT NULL AND status = 'included' AND published = true ORDER BY genre`,
      `SELECT DISTINCT parent_genre FROM songs WHERE parent_genre IS NOT NULL AND status = 'included' AND published = true ORDER BY parent_genre`
    ];

    const results = await Promise.all(queries.map(query => pool.query(query)));

    const options = {
      genres: results[0].rows.map(row => row.genre),
      parent_genres: results[1].rows.map(row => row.parent_genre),
    };

    res.json(options);
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

module.exports = router;