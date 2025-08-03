const pool = require('../database/db');
const { getParentGenre, processSpotifyGenres, GENRE_HIERARCHY } = require('../utils/genreMapping');

async function checkGenreMappings() {
  try {
    console.log('=== CHECKING GENRE MAPPINGS ===\n');
    
    // Get all genres and their parent mappings
    const result = await pool.query(`
      SELECT genre, parent_genre, COUNT(*) as count 
      FROM songs 
      WHERE genre IS NOT NULL 
      GROUP BY genre, parent_genre 
      ORDER BY count DESC
    `);
    
    console.log('Current genre mappings in database:');
    const mismatches = [];
    const unmapped = [];
    
    result.rows.forEach(row => {
      const expectedParent = getParentGenre(row.genre);
      const mismatch = expectedParent !== row.parent_genre;
      
      if (mismatch) {
        mismatches.push({
          genre: row.genre,
          current_parent: row.parent_genre,
          expected_parent: expectedParent,
          count: row.count
        });
        console.log(`❌ ${row.genre} -> ${row.parent_genre} (${row.count}) [expected: ${expectedParent}]`);
      } else {
        console.log(`✅ ${row.genre} -> ${row.parent_genre} (${row.count})`);
      }
      
      if (expectedParent === 'other') {
        unmapped.push({
          genre: row.genre,
          count: row.count
        });
      }
    });
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total genres: ${result.rows.length}`);
    console.log(`Mismatched mappings: ${mismatches.length}`);
    console.log(`Unmapped genres (mapped to "other"): ${unmapped.length}`);
    
    if (mismatches.length > 0) {
      console.log('\n=== MISMATCHED GENRES ===');
      mismatches.forEach(m => {
        console.log(`${m.genre} (${m.count} songs): ${m.current_parent} -> should be -> ${m.expected_parent}`);
      });
    }
    
    if (unmapped.length > 0) {
      console.log('\n=== UNMAPPED GENRES (need parent assignment) ===');
      unmapped.forEach(u => {
        console.log(`${u.genre} (${u.count} songs) - needs parent genre assignment`);
      });
    }
    
    // Show parent genre counts
    console.log('\n=== PARENT GENRE COUNTS ===');
    const parentCounts = await pool.query(`
      SELECT parent_genre, COUNT(*) as count 
      FROM songs 
      WHERE parent_genre IS NOT NULL 
      GROUP BY parent_genre 
      ORDER BY count DESC
    `);
    
    parentCounts.rows.forEach(row => {
      console.log(`${row.parent_genre}: ${row.count} songs`);
    });
    
    // Show available parent genres from mapping
    console.log('\n=== AVAILABLE PARENT GENRES IN MAPPING ===');
    Object.keys(GENRE_HIERARCHY).forEach(parent => {
      const subgenres = GENRE_HIERARCHY[parent];
      console.log(`${parent}: [${subgenres.join(', ')}]`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkGenreMappings();