const pool = require('../database/db');
const { getParentGenre } = require('../utils/genreMapping');

async function fixGenreMappings() {
  console.log('Fixing genre mappings with updated hierarchy...');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get all songs with genres
    const songsResult = await client.query(`
      SELECT id, genre, parent_genre 
      FROM songs 
      WHERE genre IS NOT NULL
    `);
    
    console.log(`Found ${songsResult.rows.length} songs with genre data`);
    
    let updated = 0;
    let unchanged = 0;
    
    for (const song of songsResult.rows) {
      const correctParentGenre = getParentGenre(song.genre);
      
      if (correctParentGenre !== song.parent_genre) {
        // Update the parent genre
        await client.query(
          'UPDATE songs SET parent_genre = $1 WHERE id = $2',
          [correctParentGenre, song.id]
        );
        
        console.log(`Updated: ${song.genre} -> ${correctParentGenre} (was: ${song.parent_genre})`);
        updated++;
      } else {
        unchanged++;
      }
      
      if ((updated + unchanged) % 100 === 0) {
        console.log(`Processed ${updated + unchanged} songs...`);
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`\nMigration completed!`);
    console.log(`Updated: ${updated} songs`);
    console.log(`Unchanged: ${unchanged} songs`);
    
    // Verify the results
    console.log('\n=== VERIFICATION ===');
    
    const parentGenreCountsResult = await pool.query(`
      SELECT parent_genre, COUNT(*) as count 
      FROM songs 
      WHERE parent_genre IS NOT NULL 
      GROUP BY parent_genre 
      ORDER BY count DESC
    `);
    
    console.log('Parent genre counts after fix:');
    parentGenreCountsResult.rows.forEach(row => {
      console.log(`${row.parent_genre}: ${row.count} songs`);
    });
    
    // Check for remaining 'other' mappings
    const otherGenresResult = await pool.query(`
      SELECT genre, COUNT(*) as count 
      FROM songs 
      WHERE parent_genre = 'other' 
      GROUP BY genre 
      ORDER BY count DESC
    `);
    
    if (otherGenresResult.rows.length > 0) {
      console.log('\nGenres still mapped to "other":');
      otherGenresResult.rows.forEach(row => {
        console.log(`${row.genre}: ${row.count} songs`);
      });
    } else {
      console.log('\n✅ No genres mapped to "other" - all genres properly categorized!');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Run the fix
fixGenreMappings()
  .then(() => {
    console.log('\nGenre mapping fix completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Genre mapping fix failed:', error);
    process.exit(1);
  });