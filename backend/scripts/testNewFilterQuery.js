const pool = require('../database/db');

async function testNewFilterQuery() {
  try {
    console.log('Testing new parent genre query...');
    
    const parentGenresQuery = `
      WITH all_song_genres AS (
        -- Songs with new genre system
        SELECT s.id, s.parent_genre
        FROM songs s
        WHERE s.parent_genre IS NOT NULL AND s.parent_genre != ''
        
        UNION ALL
        
        -- Songs still using old artist genre system - map to parent genres
        SELECT DISTINCT s.id, 
               CASE 
                 WHEN genre_unnest IN ('metalcore', 'deathcore', 'mathcore', 'groove metal', 'death metal', 'black metal', 'thrash metal', 'doom metal', 'progressive metal', 'nu metal', 'melodic death metal', 'sludge metal', 'stoner metal', 'grindcore', 'heavy metal', 'alternative metal', 'industrial metal', 'speed metal', 'rap metal', 'djent') THEN 'metal'
                 WHEN genre_unnest IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk') THEN 'punk'
                 WHEN genre_unnest IN ('hardcore', 'melodic hardcore', 'post-hardcore', 'crossover hardcore', 'screamo', 'midwest emo') THEN 'hardcore'
                 WHEN genre_unnest IN ('blues rock', 'hard rock', 'alternative rock', 'indie rock', 'classic rock', 'progressive rock', 'psychedelic rock', 'garage rock', 'gothic rock', 'industrial rock', 'art rock', 'acid rock', 'grunge', 'post-grunge', 'britpop', 'madchester', 'krautrock', 'noise rock', 'neo-psychedelic', 'folk rock', 'celtic rock', 'brazilian rock') THEN 'rock'
                 WHEN genre_unnest IN ('folk punk', 'anti-folk', 'indie folk', 'folk rock', 'acoustic folk', 'contemporary folk', 'folk', 'traditional folk', 'americana', 'celtic', 'singer-songwriter', 'country blues') THEN 'folk'
                 WHEN genre_unnest IN ('blues', 'blues rock', 'electric blues', 'acoustic blues', 'delta blues') THEN 'blues'
                 WHEN genre_unnest IN ('pop', 'indie pop', 'electropop', 'synthpop', 'power pop', 'dream pop', 'jangle pop', 'swedish pop', 'german pop', 'new wave', 'pop soul') THEN 'pop'
                 WHEN genre_unnest IN ('electronic', 'ambient', 'techno', 'house', 'drum and bass', 'dubstep', 'edm', 'industrial', 'ebm', 'darkwave', 'coldwave', 'cold wave', 'downtempo', 'trip hop', 'glitch', 'witch house', 'footwork', 'bassline', 'riddim', 'minimalism', 'neoclassical') THEN 'electronic'
                 WHEN genre_unnest IN ('hip hop', 'rap', 'conscious hip hop', 'alternative hip hop', 'underground hip hop', 'east coast hip hop', 'experimental hip hop', 'hardcore hip hop', 'old school hip hop', 'gangster rap', 'horrorcore', 'grime', 'uk grime') THEN 'hip-hop'
                 WHEN genre_unnest IN ('reggae', 'ska', 'dub', 'roots reggae', 'nz reggae', 'lovers rock', 'ragga', 'dancehall', 'rocksteady') THEN 'reggae'
                 WHEN genre_unnest IN ('free jazz', 'hard bop') THEN 'jazz'
                 WHEN genre_unnest IN ('philly soul', 'pop soul', 'gospel', 'gospel r&b') THEN 'soul'
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
      WHERE parent_genre IS NOT NULL
      GROUP BY parent_genre
      ORDER BY count DESC, value ASC
    `;
    
    const result = await pool.query(parentGenresQuery);
    
    console.log('Updated parent genre counts (including all songs):');
    result.rows.forEach(row => {
      console.log(`${row.value}: ${row.count} songs`);
    });
    
    // Check specific punk breakdown
    console.log('\n=== PUNK BREAKDOWN ===');
    const punkQuery = `
      WITH all_punk_songs AS (
        -- Songs with new genre system that are punk
        SELECT s.id, s.genre
        FROM songs s
        WHERE s.parent_genre = 'punk'
        
        UNION ALL
        
        -- Songs from old system that are punk-related
        SELECT DISTINCT s.id, genre_unnest as genre
        FROM songs s
        JOIN song_artists sa ON s.id = sa.song_id
        JOIN artists a ON sa.artist_id = a.id,
        UNNEST(a.genres) as genre_unnest
        WHERE s.parent_genre IS NULL 
          AND genre_unnest IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk')
      )
      SELECT genre, COUNT(*) as count
      FROM all_punk_songs
      GROUP BY genre
      ORDER BY count DESC
    `;
    
    const punkResult = await pool.query(punkQuery);
    
    console.log('All punk-related genres:');
    let totalPunk = 0;
    punkResult.rows.forEach(row => {
      console.log(`${row.genre}: ${row.count} songs`);
      totalPunk += parseInt(row.count);
    });
    console.log(`Total punk songs: ${totalPunk}`);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testNewFilterQuery();