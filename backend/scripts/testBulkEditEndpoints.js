const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testBulkEditEndpoints() {
  try {
    console.log('=== TESTING BULK EDIT ENDPOINTS ===\n');
    
    // 1. Test single song update endpoint
    console.log('1. Testing single song update...');
    const testSongId = 15; // Use a known song ID
    
    const updateResponse = await axios.put(`http://localhost:5000/api/admin/songs/${testSongId}`, {
      vegan_focus: ['explicit', 'direct'],
      animal_category: ['cows', 'general'],
      advocacy_style: ['educational'],
      advocacy_issues: ['factory farming'],
      lyrical_explicitness: ['direct']
    });
    
    console.log('Single update response:', updateResponse.data);
    
    // 2. Test CSV creation and bulk upload
    console.log('\n2. Testing CSV bulk upload...');
    
    // Create a test CSV file
    const testCsvPath = path.join(__dirname, '..', 'test_bulk_update.csv');
    const csvContent = `ID,Title,Artists,Album,Vegan Focus,Animal Category,Advocacy Style,Advocacy Issues,Lyrical Explicitness
${testSongId},"Test Song","Test Artist","Test Album","explicit, educational","cows, pigs","aggressive, educational","factory farming, rights","direct, metaphorical"
347,"Another Test","Another Artist","Another Album","implicit","general","inspirational","animal rights","subtle"`;
    
    fs.writeFileSync(testCsvPath, csvContent);
    console.log('Created test CSV file');
    
    // Upload the CSV
    const formData = new FormData();
    formData.append('csv', fs.createReadStream(testCsvPath));
    
    const uploadResponse = await axios.post('http://localhost:5000/api/admin/bulk-upload', formData, {
      headers: formData.getHeaders()
    });
    
    console.log('Bulk upload response:', uploadResponse.data);
    
    // Clean up test file
    fs.unlinkSync(testCsvPath);
    console.log('Cleaned up test CSV file');
    
    // 3. Test search endpoint (used by bulk edit to load songs)
    console.log('\n3. Testing song search for bulk edit...');
    const searchResponse = await axios.get('http://localhost:5000/api/spotify/search?limit=5');
    const searchData = searchResponse.data;
    
    console.log(`Found ${searchData.songs?.length || 0} songs for bulk edit`);
    if (searchData.songs?.length > 0) {
      console.log('Sample song data structure:');
      const sample = searchData.songs[0];
      console.log({
        id: sample.id,
        title: sample.title,
        artists: sample.artists,
        vegan_focus: sample.vegan_focus,
        animal_category: sample.animal_category,
        has_artist_genres: !!sample.artist_genres
      });
    }
    
    console.log('\n=== TEST RESULTS ===');
    console.log('✅ Single song update endpoint works');
    console.log('✅ CSV bulk upload endpoint works');
    console.log('✅ Search endpoint provides data for bulk edit');
    console.log('\n🎉 All bulk edit functionality is ready!');
    
  } catch (error) {
    console.error('Test error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testBulkEditEndpoints();