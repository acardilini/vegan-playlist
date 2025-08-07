const express = require('express');
const pool = require('../database/db');
const router = express.Router();

// Utility function to extract YouTube video ID from URL
const extractYouTubeId = (url) => {
  if (!url) return null;
  
  // Handle various YouTube URL formats
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

// Utility function to validate YouTube video ID format
const isValidYouTubeId = (id) => {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
};

// Get YouTube videos for a specific song
router.get('/songs/:songId/videos', async (req, res) => {
  try {
    const songId = parseInt(req.params.songId);
    
    const result = await pool.query(`
      SELECT 
        id,
        youtube_id,
        video_title,
        video_description,
        thumbnail_url,
        video_type,
        is_primary,
        created_at,
        updated_at
      FROM youtube_videos 
      WHERE song_id = $1
      ORDER BY is_primary DESC, created_at DESC
    `, [songId]);
    
    res.json({
      success: true,
      videos: result.rows
    });
  } catch (error) {
    console.error('Error fetching YouTube videos:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch YouTube videos'
    });
  }
});

// Get primary YouTube video for a specific song
router.get('/songs/:songId/video/primary', async (req, res) => {
  try {
    const songId = parseInt(req.params.songId);
    
    const result = await pool.query(`
      SELECT 
        id,
        youtube_id,
        video_title,
        video_type,
        thumbnail_url
      FROM youtube_videos 
      WHERE song_id = $1 AND is_primary = true
      LIMIT 1
    `, [songId]);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        video: null
      });
    }
    
    res.json({
      success: true,
      video: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching primary YouTube video:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch primary YouTube video'
    });
  }
});

// Add YouTube video to a song
router.post('/songs/:songId/videos', async (req, res) => {
  try {
    const songId = parseInt(req.params.songId);
    const { youtube_url, video_type = 'official', is_primary = true, video_title, video_description } = req.body;
    
    // Extract YouTube ID from URL
    const youtubeId = extractYouTubeId(youtube_url);
    if (!youtubeId || !isValidYouTubeId(youtubeId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL or video ID'
      });
    }
    
    // Check if video already exists for this song
    const existingVideo = await pool.query(
      'SELECT id FROM youtube_videos WHERE song_id = $1 AND youtube_id = $2',
      [songId, youtubeId]
    );
    
    if (existingVideo.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'This video is already associated with this song'
      });
    }
    
    // If this is set as primary, unset other primary videos for this song
    if (is_primary) {
      await pool.query(
        'UPDATE youtube_videos SET is_primary = false WHERE song_id = $1',
        [songId]
      );
    }
    
    // Generate thumbnail URL
    const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
    
    // Insert new video
    const result = await pool.query(`
      INSERT INTO youtube_videos (
        song_id, youtube_id, video_title, video_description, 
        thumbnail_url, video_type, is_primary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [songId, youtubeId, video_title, video_description, thumbnailUrl, video_type, is_primary]);
    
    res.json({
      success: true,
      video: result.rows[0],
      message: `YouTube video added successfully`
    });
  } catch (error) {
    console.error('Error adding YouTube video:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add YouTube video'
    });
  }
});

// Update YouTube video
router.put('/videos/:videoId', async (req, res) => {
  try {
    const videoId = parseInt(req.params.videoId);
    const { video_title, video_description, video_type, is_primary } = req.body;
    
    // Get current video info to check song_id
    const currentVideo = await pool.query(
      'SELECT song_id FROM youtube_videos WHERE id = $1',
      [videoId]
    );
    
    if (currentVideo.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }
    
    const songId = currentVideo.rows[0].song_id;
    
    // If setting as primary, unset other primary videos for this song
    if (is_primary) {
      await pool.query(
        'UPDATE youtube_videos SET is_primary = false WHERE song_id = $1 AND id != $2',
        [songId, videoId]
      );
    }
    
    // Update video
    const result = await pool.query(`
      UPDATE youtube_videos 
      SET 
        video_title = COALESCE($2, video_title),
        video_description = COALESCE($3, video_description),
        video_type = COALESCE($4, video_type),
        is_primary = COALESCE($5, is_primary),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [videoId, video_title, video_description, video_type, is_primary]);
    
    res.json({
      success: true,
      video: result.rows[0],
      message: 'YouTube video updated successfully'
    });
  } catch (error) {
    console.error('Error updating YouTube video:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update YouTube video'
    });
  }
});

