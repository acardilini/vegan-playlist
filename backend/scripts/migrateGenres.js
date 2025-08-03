const pool = require('../database/db');
const { processSpotifyGenres } = require('../utils/genreMapping');

async function migrateGenres() {
  console.log('Starting genre migration...');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get all songs with their artist genres
    const songsResult = await client.query(`
      SELECT DISTINCT s.id, s.title, ARRAY_AGG(DISTINCT unnest_genres) as all_genres
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id,
      UNNEST(a.genres) as unnest_genres
      WHERE a.genres IS NOT NULL
      GROUP BY s.id, s.title
    `);
    
    console.log(`Found ${songsResult.rows.length} songs with genre data`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const song of songsResult.rows) {
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
          
          if (updated % 100 === 0) {
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
    
    console.log('Verification:', verifyResult.rows[0]);
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Run the migration
migrateGenres()
  .then(() => {
    console.log('Genre migration completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Genre migration failed:', error);
    process.exit(1);
  });