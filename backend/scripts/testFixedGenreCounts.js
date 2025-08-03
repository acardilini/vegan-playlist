const pool = require('../database/db');

async function testFixedGenreCounts() {
  try {
    console.log('=== TESTING FIXED PARENT GENRE COUNTS ===\n');
    
    // Test the NEW parent genre query that should fix the count mismatch
    const parentGenresQuery = `
      WITH all_song_genres AS (
        -- Songs with new genre system
        SELECT s.id, s.genre as genre_value
        FROM songs s
        WHERE s.genre IS NOT NULL AND s.genre != ''
        
        UNION ALL
        
        -- Songs still using old artist genre system
        SELECT DISTINCT s.id, 
               UNNEST(a.genres) as genre_value
        FROM songs s
        JOIN song_artists sa ON s.id = sa.song_id
        JOIN artists a ON sa.artist_id = a.id
        WHERE s.genre IS NULL AND a.genres IS NOT NULL
      ),
      parent_genre_mapping AS (
        SELECT 
          id,
          CASE 
            WHEN genre_value IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk') THEN 'punk'
            WHEN genre_value IN ('metalcore', 'deathcore', 'mathcore', 'groove metal', 'death metal', 'black metal', 'thrash metal', 'doom metal', 'progressive metal', 'nu metal', 'melodic death metal', 'sludge metal', 'stoner metal', 'grindcore', 'heavy metal', 'alternative metal', 'industrial metal', 'speed metal', 'rap metal', 'djent') THEN 'metal'
            WHEN genre_value IN ('hardcore', 'melodic hardcore', 'post-hardcore', 'crossover hardcore', 'screamo', 'midwest emo') THEN 'hardcore'
            ELSE 'other'
          END as parent_genre
        FROM all_song_genres
      )
      SELECT parent_genre as value, COUNT(DISTINCT id) as count
      FROM parent_genre_mapping
      WHERE parent_genre IN ('punk', 'metal', 'hardcore')
      GROUP BY parent_genre
      ORDER BY count DESC, value ASC
    `;
    
    const parentResult = await pool.query(parentGenresQuery);
    console.log('FIXED Parent Genre Counts:');
    parentResult.rows.forEach(row => {
      console.log(`${row.value}: ${row.count} songs`);
    });
    
    // Now get the specific genre counts for comparison
    const specificGenresQuery = `
      WITH all_song_genres AS (
        -- Songs with new genre system
        SELECT s.id, s.genre as genre_value
        FROM songs s
        WHERE s.genre IS NOT NULL AND s.genre != ''
        
        UNION ALL
        
        -- Songs still using old artist genre system
        SELECT DISTINCT s.id, 
               UNNEST(a.genres) as genre_value
        FROM songs s
        JOIN song_artists sa ON s.id = sa.song_id
        JOIN artists a ON sa.artist_id = a.id
        WHERE s.genre IS NULL AND a.genres IS NOT NULL
      )
      SELECT genre_value as value, COUNT(DISTINCT id) as count
      FROM all_song_genres
      WHERE genre_value IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk')
      GROUP BY genre_value
      ORDER BY count DESC, value ASC
    `;
    
    const specificResult = await pool.query(specificGenresQuery);
    console.log('\nSpecific Punk Genres:');
    let totalSpecific = 0;
    specificResult.rows.forEach(row => {
      console.log(`  ${row.value}: ${row.count} songs`);
      totalSpecific += parseInt(row.count);
    });
    console.log(`Total punk subgenres: ${totalSpecific}`);
    
    const punkParentCount = parentResult.rows.find(r => r.value === 'punk')?.count || 0;
    
    console.log('\n=== VERIFICATION ===');
    console.log(`Parent genre 'punk': ${punkParentCount} songs`);
    console.log(`Sum of punk subgenres: ${totalSpecific} songs`);
    console.log(`Match: ${punkParentCount == totalSpecific ? '✅ YES' : '❌ NO'}`);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testFixedGenreCounts();