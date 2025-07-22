const pool = require('../database/db');
const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Function to parse Spotify date formats
function parseSpotifyDate(dateString) {
  if (!dateString) return null;
  
  // If it's just a year (like "1988"), make it January 1st
  if (/^\d{4}$/.test(dateString)) {
    return `${dateString}-01-01`;
  }
  
  // If it's year-month (like "1988-06"), add day
  if (/^\d{4}-\d{2}$/.test(dateString)) {
    return `${dateString}-01`;
  }
  
  // If it's already full date (like "1988-06-15"), return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  // For any other format, try to extract just the year
  const yearMatch = dateString.match(/(\d{4})/);
  if (yearMatch) {
    return `${yearMatch[1]}-01-01`;
  }
  
  return null; // If we can't parse it at all
}



async function getAccessToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    return data.body['access_token'];
  } catch (error) {
    console.error('Error getting access token:', error);
    throw error;
  }
}

async function importPlaylistData(playlistId) {
  try {
    console.log('🎵 Starting import of playlist:', playlistId);
    
    await getAccessToken();
    
    // Get playlist info
    const playlistData = await spotifyApi.getPlaylist(playlistId);
    console.log(`📋 Playlist: "${playlistData.body.name}" - ${playlistData.body.tracks.total} tracks`);
    
    // Get all tracks
    let allTracks = [];
    let offset = 0;
    const limit = 50;
    
    while (true) {
      console.log(`📥 Fetching tracks ${offset + 1}-${offset + limit}...`);
      
      const tracksData = await spotifyApi.getPlaylistTracks(playlistId, {
        offset: offset,
        limit: limit,
        fields: 'items(track(id,name,artists,album,duration_ms,popularity,external_urls,preview_url,explicit)),next'
      });
      
      allTracks = allTracks.concat(tracksData.body.items);
      
      if (!tracksData.body.next) break;
      offset += limit;
    }
    
    console.log(`✅ Fetched ${allTracks.length} tracks total`);
    
    // Import data with detailed error tracking
    let importedSongs = 0;
    let importedArtists = 0;
    let importedAlbums = 0;
    let skippedTracks = 0;
    let errorDetails = [];
    
    for (let i = 0; i < allTracks.length; i++) {
      const item = allTracks[i];
      const track = item.track;
      
      if (!track || !track.id) {
        skippedTracks++;
        errorDetails.push({
          index: i,
          error: 'No track data or ID',
          trackData: track
        });
        continue;
      }
      
      try {
        // Check for missing required data
        if (!track.album || !track.album.id) {
          throw new Error('Missing album data');
        }
        
        if (!track.artists || track.artists.length === 0) {
          throw new Error('Missing artist data');
        }
        
        // Import album
        const albumResult = await pool.query(
        `INSERT INTO albums (spotify_id, name, release_date, images, total_tracks, spotify_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (spotify_id) DO NOTHING
        RETURNING id`,
        [
            track.album.id,
            track.album.name || 'Unknown Album',
            parseSpotifyDate(track.album.release_date), // Use the parsing function here
            JSON.stringify(track.album.images || []),
            track.album.total_tracks || 0,
            track.album.external_urls?.spotify
        ]
        );
        
        if (albumResult.rows.length > 0) importedAlbums++;
        
        // Get album ID
        const albumIdResult = await pool.query(
          'SELECT id FROM albums WHERE spotify_id = $1',
          [track.album.id]
        );
        const albumId = albumIdResult.rows[0].id;
        
        // Import song
        const songResult = await pool.query(
          `INSERT INTO songs (spotify_id, title, album_id, duration_ms, popularity, spotify_url, preview_url, explicit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (spotify_id) DO NOTHING
           RETURNING id`,
          [
            track.id,
            track.name || 'Unknown Title',
            albumId,
            track.duration_ms || 0,
            track.popularity || 0,
            track.external_urls?.spotify,
            track.preview_url,
            track.explicit || false
          ]
        );
        
        if (songResult.rows.length > 0) importedSongs++;
        
        // Get song ID
        const songIdResult = await pool.query(
          'SELECT id FROM songs WHERE spotify_id = $1',
          [track.id]
        );
        const songId = songIdResult.rows[0].id;
        
        // Import artists and relationships
        for (const artist of track.artists) {
          if (!artist || !artist.id) {
            console.warn(`⚠️ Skipping invalid artist for track "${track.name}"`);
            continue;
          }
          
          // Import artist
          const artistResult = await pool.query(
            `INSERT INTO artists (spotify_id, name, spotify_url)
             VALUES ($1, $2, $3)
             ON CONFLICT (spotify_id) DO NOTHING
             RETURNING id`,
            [
              artist.id,
              artist.name || 'Unknown Artist',
              artist.external_urls?.spotify
            ]
          );
          
          if (artistResult.rows.length > 0) importedArtists++;
          
          // Get artist ID
          const artistIdResult = await pool.query(
            'SELECT id FROM artists WHERE spotify_id = $1',
            [artist.id]
          );
          const artistId = artistIdResult.rows[0].id;
          
          // Create song-artist relationship
          await pool.query(
            `INSERT INTO song_artists (song_id, artist_id)
             VALUES ($1, $2)
             ON CONFLICT (song_id, artist_id) DO NOTHING`,
            [songId, artistId]
          );
        }
        
      } catch (error) {
        console.error(`❌ Error importing track ${i + 1}: "${track?.name || 'Unknown'}"`);
        console.error(`   Error: ${error.message}`);
        errorDetails.push({
          index: i,
          title: track?.name,
          artist: track?.artists?.[0]?.name,
          error: error.message,
          trackId: track?.id
        });
      }
    }
    
    console.log('🎉 Import completed!');
    console.log(`📊 Results:`);
    console.log(`   Songs: ${importedSongs} imported`);
    console.log(`   Artists: ${importedArtists} imported`);
    console.log(`   Albums: ${importedAlbums} imported`);
    console.log(`   Skipped/Failed: ${skippedTracks + errorDetails.length} tracks`);
    
    if (errorDetails.length > 0) {
      console.log('\n❌ Failed tracks:');
      errorDetails.forEach(error => {
        console.log(`   ${error.index + 1}: "${error.title || 'Unknown'}" by ${error.artist || 'Unknown'} - ${error.error}`);
      });
    }
    
    // Show some stats
    const songsCount = await pool.query('SELECT COUNT(*) FROM songs');
    const artistsCount = await pool.query('SELECT COUNT(*) FROM artists');
    const albumsCount = await pool.query('SELECT COUNT(*) FROM albums');
    
    console.log(`\n🗄️ Database totals:`);
    console.log(`   Total songs: ${songsCount.rows[0].count}`);
    console.log(`   Total artists: ${artistsCount.rows[0].count}`);
    console.log(`   Total albums: ${albumsCount.rows[0].count}`);
    
  } catch (error) {
    console.error('💥 Import failed:', error);
  } finally {
    pool.end();
  }
}

// Run the import
const playlistId = '5hVygGomw9zax38quC6mhi';
importPlaylistData(playlistId);