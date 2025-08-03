const pool = require('../database/db');

async function checkUnmigratedGenres() {
  try {
    console.log('=== CHECKING UNMIGRATED SONG GENRES ===\n');
    
    // Check what genres the unmigrated songs have
    const unmigratedGenres = await pool.query(`
      SELECT DISTINCT UNNEST(a.genres) as genre, COUNT(DISTINCT s.id) as song_count
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE s.genre IS NULL AND a.genres IS NOT NULL
      GROUP BY UNNEST(a.genres)
      ORDER BY song_count DESC
    `);
    
    console.log('Genres from unmigrated songs:');
    unmigratedGenres.rows.forEach(row => {
      console.log(`  ${row.genre}: ${row.song_count} songs`);
    });
    
    // Check a few specific examples
    const exampleSongs = await pool.query(`
      SELECT s.title, ARRAY_AGG(DISTINCT unnest_genres) as all_genres
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id,
      UNNEST(a.genres) as unnest_genres
      WHERE s.genre IS NULL AND a.genres IS NOT NULL
      GROUP BY s.id, s.title
      LIMIT 10
    `);
    
    console.log('\nExample unmigrated songs and their genres:');
    exampleSongs.rows.forEach(row => {
      console.log(`  "${row.title}": [${row.all_genres.join(', ')}]`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUnmigratedGenres();