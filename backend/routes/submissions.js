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
    if (!song_title || !artist_name) {
      return res.status(400).json({ 
        error: 'Song title and artist name are required' 
      });
    }

    // Check if song already exists in the database (flexible matching)
    // First try exact match, then try fuzzy matching for titles
    const existingSongQuery = `
      SELECT s.id, s.title, s.spotify_url, a.name as artist_name
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE LOWER(a.name) = LOWER($2)
      AND (
        LOWER(s.title) = LOWER($1) OR
        LOWER(s.title) LIKE LOWER($1) || '%' OR
        LOWER(REGEXP_REPLACE(s.title, ' - \\d+ Remaster$', '', 'i')) = LOWER($1) OR
        LOWER(REGEXP_REPLACE(s.title, ' \\(.*\\)$', '', 'i')) = LOWER($1)
      )
      LIMIT 1
    `;
    
    const existingSong = await pool.query(existingSongQuery, [song_title.trim(), artist_name.trim()]);
    const existing_song_id = existingSong.rows.length > 0 ? existingSong.rows[0].id : null;

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
        already_exists: existing_song_id !== null,
        status: submission.status,
        created_at: submission.created_at
      }
    });

  } catch (error) {
    console.error('Error submitting song:', error);
    res.status(500).json({ error: 'Failed to submit song suggestion' });
  }
});

// Get all submissions for admin (with pagination and filtering)
router.get('/admin', async (req, res) => {
  try {
    const {
      status = 'all',
      page = 1,
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    let whereClause = '';
    const queryParams = [];
    let paramIndex = 1;

    // Filter by status
    if (status !== 'all') {
      whereClause = `WHERE status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Validate sort parameters
    const validSortFields = ['created_at', 'updated_at', 'song_title', 'artist_name', 'status'];
    const validSortOrders = ['asc', 'desc'];
    
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = validSortOrders.includes(sort_order.toLowerCase()) ? sort_order.toUpperCase() : 'DESC';

    // Get submissions with optional existing song information
    const submissionsQuery = `
      SELECT 
        ss.*,
        s.title as existing_song_title,
        s.spotify_url as existing_song_spotify_url
      FROM song_submissions ss
      LEFT JOIN songs s ON ss.existing_song_id = s.id
      ${whereClause}
      ORDER BY ${sortField} ${sortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    const submissions = await pool.query(submissionsQuery, queryParams);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM song_submissions ss
      ${whereClause}
    `;
    
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);

    // Get summary statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_submissions,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count,
        COUNT(CASE WHEN existing_song_id IS NOT NULL THEN 1 END) as existing_songs_count
      FROM song_submissions
    `;
    
    const stats = await pool.query(statsQuery);

    res.json({
      submissions: submissions.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: stats.rows[0]
    });

  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Get single submission by ID (admin only)
router.get('/admin/:id', async (req, res) => {
  try {
    const submissionId = req.params.id;

    const query = `
      SELECT 
        ss.*,
        s.title as existing_song_title,
        s.spotify_url as existing_song_spotify_url,
        array_agg(a.name) as existing_song_artists
      FROM song_submissions ss
      LEFT JOIN songs s ON ss.existing_song_id = s.id
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      WHERE ss.id = $1
      GROUP BY ss.id, s.id
    `;

    const result = await pool.query(query, [submissionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching submission:', error);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// Update submission status (admin only)
router.put('/admin/:id/status', async (req, res) => {
  try {
    const submissionId = req.params.id;
    const { status, admin_notes, resolved_by } = req.body;

    // Validate status
    const validStatuses = ['pending', 'approved', 'rejected', 'resolved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    let query = `
      UPDATE song_submissions 
      SET status = $1, admin_notes = $2, updated_at = CURRENT_TIMESTAMP
    `;
    let values = [status, admin_notes || null];
    let paramIndex = 3;

    // Set resolved timestamp and admin if status is resolved
    if (status === 'resolved') {
      query += `, resolved_at = CURRENT_TIMESTAMP, resolved_by = $${paramIndex}`;
      values.push(resolved_by || 'Unknown Admin');
      paramIndex++;
    }

    query += ` WHERE id = $${paramIndex} RETURNING *`;
    values.push(submissionId);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.json({
      message: 'Submission status updated successfully',
      submission: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating submission status:', error);
    res.status(500).json({ error: 'Failed to update submission status' });
  }
});

// Delete submission (admin only)
router.delete('/admin/:id', async (req, res) => {
  try {
    const submissionId = req.params.id;

    const result = await pool.query(
      'DELETE FROM song_submissions WHERE id = $1 RETURNING *',
      [submissionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.json({
      message: 'Submission deleted successfully',
      deleted_submission: result.rows[0]
    });

  } catch (error) {
    console.error('Error deleting submission:', error);
    res.status(500).json({ error: 'Failed to delete submission' });
  }
});

// Get public submission statistics (no authentication needed)
router.get('/stats', async (req, res) => {
  try {
    const query = `
      SELECT 
        COUNT(*) as total_submissions,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count
      FROM song_submissions
    `;

    const result = await pool.query(query);
    
    res.json({
      public_stats: result.rows[0],
      message: 'Thank you for helping us grow the vegan music community!'
    });

  } catch (error) {
    console.error('Error fetching submission stats:', error);
    res.status(500).json({ error: 'Failed to fetch submission stats' });
  }
});

module.exports = router;