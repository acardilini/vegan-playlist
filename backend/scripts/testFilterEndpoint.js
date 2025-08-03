const axios = require('axios');

async function testFilterEndpoint() {
  try {
    console.log('Testing fixed filter-options endpoint...');
    
    const response = await axios.get('http://localhost:5000/api/spotify/filter-options');
    const data = response.data;
    
    if (response.status !== 200) {
      console.log('HTTP Status:', response.status);
      console.log('Response:', data);
      return;
    }
    
    console.log('Response keys:', Object.keys(data));
    console.log('Parent genres type:', typeof data.parent_genres);
    console.log('Parent genres:', data.parent_genres);
    
    if (data.parent_genres && Array.isArray(data.parent_genres)) {
      console.log('\n=== FIXED PARENT GENRE COUNTS ===');
      data.parent_genres.forEach(genre => {
        console.log(`${genre.value}: ${genre.count} songs`);
      });
    } else {
      console.log('Parent genres not found or not an array');
      return;
    }
    
    console.log('\n=== SPECIFIC PUNK GENRES ===');
    const punkGenres = data.subgenres.filter(g => 
      ['punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk'].includes(g.value)
    );
    
    let totalPunkSubgenres = 0;
    punkGenres.forEach(genre => {
      console.log(`  ${genre.value}: ${genre.count} songs`);
      totalPunkSubgenres += genre.count;
    });
    
    const punkParentCount = data.parent_genres.find(g => g.value === 'punk')?.count || 0;
    
    console.log(`\nTotal punk subgenres: ${totalPunkSubgenres}`);
    console.log(`Punk parent genre: ${punkParentCount}`);
    console.log(`Fixed: ${punkParentCount === totalPunkSubgenres ? '✅ YES' : '❌ NO'}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testFilterEndpoint();