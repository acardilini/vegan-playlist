const pool = require('../database/db');
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
    console.log('🎵 Starting simple Spotify playlist sync...');
    
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
        fields: 'items(track(id,name,artists,album,duration_ms,popularity,preview_url,external_urls.spotify,explicit,track_number,disc_number)),next'
      });
      
      const tracks = playlistResult.body.items
        .filter(item => item.track && item.track.id) // Filter out null tracks
        .map(item => ({
          spotify_id: item.track.id,
          title: item.track.name,
          artists: item.track.artists.map(artist => ({ name: artist.name, spotify_id: artist.id })),
          album_name: item.track.album.name,
          album_spotify_id: item.track.album.id,
          duration_ms: item.track.duration_ms,
          popularity: item.track.popularity,
          preview_url: item.track.preview_url,
          spotify_url: item.track.external_urls.spotify,
          explicit: item.track.explicit,
          track_number: item.track.track_number,
          disc_number: item.track.disc_number
        }));
      
      allPlaylistTracks.push(...tracks);

      if (!playlistResult.body.next) break;
      offset += limit;
    }

    console.log(`📊 Found ${allPlaylistTracks.length} tracks in Spotify playlist`);
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let addedCount = 0;
      
      // Add new songs to database
      console.log('➕ Adding songs to database...');
      for (const track of allPlaylistTracks) {
        try {
          // Create or find artists
          const artistIds = [];
          for (const artist of track.artists) {
            let artistResult = await client.query(
              'SELECT id FROM artists WHERE LOWER(name) = LOWER($1)',
              [artist.name]
            );

            if (artistResult.rows.length === 0) {
              artistResult = await client.query(`
                INSERT INTO artists (name, spotify_id, data_source, created_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (spotify_id) DO NOTHING
                RETURNING id
              `, [artist.name, artist.spotify_id, 'spotify']);

              // If conflict, fetch the existing row
              if (artistResult.rows.length === 0) {
                artistResult = await client.query(
                  'SELECT id FROM artists WHERE spotify_id = $1',
                  [artist.spotify_id]
                );
              }
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
                INSERT INTO albums (name, spotify_id, data_source, created_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (spotify_id) DO NOTHING
                RETURNING id
              `, [track.album_name, track.album_spotify_id, 'spotify']);

              // If conflict, fetch the existing row
              if (albumResult.rows.length === 0) {
                albumResult = await client.query(
                  'SELECT id FROM albums WHERE spotify_id = $1',
                  [track.album_spotify_id]
                );
              }
            }

            albumId = albumResult.rows[0].id;
          }
          
          // Insert song (skip if already exists by spotify_id)
          const songResult = await client.query(`
            INSERT INTO songs (
              spotify_id, title, album_id, duration_ms, popularity,
              spotify_url, preview_url, explicit, track_number, disc_number,
              data_source, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
            ON CONFLICT (spotify_id) DO NOTHING
            RETURNING id
          `, [
            track.spotify_id, track.title, albumId, track.duration_ms, track.popularity,
            track.spotify_url, track.preview_url, track.explicit,
            track.track_number, track.disc_number, 'spotify'
          ]);
          
          // If song already existed, fetch its id
          let songId;
          if (songResult.rows.length > 0) {
            songId = songResult.rows[0].id;
          } else {
            const existing = await client.query('SELECT id FROM songs WHERE spotify_id = $1', [track.spotify_id]);
            songId = existing.rows[0].id;
          }

          // Link artists to song
          for (const artistId of artistIds) {
            await client.query(
              'INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [songId, artistId]
            );
          }
          
          addedCount++;
          if (addedCount % 50 === 0) {
            console.log(`✅ Added ${addedCount} songs so far...`);
          }
          
        } catch (songError) {
          console.error(`❌ Error adding song ${track.title}:`, songError.message);
        }
      }
      
      await client.query('COMMIT');
      
      console.log('\n🎉 SYNC COMPLETED SUCCESSFULLY!');
      console.log('================================');
      console.log(`📊 Playlist tracks: ${allPlaylistTracks.length}`);
      console.log(`➕ Songs added to database: ${addedCount}`);
      console.log('================================');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error syncing Spotify playlist:', error);
    throw error;
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