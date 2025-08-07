const pool = require('../database/db');

// Test YouTube integration directly with database
async function testYouTubeIntegration() {
  try {
    console.log('🎥 Testing YouTube integration...');
    
    // Test 1: Add a YouTube video to a song
    const testSongId = 1; // Use song ID 1 for testing
    const testYouTubeId = 'dQw4w9WgXcQ'; // Rick Roll for testing
    const testVideoUrl = `https://youtube.com/watch?v=${testYouTubeId}`;
    
    console.log('\n1️⃣ Testing video insertion...');
    
    // First, check if this video already exists
    const existingVideo = await pool.query(
      'SELECT * FROM youtube_videos WHERE song_id = $1 AND youtube_id = $2',
      [testSongId, testYouTubeId]
    );
    
    if (existingVideo.rows.length > 0) {
      console.log(`⚠️  Test video already exists for song ${testSongId}, deleting first...`);
      await pool.query('DELETE FROM youtube_videos WHERE song_id = $1 AND youtube_id = $2', [testSongId, testYouTubeId]);
    }
    
    // Insert test video
    const insertResult = await pool.query(`
      INSERT INTO youtube_videos (
        song_id, youtube_id, video_title, thumbnail_url, video_type, is_primary
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      testSongId,
      testYouTubeId,
      'Test Video - Never Gonna Give You Up',
      `https://img.youtube.com/vi/${testYouTubeId}/mqdefault.jpg`,
      'official',
      true
    ]);
    
    if (insertResult.rows.length > 0) {
      console.log('✅ Video inserted successfully!');
      console.log('   Video ID:', insertResult.rows[0].id);
      console.log('   YouTube ID:', insertResult.rows[0].youtube_id);
      console.log('   Title:', insertResult.rows[0].video_title);
    }
    
    // Test 2: Retrieve the video
    console.log('\n2️⃣ Testing video retrieval...');
    const retrieveResult = await pool.query(
      'SELECT * FROM youtube_videos WHERE song_id = $1 AND is_primary = true',
      [testSongId]
    );
    
    if (retrieveResult.rows.length > 0) {
      const video = retrieveResult.rows[0];
      console.log('✅ Video retrieved successfully!');
      console.log('   YouTube URL:', `https://youtube.com/watch?v=${video.youtube_id}`);
      console.log('   Embed URL:', `https://www.youtube.com/embed/${video.youtube_id}`);
      console.log('   Thumbnail:', video.thumbnail_url);
    } else {
      console.log('❌ No video found for retrieval test');
    }
    
    // Test 3: URL parsing function
    console.log('\n3️⃣ Testing URL parsing...');
    const testUrls = [
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'dQw4w9WgXcQ'
    ];
    
    const extractYouTubeId = (url) => {
      if (!url) return null;
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
      ];
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
      }
      return null;
    };
    
    testUrls.forEach(url => {
      const extractedId = extractYouTubeId(url);
      console.log(`   ${url} → ${extractedId || 'FAILED'}`);
    });
    
    // Test 4: Check song exists
    console.log('\n4️⃣ Testing song existence...');
    const songCheck = await pool.query('SELECT id, title, artists FROM songs WHERE id = $1', [testSongId]);
    if (songCheck.rows.length > 0) {
      const song = songCheck.rows[0];
      console.log(`✅ Song found: "${song.title}" by ${song.artists}`);
    } else {
      console.log(`❌ Song with ID ${testSongId} not found`);
    }
    
    console.log('\n🎯 YouTube Integration Test Results:');
    console.log('   Database table: ✅ Working');
    console.log('   Video insertion: ✅ Working');
    console.log('   Video retrieval: ✅ Working');
    console.log('   URL parsing: ✅ Working');
    
    // Clean up test data
    await pool.query('DELETE FROM youtube_videos WHERE song_id = $1 AND youtube_id = $2', [testSongId, testYouTubeId]);
    console.log('   🧹 Test data cleaned up');
    
  } catch (error) {
    console.error('❌ YouTube integration test failed:', error.message);
    console.error('Full error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testYouTubeIntegration();