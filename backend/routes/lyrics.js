const express = require('express');
const router = express.Router();
const pool = require('../database/db');

// Get songs that need lyrics links (songs without lyrics_url)
router.get('/songs/missing-lyrics', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Get songs without lyrics links
    const songsResult = await pool.query(`
      SELECT 
        s.id,
        s.title,
        string_agg(a.name, ', ') as artists,
        s.popularity,
        s.lyrics_url,
        CASE WHEN s.lyrics_url IS NOT NULL THEN 1 ELSE 0 END as has_lyrics_link
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      WHERE s.lyrics_url IS NULL OR s.lyrics_url = ''
      GROUP BY s.id, s.title, s.popularity, s.lyrics_url
      ORDER BY s.popularity DESC NULLS LAST, s.title
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // Get total count for pagination
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM songs s
      WHERE s.lyrics_url IS NULL OR s.lyrics_url = ''
    `);

    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      songs: songsResult.rows,
      pagination: {
        page,
        pages,
        limit,
        total,
        hasNext: page < pages,
        hasPrev: page > 1
      }
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

// Get all songs with their lyrics status for admin
router.get('/songs/lyrics-status', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const result = await pool.query(`
      SELECT 
        s.id,
        s.title,
        string_agg(a.name, ', ') as artists,
        s.lyrics_url,
        s.lyrics_source,
        CASE WHEN s.lyrics_url IS NOT NULL AND s.lyrics_url != '' THEN 1 ELSE 0 END as has_lyrics_link,
        s.updated_at
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      GROUP BY s.id, s.title, s.lyrics_url, s.lyrics_source, s.updated_at
      ORDER BY s.updated_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM songs');
    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      songs: result.rows,
      pagination: {
        page,
        pages,
        limit,
        total
      }
    });

  } catch (error) {
    console.error('Error fetching lyrics status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch lyrics status'
    });
  }
});

// Get lyrics statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_songs,
        COUNT(CASE WHEN lyrics_url IS NOT NULL AND lyrics_url != '' THEN 1 END) as songs_with_lyrics,
        COUNT(CASE WHEN lyrics_source = 'genius' THEN 1 END) as genius_links,
        COUNT(CASE WHEN lyrics_source = 'bandcamp' THEN 1 END) as bandcamp_links,
        COUNT(CASE WHEN lyrics_source = 'other' THEN 1 END) as other_links
      FROM songs
    `);

    const result = stats.rows[0];
    const totalSongs = parseInt(result.total_songs);
    const songsWithLyrics = parseInt(result.songs_with_lyrics);

    res.json({
      success: true,
      stats: {
        total: totalSongs,
        withLyrics: songsWithLyrics,
        withoutLyrics: totalSongs - songsWithLyrics,
        percentage: Math.round((songsWithLyrics / totalSongs) * 100),
        sources: {
          genius: parseInt(result.genius_links),
          bandcamp: parseInt(result.bandcamp_links),
          other: parseInt(result.other_links)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching lyrics stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch lyrics stats'
    });
  }
});

module.exports = router;