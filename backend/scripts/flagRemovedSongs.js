const pool = require('../database/db');
const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

const PLAYLIST_ID = '5hVygGomw9zax38quC6mhi'; // Your vegan playlist ID

async function flagRemovedSongs() {
  try {
    console.log('🔍 Checking for songs removed from Spotify playlist...');
    
    // Get Spotify access token
    console.log('🔐 Getting Spotify access token...');
    const authResult = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(authResult.body['access_token']);
    
    // Fetch current playlist tracks
    console.log(`📻 Fetching current tracks from playlist: ${PLAYLIST_ID}`);
    let currentPlaylistTracks = [];
    let offset = 0;
    const limit = 100;
    
    while (true) {
      const playlistResult = await spotifyApi.getPlaylistTracks(PLAYLIST_ID, {
        offset,
        limit,
        fields: 'items(track(id)),next'
      });
      
      const tracks = playlistResult.body.items
        .filter(item => item.track && item.track.id)
        .map(item => item.track.id);
      
      currentPlaylistTracks.push(...tracks);
      
      if (!playlistResult.body.next) break;
      offset += limit;
    }
    
    console.log(`📊 Found ${currentPlaylistTracks.length} tracks in current playlist`);
    
    // Get all database songs
    console.log('💾 Fetching songs from database...');
    const dbSongsResult = await pool.query(`
      SELECT id, spotify_id, title, removed_from_playlist
      FROM songs 
      WHERE data_source = 'spotify'
      ORDER BY created_at DESC
    `);
    
    const dbSongs = dbSongsResult.rows;
    const currentPlaylistIds = new Set(currentPlaylistTracks);
    
    console.log(`💾 Found ${dbSongs.length} songs in database`);
    
    // Find songs in database that are NOT in current playlist and not already flagged
    const songsToFlag = dbSongs.filter(song => 
      !currentPlaylistIds.has(song.spotify_id) && !song.removed_from_playlist
    );
    
    console.log(`🏷️  Songs to flag as removed: ${songsToFlag.length}`);
    
    if (songsToFlag.length === 0) {
      console.log('✅ No new songs to flag - database is in sync with playlist');
      return;
    }
    
    // Flag songs as removed
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let flaggedCount = 0;
      
      for (const song of songsToFlag) {
        try {
          await client.query(`
            UPDATE songs 
            SET 
              removed_from_playlist = true,
              removed_from_playlist_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [song.id]);
          
          flaggedCount++;
          console.log(`🏷️  Flagged: ${song.title}`);
          
        } catch (flagError) {
          console.error(`❌ Error flagging song ${song.title}:`, flagError.message);
        }
      }
      
      await client.query('COMMIT');
      
      console.log('\n🎉 FLAGGING COMPLETED SUCCESSFULLY!');
      console.log('==================================');
      console.log(`📊 Current playlist: ${currentPlaylistTracks.length} tracks`);
      console.log(`💾 Database songs: ${dbSongs.length}`);
      console.log(`🏷️  Newly flagged as removed: ${flaggedCount}`);
      console.log('==================================');
      console.log('\n✅ Check Admin > Cleanup > "Removed from Playlist" to review flagged songs');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error flagging removed songs:', error);
    throw error;
  }
}

// Run the script
if (require.main === module) {
  flagRemovedSongs()
    .then(() => {
      console.log('✅ Song flagging completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Song flagging failed:', error);
      process.exit(1);
    });
}

module.exports = { flagRemovedSongs };