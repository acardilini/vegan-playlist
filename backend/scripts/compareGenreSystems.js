const pool = require('../database/db');

async function compareGenreSystems() {
  try {
    console.log('=== COMPARING OLD VS NEW GENRE SYSTEMS ===\n');
    
    // Check old system (artist genres) - this is what the filter options currently shows
    const oldSystemResult = await pool.query(`
      SELECT UNNEST(a.genres) as genre, COUNT(DISTINCT s.id) as count
      FROM artists a
      JOIN song_artists sa ON a.id = sa.artist_id
      JOIN songs s ON sa.song_id = s.id
      WHERE a.genres IS NOT NULL
      GROUP BY UNNEST(a.genres)
      ORDER BY count DESC
      LIMIT 15
    `);
    
    console.log('OLD SYSTEM (artist genres - what filter currently shows):');
    oldSystemResult.rows.forEach(row => {
      console.log(`${row.genre}: ${row.count} songs`);
    });
    
    // Check new system (song genres)
    const newSystemResult = await pool.query(`
      SELECT genre, COUNT(*) as count
      FROM songs 
      WHERE genre IS NOT NULL 
      GROUP BY genre 
      ORDER BY count DESC
      LIMIT 15
    `);
    
    console.log('\nNEW SYSTEM (song genres - after migration):');
    newSystemResult.rows.forEach(row => {
      console.log(`${row.genre}: ${row.count} songs`);
    });
    
    // Check how many songs were migrated vs total
    const totalSongs = await pool.query('SELECT COUNT(*) as count FROM songs');
    const migratedSongs = await pool.query('SELECT COUNT(*) as count FROM songs WHERE genre IS NOT NULL');
    const songsWithArtistGenres = await pool.query(`
      SELECT COUNT(DISTINCT s.id) as count
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE a.genres IS NOT NULL
    `);
    
    console.log(`\nMIGRATION STATUS:`);
    console.log(`Total songs: ${totalSongs.rows[0].count}`);
    console.log(`Songs with artist genres: ${songsWithArtistGenres.rows[0].count}`);
    console.log(`Songs with new genre field: ${migratedSongs.rows[0].count}`);
    console.log(`Songs without genre: ${totalSongs.rows[0].count - migratedSongs.rows[0].count}`);
    
    // Check specific punk genre discrepancy
    console.log('\n=== PUNK GENRE ANALYSIS ===');
    
    const punkOldSystem = await pool.query(`
      SELECT UNNEST(a.genres) as genre, COUNT(DISTINCT s.id) as count
      FROM artists a
      JOIN song_artists sa ON a.id = sa.artist_id
      JOIN songs s ON sa.song_id = s.id
      WHERE a.genres IS NOT NULL AND UNNEST(a.genres) LIKE '%punk%'
      GROUP BY UNNEST(a.genres)
      ORDER BY count DESC
    `);
    
    console.log('Punk-related genres in OLD system:');
    let totalPunkOld = 0;
    punkOldSystem.rows.forEach(row => {
      console.log(`${row.genre}: ${row.count} songs`);
      totalPunkOld += parseInt(row.count);
    });
    console.log(`Total punk songs (OLD): ${totalPunkOld}`);
    
    const punkParentCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM songs 
      WHERE parent_genre = 'punk'
    `);
    
    console.log(`Punk parent genre count (NEW): ${punkParentCount.rows[0].count}`);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

compareGenreSystems();