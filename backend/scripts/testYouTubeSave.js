const pool = require('../database/db');

// Test the YouTube save functionality directly
async function testYouTubeSave() {
  try {
    console.log('🎥 Testing YouTube save functionality...');
    
    const songId = 1;
    const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    
    // Clean up any existing test data first
    console.log('Cleaning up existing test data...');
    await pool.query('DELETE FROM youtube_videos WHERE song_id = $1 AND youtube_id = $2', [songId, 'dQw4w9WgXcQ']);
    
    // Extract YouTube ID
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
    
    const youtubeId = extractYouTubeId(youtubeUrl);
    console.log('Extracted YouTube ID:', youtubeId);
    
    if (!youtubeId || !/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
      throw new Error('Invalid YouTube URL or video ID');
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if video already exists for this song
      const existingVideo = await client.query(
        'SELECT id FROM youtube_videos WHERE song_id = $1 AND youtube_id = $2',
        [songId, youtubeId]
      );
      
      if (existingVideo.rows.length > 0) {
        console.log('✅ Video already exists for this song');
        await client.query('ROLLBACK');
        return;
      }
      
      // Unset other primary videos for this song
      await client.query(
        'UPDATE youtube_videos SET is_primary = false WHERE song_id = $1',
        [songId]
      );
      
      // Generate thumbnail URL
      const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
      
      // Insert new video
      const result = await client.query(`
        INSERT INTO youtube_videos (
          song_id, youtube_id, thumbnail_url, video_type, is_primary, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *
      `, [songId, youtubeId, thumbnailUrl, 'official', true]);
      
      await client.query('COMMIT');
      
      console.log('✅ YouTube video saved successfully!');
      console.log('Video data:', result.rows[0]);
      
      // Test retrieval
      const retrieveResult = await client.query(
        'SELECT * FROM youtube_videos WHERE song_id = $1 AND is_primary = true',
        [songId]
      );
      
      if (retrieveResult.rows.length > 0) {
        const video = retrieveResult.rows[0];
        console.log('✅ Video retrieved successfully!');
        console.log('Embed URL would be:', `https://www.youtube.com/embed/${video.youtube_id}`);
      }
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ YouTube save test failed:', error.message);
    console.error('Full error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testYouTubeSave();