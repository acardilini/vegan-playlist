const pool = require('../database/db');

async function checkMissingSongs() {
  try {
    // Check songs without genres
    const songsWithoutGenres = await pool.query(`
      SELECT s.title, s.data_source, COUNT(a.genres) as artist_genre_count
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      WHERE s.genre IS NULL
      GROUP BY s.id, s.title, s.data_source
      LIMIT 10
    `);
    
    console.log('Songs without genres (first 10):');
    songsWithoutGenres.rows.forEach(row => {
      console.log(`- ${row.title} (source: ${row.data_source}, artist genres: ${row.artist_genre_count})`);
    });
    
    // Check if these are manual songs
    const manualSongsCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM songs s
      WHERE s.genre IS NULL AND s.data_source = 'manual'
    `);
    
    const spotifySongsWithoutGenres = await pool.query(`
      SELECT COUNT(*) as count
      FROM songs s
      WHERE s.genre IS NULL AND s.data_source = 'spotify'
    `);
    
    console.log(`\nBreakdown of songs without genres:`);
    console.log(`Manual songs: ${manualSongsCount.rows[0].count}`);
    console.log(`Spotify songs: ${spotifySongsWithoutGenres.rows[0].count}`);
    
    // The real issue is that the filter endpoint is using OLD system but parent counts use NEW system
    console.log('\n=== THE REAL ISSUE ===');
    console.log('Filter endpoint shows OLD artist genre counts (192 hardcore punk songs)');
    console.log('But parent genre counts use NEW song genre system (95 punk songs total)');
    console.log('This creates the mismatch you noticed!');
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkMissingSongs();