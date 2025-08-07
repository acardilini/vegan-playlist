const pool = require('../database/db');

async function debugSubgenreFiltering() {
  try {
    console.log('=== DEBUGGING SUBGENRE FILTERING ISSUE ===\n');
    
    // Test what happens when we filter by a specific subgenre
    const testGenre = 'hardcore punk';
    
    console.log(`Testing filter by subgenre: "${testGenre}"`);
    
    // 1. Check how many songs have this specific genre in songs.genre field
    const songsWithGenre = await pool.query(`
      SELECT COUNT(*) as count
      FROM songs s
      WHERE s.genre = $1
    `, [testGenre]);
    console.log(`Songs with genre="${testGenre}": ${songsWithGenre.rows[0].count}`);
    
    // 2. Check how many songs have this genre via artist_genres
    const songsWithArtistGenre = await pool.query(`
      SELECT COUNT(DISTINCT s.id) as count
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE $1 = ANY(a.genres)
    `, [testGenre]);
    console.log(`Songs with artist genre="${testGenre}": ${songsWithArtistGenre.rows[0].count}`);
    
    // 3. Simulate the current backend search query for subgenres
    const currentSearchQuery = `
      SELECT 
        s.id,
        s.title,
        s.spotify_url,
        s.genre,
        s.parent_genre,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT unnest_genres) as artist_genres
      FROM songs s
      LEFT JOIN albums al ON s.album_id = al.id
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS unnest_genres ON true
      WHERE s.genre = ANY($1::text[])
      GROUP BY s.id, al.id
      LIMIT 10
    `;
    
    const currentResult = await pool.query(currentSearchQuery, [[testGenre]]);
    console.log(`\nCurrent search query results: ${currentResult.rows.length} songs`);
    
    if (currentResult.rows.length > 0) {
      console.log('Sample results:');
      currentResult.rows.slice(0, 3).forEach(song => {
        console.log(`- ${song.title} (genre: ${song.genre}, artist_genres: ${song.artist_genres})`);
      });
    }
    
    // 4. Test what the BETTER query would be (using artist genres)
    const betterSearchQuery = `
      SELECT 
        s.id,
        s.title,
        s.spotify_url,
        s.genre,
        s.parent_genre,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT unnest_genres) as artist_genres
      FROM songs s
      LEFT JOIN albums al ON s.album_id = al.id
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS unnest_genres ON true
      WHERE $1 = ANY(a.genres)
      GROUP BY s.id, al.id
      LIMIT 10
    `;
    
    const betterResult = await pool.query(betterSearchQuery, [testGenre]);
    console.log(`\nBetter search query results: ${betterResult.rows.length} songs`);
    
    if (betterResult.rows.length > 0) {
      console.log('Sample results:');
      betterResult.rows.slice(0, 3).forEach(song => {
        console.log(`- ${song.title} (genre: ${song.genre}, artist_genres: ${song.artist_genres})`);
      });
    }
    
    console.log('\n=== ANALYSIS ===');
    console.log('The issue is likely that the frontend is filtering by songs.genre field,');
    console.log('but many songs only have genres in the artist.genres field.');
    console.log('This confirms we should simplify by using artist_genres directly.');
    
    await pool.end();
  } catch (error) {
    console.error('Debug error:', error);
    process.exit(1);
  }
}

debugSubgenreFiltering();