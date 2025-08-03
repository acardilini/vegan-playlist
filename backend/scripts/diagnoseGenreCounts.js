const pool = require('../database/db');

async function diagnoseGenreCounts() {
  try {
    console.log('=== DIAGNOSING GENRE COUNT MISMATCH ===\n');
    
    // 1. Check how many songs have been migrated to new system
    const migrationStatus = await pool.query(`
      SELECT 
        COUNT(*) as total_songs,
        COUNT(genre) as with_genre,
        COUNT(parent_genre) as with_parent_genre,
        COUNT(*) - COUNT(genre) as without_genre
      FROM songs
    `);
    
    console.log('Migration Status:');
    console.log(`Total songs: ${migrationStatus.rows[0].total_songs}`);
    console.log(`Songs with genre: ${migrationStatus.rows[0].with_genre}`);
    console.log(`Songs with parent_genre: ${migrationStatus.rows[0].with_parent_genre}`);
    console.log(`Songs without genre: ${migrationStatus.rows[0].without_genre}\n`);
    
    // 2. Check specific case: punk parent genre
    console.log('=== PUNK GENRE ANALYSIS ===');
    
    // Count songs with parent_genre = 'punk' (NEW system)
    const punkParentCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM songs 
      WHERE parent_genre = 'punk'
    `);
    console.log(`Songs with parent_genre = 'punk' (NEW system): ${punkParentCount.rows[0].count}`);
    
    // Count songs with specific punk genres (NEW system)
    const punkSpecificNew = await pool.query(`
      SELECT genre, COUNT(*) as count
      FROM songs 
      WHERE genre IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk')
      AND genre IS NOT NULL
      GROUP BY genre
      ORDER BY count DESC
    `);
    console.log('\nPunk subgenres in NEW system:');
    let totalPunkNew = 0;
    punkSpecificNew.rows.forEach(row => {
      console.log(`  ${row.genre}: ${row.count}`);
      totalPunkNew += parseInt(row.count);
    });
    console.log(`Total punk songs in NEW system: ${totalPunkNew}`);
    
    // Count songs with punk genres via artist genres (OLD system)
    const punkSpecificOld = await pool.query(`
      SELECT genre_unnest as genre, COUNT(DISTINCT s.id) as count
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id,
      UNNEST(a.genres) as genre_unnest
      WHERE genre_unnest IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk')
      GROUP BY genre_unnest
      ORDER BY count DESC
    `);
    console.log('\nPunk subgenres in OLD system (artist genres):');
    let totalPunkOld = 0;
    punkSpecificOld.rows.forEach(row => {
      console.log(`  ${row.genre}: ${row.count}`);
      totalPunkOld += parseInt(row.count);
    });
    console.log(`Total punk songs in OLD system: ${totalPunkOld}`);
    
    // 3. Check overlap between systems
    console.log('\n=== SYSTEM OVERLAP ANALYSIS ===');
    
    const overlapAnalysis = await pool.query(`
      SELECT 
        COUNT(CASE WHEN s.genre IS NOT NULL THEN 1 END) as migrated_songs,
        COUNT(CASE WHEN s.genre IS NULL AND a.genres IS NOT NULL THEN 1 END) as old_system_songs,
        COUNT(CASE WHEN s.genre IS NULL AND a.genres IS NULL THEN 1 END) as no_genre_songs
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
    `);
    
    console.log('Song categorization:');
    console.log(`Migrated to new system: ${overlapAnalysis.rows[0].migrated_songs}`);
    console.log(`Still using old system: ${overlapAnalysis.rows[0].old_system_songs}`);
    console.log(`No genre data: ${overlapAnalysis.rows[0].no_genre_songs}`);
    
    // 4. Check what the filter-options endpoint actually returns
    console.log('\n=== CURRENT FILTER ENDPOINT RESULTS ===');
    
    // Simulate the exact query from filter-options endpoint for punk
    const filterParentGenreQuery = `
      WITH all_song_genres AS (
        -- Songs with new genre system
        SELECT s.id, s.parent_genre
        FROM songs s
        WHERE s.parent_genre IS NOT NULL AND s.parent_genre != ''
        
        UNION ALL
        
        -- Songs still using old artist genre system - map to parent genres
        SELECT DISTINCT s.id, 
               CASE 
                 WHEN genre_unnest IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk') THEN 'punk'
                 ELSE 'other'
               END as parent_genre
        FROM songs s
        JOIN song_artists sa ON s.id = sa.song_id
        JOIN artists a ON sa.artist_id = a.id,
        UNNEST(a.genres) as genre_unnest
        WHERE s.parent_genre IS NULL AND a.genres IS NOT NULL
      )
      SELECT parent_genre as value, COUNT(*) as count
      FROM all_song_genres
      WHERE parent_genre = 'punk'
      GROUP BY parent_genre
    `;
    
    const filterResult = await pool.query(filterParentGenreQuery);
    console.log(`Filter endpoint reports punk parent genre: ${filterResult.rows[0]?.count || 0} songs`);
    
    // 5. Check what specific genres the filter endpoint returns
    const filterSpecificGenreQuery = `
      WITH all_song_genres AS (
        -- Songs with new genre system
        SELECT s.id, s.genre as genre_value, s.parent_genre
        FROM songs s
        WHERE s.genre IS NOT NULL AND s.genre != ''
        
        UNION ALL
        
        -- Songs still using old artist genre system
        SELECT DISTINCT s.id, 
               UNNEST(a.genres) as genre_value,
               NULL as parent_genre
        FROM songs s
        JOIN song_artists sa ON s.id = sa.song_id
        JOIN artists a ON sa.artist_id = a.id
        WHERE s.genre IS NULL AND a.genres IS NOT NULL
      )
      SELECT genre_value as value, COUNT(*) as count
      FROM all_song_genres
      WHERE genre_value IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk')
      GROUP BY genre_value
      ORDER BY count DESC
    `;
    
    const filterSpecificResult = await pool.query(filterSpecificGenreQuery);
    console.log('\nFilter endpoint specific punk genres:');
    filterSpecificResult.rows.forEach(row => {
      console.log(`  ${row.value}: ${row.count}`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

diagnoseGenreCounts();