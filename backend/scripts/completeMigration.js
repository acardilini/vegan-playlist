const pool = require('../database/db');
const { processSpotifyGenres } = require('../utils/genreMapping');

async function completeMigration() {
  console.log('Completing genre migration for all songs...');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get all songs that have artist genres but no song genre yet
    const unmigrated = await client.query(`
      SELECT DISTINCT s.id, s.title, ARRAY_AGG(DISTINCT unnest_genres) as all_genres
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id,
      UNNEST(a.genres) as unnest_genres
      WHERE a.genres IS NOT NULL 
        AND (s.genre IS NULL OR s.parent_genre IS NULL)
      GROUP BY s.id, s.title
    `);
    
    console.log(`Found ${unmigrated.rows.length} songs that need migration`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const song of unmigrated.rows) {
      try {
        // Process the genres to get hierarchical mapping
        const processed = processSpotifyGenres(song.all_genres);
        
        if (processed.genre && processed.parentGenre) {
          // Update the song with genre and parent_genre
          await client.query(
            'UPDATE songs SET genre = $1, parent_genre = $2 WHERE id = $3',
            [processed.genre, processed.parentGenre, song.id]
          );
          
          updated++;
          
          if (updated % 50 === 0) {
            console.log(`Updated ${updated} songs...`);
          }
        } else {
          skipped++;
          console.log(`Skipped "${song.title}" - no genre mapping found for:`, song.all_genres);
        }
      } catch (error) {
        console.error(`Error processing song "${song.title}":`, error.message);
        skipped++;
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`Migration completed!`);
    console.log(`Updated: ${updated} songs`);
    console.log(`Skipped: ${skipped} songs`);
    
    // Verify the results
    const verifyResult = await pool.query(`
      SELECT 
        COUNT(*) as total_songs,
        COUNT(genre) as songs_with_genre,
        COUNT(parent_genre) as songs_with_parent_genre
      FROM songs
    `);
    
    console.log('Final verification:', verifyResult.rows[0]);
    
    // Show updated parent genre counts
    const parentCounts = await pool.query(`
      SELECT parent_genre, COUNT(*) as count 
      FROM songs 
      WHERE parent_genre IS NOT NULL 
      GROUP BY parent_genre 
      ORDER BY count DESC
    `);
    
    console.log('\nUpdated parent genre counts:');
    parentCounts.rows.forEach(row => {
      console.log(`${row.parent_genre}: ${row.count} songs`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Run the migration
completeMigration()
  .then(() => {
    console.log('\nComplete genre migration finished successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Complete genre migration failed:', error);
    process.exit(1);
  });