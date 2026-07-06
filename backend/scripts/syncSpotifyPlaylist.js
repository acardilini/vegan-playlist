const pool = require('../database/db'); // Use existing database connection
const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

const PLAYLIST_ID = '5hVygGomw9zax38quC6mhi'; // Your vegan playlist ID

async function syncSpotifyPlaylist() {
  try {
    console.log('🎵 Starting Spotify playlist sync...');
    
    // Get Spotify access token
    console.log('🔐 Getting Spotify access token...');
    const authResult = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(authResult.body['access_token']);
    
    // Fetch all tracks from Spotify playlist
    console.log(`📻 Fetching tracks from Spotify playlist: ${PLAYLIST_ID}`);
    let allPlaylistTracks = [];
    let offset = 0;
    const limit = 100;
    
    while (true) {
      const playlistResult = await spotifyApi.getPlaylistTracks(PLAYLIST_ID, {
        offset,
        limit,
        fields: 'items(track(id,name,artists,album,duration_ms,popularity,preview_url,external_urls.spotify,explicit,available_markets,track_number,disc_number)),next'
      });
      
      const tracks = playlistResult.body.items
        .filter(item => item.track && item.track.id) // Filter out null tracks
        .map(item => ({
          spotify_id: item.track.id,
          title: item.track.name,
          artists: item.track.artists.map(artist => artist.name),
          album_name: item.track.album.name,
          duration_ms: item.track.duration_ms,
          popularity: item.track.popularity,
          preview_url: item.track.preview_url,
          spotify_url: item.track.external_urls.spotify,
          explicit: item.track.explicit,
          available_markets: item.track.available_markets,
          track_number: item.track.track_number,
          disc_number: item.track.disc_number
        }));
      
      allPlaylistTracks.push(...tracks);
      
      if (!playlistResult.body.next) break;
      offset += limit;
    }
    
    console.log(`📊 Found ${allPlaylistTracks.length} tracks in Spotify playlist`);
    
    // Get all songs currently in database
    console.log('💾 Fetching songs from database...');
    const dbSongsResult = await pool.query(`
      SELECT 
        s.id, 
        s.spotify_id, 
        s.title, 
        string_agg(a.name, ', ') as artists
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      WHERE s.data_source = 'Spotify' OR s.data_source IS NULL
      GROUP BY s.id, s.spotify_id, s.title
    `);
    
    const dbSongs = dbSongsResult.rows;
    const dbSpotifyIds = new Set(dbSongs.map(song => song.spotify_id));
    const playlistSpotifyIds = new Set(allPlaylistTracks.map(track => track.spotify_id));
    
    console.log(`📊 Found ${dbSongs.length} songs in database`);
    
    // Find songs to add (in playlist but not in database)
    const songsToAdd = allPlaylistTracks.filter(track => !dbSpotifyIds.has(track.spotify_id));
    
    // Find songs to remove (in database but not in playlist)
    const songsToRemove = dbSongs.filter(song => !playlistSpotifyIds.has(song.spotify_id));
    
    console.log(`➕ Songs to add: ${songsToAdd.length}`);
    console.log(`➖ Songs to flag for removal: ${songsToRemove.length}`);
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let addedCount = 0;
      let flaggedCount = 0;
      
      // Add new songs to database
      console.log('➕ Adding new songs...');
      for (const track of songsToAdd) {
        try {
          // Create or find artists
          const artistIds = [];
          for (const artistName of track.artists) {
            let artistResult = await client.query(
              'SELECT id FROM artists WHERE LOWER(name) = LOWER($1)',
              [artistName]
            );
            
            if (artistResult.rows.length === 0) {
              artistResult = await client.query(`
                INSERT INTO artists (name, data_source, created_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                RETURNING id
              `, [artistName, 'Spotify']);
            }
            
            artistIds.push(artistResult.rows[0].id);
          }
          
          // Create or find album
          let albumId = null;
          if (track.album_name) {
            let albumResult = await client.query(
              'SELECT id FROM albums WHERE LOWER(name) = LOWER($1)',
              [track.album_name]
            );
            
            if (albumResult.rows.length === 0) {
              albumResult = await client.query(`
                INSERT INTO albums (name, data_source, created_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                RETURNING id
              `, [track.album_name, 'Spotify']);
            }
            
            albumId = albumResult.rows[0].id;
          }
          
          // Insert song
          const songResult = await client.query(`
            INSERT INTO songs (
              spotify_id, title, album_id, duration_ms, popularity, spotify_url, 
              preview_url, explicit, available_markets, track_number, disc_number,
              data_source, created_at, date_added, playlist_added_at, playlist_added_by,
              removed_from_playlist
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $13, false)
            RETURNING id
          `, [
            track.spotify_id, track.title, albumId, track.duration_ms, track.popularity,
            track.spotify_url, track.preview_url, track.explicit, track.available_markets,
            track.track_number, track.disc_number, 'spotify', 'sync-script'
          ]);
          
          const songId = songResult.rows[0].id;
          
          // Link artists to song
          for (const artistId of artistIds) {
            await client.query(
              'INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [songId, artistId]
            );
          }
          
          addedCount++;
          console.log(`✅ Added: ${track.title} by ${track.artists.join(', ')}`);
          
        } catch (songError) {
          console.error(`❌ Error adding song ${track.title}:`, songError);
        }
      }
      
      // Flag removed songs (don't delete them, just mark as removed)
      console.log('🏷️  Flagging removed songs...');
      for (const song of songsToRemove) {
        try {
          await client.query(`
            UPDATE songs 
            SET 
              removed_from_playlist = true,
              removed_from_playlist_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE spotify_id = $1
          `, [song.spotify_id]);
          
          flaggedCount++;
          console.log(`🏷️  Flagged as removed: ${song.title} by ${song.artists}`);
          
        } catch (flagError) {
          console.error(`❌ Error flagging song ${song.title}:`, flagError);
        }
      }
      
      await client.query('COMMIT');
      
      console.log('\n🎉 SYNC COMPLETED SUCCESSFULLY!');
      console.log('================================');
      console.log(`📊 Playlist tracks: ${allPlaylistTracks.length}`);
      console.log(`💾 Database songs (before): ${dbSongs.length}`);
      console.log(`➕ New songs added: ${addedCount}`);
      console.log(`🏷️  Songs flagged as removed: ${flaggedCount}`);
      console.log(`💾 Database songs (after): ${dbSongs.length + addedCount}`);
      console.log('================================');
      
      if (flaggedCount > 0) {
        console.log('\n⚠️  NOTE: Songs flagged as removed are still in your database.');
        console.log('   Use the Admin > Cleanup > "Removed from Playlist" tab to review and delete them.');
      }
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error syncing Spotify playlist:', error);
    throw error;
  } finally {
    // Don't end the pool here - let the process exit naturally
  }
}

// Run the sync
if (require.main === module) {
  syncSpotifyPlaylist()
    .then(() => {
      console.log('✅ Playlist sync completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Playlist sync failed:', error);
      process.exit(1);
    });
}

module.exports = { syncSpotifyPlaylist };