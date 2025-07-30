const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

async function testAudioFeatures() {
  try {
    console.log('🔧 Testing Spotify Audio Features API...');
    
    // Get access token
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('✅ Got Spotify access token');
    
    // Test with a few known track IDs (you can get these from your database)
    const testTrackIds = [
      '7HLSisjSTcKyxcrQ1nE2Kr', // "Get Your Hands Off of Them"
      '6iALjs1wwcpVzAPFBO0SWU', // "Tofu Spaghetti" 
      '4aHsGEtINafCee3MkCZ9PE'  // "Breakfast of Champions"
    ];
    
    console.log(`🎵 Testing with ${testTrackIds.length} tracks...`);
    
    const audioFeatures = await spotifyApi.getAudioFeaturesForTracks(testTrackIds);
    
    console.log('🎉 Audio Features Response:');
    audioFeatures.body.audio_features.forEach((feature, index) => {
      if (feature) {
        console.log(`\n${index + 1}. Track ID: ${testTrackIds[index]}`);
        console.log(`   Energy: ${feature.energy}`);
        console.log(`   Danceability: ${feature.danceability}`);
        console.log(`   Valence: ${feature.valence}`);
        console.log(`   Tempo: ${feature.tempo}`);
        console.log(`   Key: ${feature.key} | Mode: ${feature.mode}`);
      } else {
        console.log(`\n${index + 1}. Track ID: ${testTrackIds[index]} - NO FEATURES AVAILABLE`);
      }
    });
    
  } catch (error) {
    console.error('❌ Audio Features Test Failed:', error.message);
    if (error.body) {
      console.error('Error details:', error.body);
    }
  }
}

testAudioFeatures();