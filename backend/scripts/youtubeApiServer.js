const express = require('express');
const cors = require('cors');
const pool = require('../database/db');

const app = express();
const PORT = 5001; // Different port to avoid conflict

// Middleware
app.use(cors());
app.use(express.json());

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

// Get primary YouTube video for a specific song
app.get('/api/youtube/songs/:songId/video/primary', async (req, res) => {
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
app.post('/api/youtube/songs/:songId/videos', async (req, res) => {
  try {
    const songId = parseInt(req.params.songId);
    const { youtube_url, video_type = 'official', is_primary = true, video_title, video_description } = req.body;
    
    // Extract YouTube ID from URL
    const youtubeId = extractYouTubeId(youtube_url);
    if (!youtubeId || !/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
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

// Test endpoint
app.get('/api/youtube/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'YouTube API server is running!',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🎥 YouTube API Server running on port ${PORT}`);
  console.log(`📍 Test endpoint: http://localhost:${PORT}/api/youtube/test`);
  console.log(`🔧 This is a temporary server until main server is restarted`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('YouTube API server shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('YouTube API server shutting down...');
  process.exit(0);
});