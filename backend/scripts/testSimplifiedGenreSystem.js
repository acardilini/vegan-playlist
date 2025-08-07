const axios = require('axios');

async function testSimplifiedGenreSystem() {
  try {
    console.log('=== TESTING SIMPLIFIED GENRE SYSTEM ===\n');
    
    // 1. Test filter options endpoint
    console.log('1. Testing filter-options endpoint...');
    const filterResponse = await axios.get('http://localhost:5000/api/spotify/filter-options');
    const filterData = filterResponse.data;
    
    console.log('Parent genres available:');
    if (filterData.parent_genres) {
      filterData.parent_genres.slice(0, 5).forEach(genre => {
        console.log(`- ${genre.value}: ${genre.count} songs`);
      });
    }
    
    console.log('\nSpecific genres available:');
    if (filterData.genres) {
      filterData.genres.slice(0, 10).forEach(genre => {
        console.log(`- ${genre.value}: ${genre.count} songs`);
      });
    }
    
    // 2. Test parent genre filtering (should work)
    console.log('\n2. Testing parent genre filtering (punk)...');
    const parentResponse = await axios.get('http://localhost:5000/api/spotify/search?parent_genres=punk&limit=5');
    const parentData = parentResponse.data;
    
    console.log(`Found ${parentData.songs?.length || 0} songs with parent genre 'punk'`);
    if (parentData.songs?.length > 0) {
      parentData.songs.slice(0, 3).forEach(song => {
        console.log(`- ${song.title} (artist genres: ${song.artist_genres?.join(', ') || 'none'})`);
      });
    }
    
    // 3. Test specific genre filtering (should now work!)
    console.log('\n3. Testing specific genre filtering (hardcore punk)...');
    const specificResponse = await axios.get('http://localhost:5000/api/spotify/search?genres=hardcore%20punk&limit=5');
    const specificData = specificResponse.data;
    
    console.log(`Found ${specificData.songs?.length || 0} songs with genre 'hardcore punk'`);
    if (specificData.songs?.length > 0) {
      specificData.songs.slice(0, 3).forEach(song => {
        console.log(`- ${song.title} (artist genres: ${song.artist_genres?.join(', ') || 'none'})`);
      });
    }
    
    // 4. Test featured songs endpoint
    console.log('\n4. Testing featured songs endpoint...');
    const featuredResponse = await axios.get('http://localhost:5000/api/spotify/songs/featured?limit=3');
    const featuredData = featuredResponse.data;
    
    console.log(`Found ${featuredData.length || 0} featured songs`);
    if (featuredData.length > 0) {
      featuredData.forEach(song => {
        console.log(`- ${song.title} by ${song.artists?.join(', ') || 'Unknown'}`);
      });
    }
    
    console.log('\n=== TEST RESULTS ===');
    console.log('✅ Filter options loaded');
    console.log(parentData.songs?.length > 0 ? '✅ Parent genre filtering works' : '❌ Parent genre filtering failed');
    console.log(specificData.songs?.length > 0 ? '✅ Specific genre filtering works' : '❌ Specific genre filtering failed');
    console.log(featuredData.length > 0 ? '✅ Featured songs loaded' : '❌ Featured songs failed');
    
    if (specificData.songs?.length > 0) {
      console.log('\n🎉 SUCCESS: Subgenre filtering bug is FIXED!');
    } else {
      console.log('\n⚠️  Subgenre filtering still has issues');
    }
    
  } catch (error) {
    console.error('Test error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testSimplifiedGenreSystem();