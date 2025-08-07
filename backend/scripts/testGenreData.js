const pool = require('../database/db');

async function testGenreData() {
  try {
    console.log('=== TESTING GENRE DATA IN DATABASE ===\n');
    
    // Test a specific song to see its data
    const testSong = await pool.query(`
      SELECT 
        s.id, 
        s.title,
        s.genre,
        s.parent_genre,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT genre_elem) FILTER (WHERE genre_elem IS NOT NULL) as artist_genres
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS genre_elem ON true
      WHERE s.title ILIKE '%ready to fall%'
      GROUP BY s.id
      LIMIT 1
    `);
    
    if (testSong.rows.length > 0) {
      const song = testSong.rows[0];
      console.log('Test song data:');
      console.log(`Title: ${song.title}`);
      console.log(`Artists: ${song.artists}`);
      console.log(`Old genre field: ${song.genre}`);
      console.log(`Old parent_genre field: ${song.parent_genre}`);
      console.log(`Artist genres: ${song.artist_genres}`);
    }
    
    // Check why artist_genres might be empty
    const artistCheck = await pool.query(`
      SELECT a.name, a.genres
      FROM artists a
      JOIN song_artists sa ON a.id = sa.artist_id
      JOIN songs s ON sa.song_id = s.id
      WHERE s.title ILIKE '%ready to fall%'
    `);
    
    console.log('\nArtist data for this song:');
    artistCheck.rows.forEach(artist => {
      console.log(`Artist: ${artist.name}, Genres: ${artist.genres}`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testGenreData();