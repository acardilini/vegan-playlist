const express = require('express');
const pool = require('../database/db');
const router = express.Router();

// Submit a new song suggestion
router.post('/submit', async (req, res) => {
  try {
    const {
      song_title,
      artist_name,
      album_name,
      release_year,
      youtube_url,
      lyrics_excerpt,
      submission_reason,
      submitter_name,
      submitter_email
    } = req.body;

    // Validate required fields
    if (typeof song_title !== 'string' || typeof artist_name !== 'string' || !song_title.trim() || !artist_name.trim()) {
      return res.status(400).json({ 
        error: 'Song title and artist name are required' 
      });
    }

    // Check if song already exists in the database (flexible matching)
    // First try exact match, then try fuzzy matching for titles
    const existingSongQuery = `
      SELECT s.id, s.title, s.spotify_url, a.name as artist_name,
             (s.status = 'included' AND s.published = true) AS is_live
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE LOWER(a.name) = LOWER($2)
      AND (
        LOWER(s.title) = LOWER($1) OR
        LOWER(s.title) LIKE LOWER($3) || '%' OR
        LOWER(REGEXP_REPLACE(s.title, ' - \\d+ Remaster$', '', 'i')) = LOWER($1) OR
        LOWER(REGEXP_REPLACE(s.title, ' \\(.*\\)$', '', 'i')) = LOWER($1)
      )
      ORDER BY (s.status = 'included' AND s.published = true) DESC, s.id
      LIMIT 1
    `;

    const existingSong = await pool.query(existingSongQuery, [song_title.trim(), artist_name.trim(), song_title.trim().replace(/[\\%_]/g, '\\$&')]);
    const existing_song_id = existingSong.rows.length > 0 ? existingSong.rows[0].id : null;
    // Only a LIVE match is reported to the submitter; any match is still stored for the Inbox.
    const matchIsLive = existingSong.rows.length > 0 && existingSong.rows[0].is_live === true;

    // Insert the submission
    const insertQuery = `
      INSERT INTO song_submissions (
        song_title, artist_name, album_name, release_year,
        youtube_url, lyrics_excerpt, submission_reason,
        submitter_name, submitter_email, existing_song_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      song_title.trim(),
      artist_name.trim(),
      album_name?.trim() || null,
      release_year || null,
      youtube_url?.trim() || null,
      lyrics_excerpt?.trim() || null,
      submission_reason?.trim() || null,
      submitter_name?.trim() || null,
      submitter_email?.trim() || null,
      existing_song_id
    ];

    const result = await pool.query(insertQuery, values);
    const submission = result.rows[0];

    res.status(201).json({
      message: 'Song submission received successfully',
      submission: {
        id: submission.id,
        song_title: submission.song_title,
        artist_name: submission.artist_name,
        already_exists: matchIsLive,
        status: submission.status,
        created_at: submission.created_at
      }
    });

  } catch (error) {
    if (error.code === '23514') {
      const msg = error.constraint === 'valid_email'
        ? 'Please check the email address — it does not look valid.'
        : error.constraint === 'valid_year'
          ? 'Please check the release year — it should be between 1900 and next year.'
          : 'Please check the details you entered.';
      return res.status(400).json({ error: msg });
    }
    console.error('Error submitting song:', error);
    res.status(500).json({ error: 'Failed to submit song suggestion' });
  }
});

module.exports = router;