// Delete YouTube video
router.delete('/videos/:videoId', async (req, res) => {
  try {
    const videoId = parseInt(req.params.videoId);
    
    const result = await pool.query(
      'DELETE FROM youtube_videos WHERE id = $1 RETURNING *',
      [videoId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }
    
    res.json({
      success: true,
      message: 'YouTube video deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting YouTube video:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete YouTube video'
    });
  }
});

// Utility endpoint to extract YouTube ID from URL
router.post('/extract-id', (req, res) => {
  try {
    const { url } = req.body;
    const youtubeId = extractYouTubeId(url);
    
    if (!youtubeId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL'
      });
    }
    
    res.json({
      success: true,
      youtube_id: youtubeId,
      embed_url: `https://www.youtube.com/embed/${youtubeId}`,
      thumbnail_url: `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`
    });
  } catch (error) {
    console.error('Error extracting YouTube ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract YouTube ID'
    });
  }
});

// Search YouTube for videos based on song info
router.post('/search', async (req, res) => {
  try {
    const { songId, query, maxResults = 5 } = req.body;
    
    // If we have a song ID, get song info for better search
    let searchQuery = query;
    if (songId && !query) {
      const songResult = await pool.query(`
        SELECT s.title, string_agg(a.name, ' ') as artists
        FROM songs s
        LEFT JOIN song_artists sa ON s.id = sa.song_id  
        LEFT JOIN artists a ON sa.artist_id = a.id
        WHERE s.id = $1
        GROUP BY s.id, s.title
      `, [songId]);
      
      if (songResult.rows.length > 0) {
        const song = songResult.rows[0];
        searchQuery = `${song.artists} ${song.title}`;
      }
    }
    
    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    // For now, we'll create a simple search result structure
    // In a real implementation, you'd integrate with YouTube Data API
    // Since we don't have API keys, I'll create a mock structure that
    // allows manual URL entry with search suggestions
    
    const mockResults = [
      {
        id: 'search_1',
        title: `${searchQuery} - Official Video`,
        description: 'Suggested search result',
        thumbnailUrl: 'https://via.placeholder.com/320x180/1f1f1f/ffffff?text=Video+1',
        channelTitle: 'Artist Channel',
        publishedAt: new Date().toISOString(),
        duration: 'Unknown',
        viewCount: 'Unknown'
      },
      {
        id: 'search_2', 
        title: `${searchQuery} - Official Audio`,
        description: 'Suggested search result',
        thumbnailUrl: 'https://via.placeholder.com/320x180/1f1f1f/ffffff?text=Video+2',
        channelTitle: 'Artist Channel',
        publishedAt: new Date().toISOString(),
        duration: 'Unknown',
        viewCount: 'Unknown'
      },
      {
        id: 'search_3',
        title: `${searchQuery} - Live Performance`, 
        description: 'Suggested search result',
        thumbnailUrl: 'https://via.placeholder.com/320x180/1f1f1f/ffffff?text=Video+3',
        channelTitle: 'Live Channel',
        publishedAt: new Date().toISOString(),
        duration: 'Unknown',
        viewCount: 'Unknown'
      }
    ];

    res.json({
      success: true,
      query: searchQuery,
      results: mockResults.slice(0, maxResults),
      message: 'Search completed (showing placeholder results - paste actual YouTube URLs below)'
    });
    
  } catch (error) {
    console.error('Error searching YouTube:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search YouTube'
    });
  }
});

// Get songs that need YouTube videos (for batch processing)
router.get('/songs/missing-videos', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.title,
        string_agg(a.name, ', ') as artists,
        s.popularity,
        s.data_source
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id  
      LEFT JOIN youtube_videos yv ON s.id = yv.song_id
      WHERE yv.song_id IS NULL
      GROUP BY s.id, s.title, s.popularity, s.data_source
      ORDER BY s.popularity DESC NULLS LAST, s.title ASC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(DISTINCT s.id) as total
      FROM songs s
      LEFT JOIN youtube_videos yv ON s.id = yv.song_id
      WHERE yv.song_id IS NULL
    `);
    
    const total = parseInt(countResult.rows[0].total);
    
    res.json({
      success: true,
      songs: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching songs missing videos:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch songs missing videos'
    });
  }
});

module.exports = router;