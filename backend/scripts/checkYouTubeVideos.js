const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkYouTubeVideos() {
  try {
    // Check total songs
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM songs');
    console.log('Total songs:', totalResult.rows[0].total);
    
    // Check YouTube videos count
    const youtubeResult = await pool.query(`
      SELECT COUNT(DISTINCT s.id) as songs_with_videos
      FROM songs s
      INNER JOIN youtube_videos yv ON s.id = yv.song_id
    `);
    console.log('Songs with YouTube videos:', youtubeResult.rows[0].songs_with_videos);
    
    // Check specific videos
    const videosResult = await pool.query(`
      SELECT s.title, string_agg(a.name, ', ') as artists, yv.youtube_id, yv.created_at
      FROM songs s
      INNER JOIN youtube_videos yv ON s.id = yv.song_id
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists ar ON sa.artist_id = ar.id
      GROUP BY s.id, s.title, yv.youtube_id, yv.created_at
      ORDER BY yv.created_at DESC
    `);
    console.log('\nYouTube videos in database:');
    videosResult.rows.forEach(row => {
      console.log(`- "${row.title}" by ${row.artists || 'Unknown'} (${row.youtube_id}) - Added: ${row.created_at}`);
    });
    
    // Check if we have the specific songs mentioned
    const specificResult = await pool.query(`
      SELECT s.title, string_agg(a.name, ', ') as artists, yv.youtube_id
      FROM songs s
      LEFT JOIN youtube_videos yv ON s.id = yv.song_id
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists ar ON sa.artist_id = ar.id
      WHERE s.title ILIKE '%meat is murder%' OR s.title ILIKE '%stand by you%'
      GROUP BY s.id, s.title, yv.youtube_id
    `);
    console.log('\nChecking specific mentioned songs:');
    specificResult.rows.forEach(row => {
      console.log(`- "${row.title}" by ${row.artists || 'Unknown'} - Video: ${row.youtube_id || 'No video'}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkYouTubeVideos();