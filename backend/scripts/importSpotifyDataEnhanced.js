const pool = require('../database/db');
const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Your existing date parser (keeping it as is)
function parseSpotifyDate(dateString) {
  if (!dateString) return null;
  
  if (/^\d{4}$/.test(dateString)) {
    return `${dateString}-01-01`;
  }
  
  if (/^\d{4}-\d{2}$/.test(dateString)) {
    return `${dateString}-01`;
  }
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  const yearMatch = dateString.match(/(\d{4})/);
  if (yearMatch) {
    return `${yearMatch[1]}-01-01`;
  }
  
  return null;
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

// NEW: Get audio features for tracks
async function getAudioFeatures(trackIds) {
  try {
    if (trackIds.length === 0) return {};
    
    // Spotify allows max 100 tracks per request
    const chunks = [];
    for (let i = 0; i < trackIds.length; i += 100) {
      chunks.push(trackIds.slice(i, i + 100));
    }
    
    const allFeatures = {};
    for (const chunk of chunks) {
      const features = await spotifyApi.getAudioFeaturesForTracks(chunk);
      features.body.audio_features.forEach((feature, index) => {
        if (feature) {
          allFeatures[chunk[index]] = feature;
        }
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return allFeatures;
  } catch (error) {
    console.error('Error getting audio features:', error);
    return {};
  }
}

// NEW: Get detailed artist information
async function getDetailedArtistInfo(artistIds) {
  try {
    if (artistIds.length === 0) return {};
    
    // Spotify allows max 50 artists per request
    const chunks = [];
    for (let i = 0; i < artistIds.length; i += 50) {
      chunks.push(artistIds.slice(i, i + 50));
    }
    
    const allArtists = {};
    for (const chunk of chunks) {
      const artists = await spotifyApi.getArtists(chunk);
      artists.body.artists.forEach(artist => {
        allArtists[artist.id] = artist;
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return allArtists;
  } catch (error) {
    console.error('Error getting detailed artist info:', error);
    return {};
  }
}

async function importEnhancedPlaylistData(playlistId) {
  try {
    console.log('🎵 Starting ENHANCED import of playlist:', playlistId);
    
    await getAccessToken();
    
    // Get playlist info
    const playlistData = await spotifyApi.getPlaylist(playlistId);
    console.log(`📋 Playlist: "${playlistData.body.name}" - ${playlistData.body.tracks.total} tracks`);
    
    // Get ALL tracks with pagination - INCLUDING added_at dates
    let allTracks = [];
    let offset = 0;
    const limit = 50;
    
    while (true) {
      console.log(`📥 Fetching tracks ${offset + 1}-${offset + limit}...`);
      
      const tracksData = await spotifyApi.getPlaylistTracks(playlistId, {
        offset: offset,
        limit: limit,
        fields: 'items(added_at,added_by.id,track(id,name,artists,album,duration_ms,popularity,external_urls,preview_url,explicit,track_number,disc_number,is_local,available_markets)),next'
      });
      
      allTracks = allTracks.concat(tracksData.body.items);
      
      if (!tracksData.body.next) break;
      offset += limit;
    }
    
    console.log(`✅ Fetched ${allTracks.length} tracks total`);
    
    // Extract all unique track and artist IDs for batch API calls
    const trackIds = [];
    const artistIds = new Set();
    
    allTracks.forEach(item => {
      if (item.track && item.track.id && !item.track.is_local) {
        trackIds.push(item.track.id);
        item.track.artists.forEach(artist => {
          if (artist.id) artistIds.add(artist.id);
        });
      }
    });
    
    console.log(`🎶 Getting audio features for ${trackIds.length} tracks...`);
    const audioFeatures = await getAudioFeatures(trackIds);
    
    console.log(`👨‍🎤 Getting detailed info for ${artistIds.size} artists...`);
    const detailedArtists = await getDetailedArtistInfo(Array.from(artistIds));
    
    // Now import with all the enhanced data
    let importedSongs = 0;
    let importedArtists = 0;
    let importedAlbums = 0;
    let skippedTracks = 0;
    let errorDetails = [];
    
    for (let i = 0; i < allTracks.length; i++) {
      const item = allTracks[i];
      const track = item.track;
      
      if (!track || !track.id || track.is_local) {
        skippedTracks++;
        continue;
      }
      
      try {
        // Import album with enhanced data
        const albumResult = await pool.query(
            `INSERT INTO albums (spotify_id, name, release_date, images, total_tracks, spotify_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (spotify_id) DO NOTHING
            RETURNING id`,
            [
                track.album.id,
                track.album.name || 'Unknown Album',
                parseSpotifyDate(track.album.release_date),
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
        
        // Get audio features for this track
        const features = audioFeatures[track.id];
        
        // Import song with ENHANCED data including playlist added date
        const songResult = await pool.query(
          `INSERT INTO songs (
            spotify_id, title, album_id, duration_ms, popularity, spotify_url, preview_url, explicit,
            track_number, disc_number, available_markets, 
            playlist_added_at, playlist_added_by,
            energy, danceability, valence, acousticness, instrumentalness, liveness, speechiness, tempo, loudness, key, mode, time_signature
          )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
           ON CONFLICT (spotify_id) DO UPDATE SET
             playlist_added_at = EXCLUDED.playlist_added_at,
             playlist_added_by = EXCLUDED.playlist_added_by,
             energy = EXCLUDED.energy,
             danceability = EXCLUDED.danceability,
             valence = EXCLUDED.valence,
             acousticness = EXCLUDED.acousticness,
             instrumentalness = EXCLUDED.instrumentalness,
             liveness = EXCLUDED.liveness,
             speechiness = EXCLUDED.speechiness,
             tempo = EXCLUDED.tempo,
             loudness = EXCLUDED.loudness,
             key = EXCLUDED.key,
             mode = EXCLUDED.mode,
             time_signature = EXCLUDED.time_signature
           RETURNING id`,
          [
            track.id,
            track.name || 'Unknown Title',
            albumId,
            track.duration_ms || 0,
            track.popularity || 0,
            track.external_urls?.spotify,
            track.preview_url,
            track.explicit || false,
            track.track_number || null,
            track.disc_number || null,
            JSON.stringify(track.available_markets || []),
            item.added_at ? new Date(item.added_at) : null, // PLAYLIST ADD DATE!
            item.added_by?.id || null,
            features?.energy || null,
            features?.danceability || null,
            features?.valence || null,
            features?.acousticness || null,
            features?.instrumentalness || null,
            features?.liveness || null,
            features?.speechiness || null,
            features?.tempo || null,
            features?.loudness || null,
            features?.key || null,
            features?.mode || null,
            features?.time_signature || null
          ]
        );
        
        if (songResult.rows.length > 0) importedSongs++;
        
        // Get song ID
        const songIdResult = await pool.query(
          'SELECT id FROM songs WHERE spotify_id = $1',
          [track.id]
        );
        const songId = songIdResult.rows[0].id;
        
        // Import artists with ENHANCED data
        for (const artist of track.artists) {
          if (!artist || !artist.id) continue;
          
          const detailedArtist = detailedArtists[artist.id] || artist;
          
          const artistResult = await pool.query(
            `INSERT INTO artists (spotify_id, name, spotify_url, genres, images, followers, popularity)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (spotify_id) DO UPDATE SET
               genres = EXCLUDED.genres,
               images = EXCLUDED.images,
               followers = EXCLUDED.followers,
               popularity = EXCLUDED.popularity
             RETURNING id`,
            [
              artist.id,
              artist.name || 'Unknown Artist',
              artist.external_urls?.spotify,
              detailedArtist.genres || [],
              JSON.stringify(detailedArtist.images || []),
              detailedArtist.followers?.total || null,
              detailedArtist.popularity || null
            ]
          );
          
          if (artistResult.rows.length > 0) importedArtists++;
          
          // Get artist ID and create relationship
          const artistIdResult = await pool.query(
            'SELECT id FROM artists WHERE spotify_id = $1',
            [artist.id]
          );
          const artistId = artistIdResult.rows[0].id;
          
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
          error: error.message
        });
      }
    }
    
    console.log('🎉 ENHANCED Import completed!');
    console.log(`📊 Results:`);
    console.log(`   Songs: ${importedSongs} imported/updated`);
    console.log(`   Artists: ${importedArtists} imported/updated`);
    console.log(`   Albums: ${importedAlbums} imported/updated`);
    console.log(`   Skipped: ${skippedTracks} tracks`);
    console.log(`   Errors: ${errorDetails.length} tracks`);
    
    // Show final stats
    const songsCount = await pool.query('SELECT COUNT(*) FROM songs');
    const artistsCount = await pool.query('SELECT COUNT(*) FROM artists');
    const albumsCount = await pool.query('SELECT COUNT(*) FROM albums');
    
    console.log(`\n🗄️ Database totals:`);
    console.log(`   Total songs: ${songsCount.rows[0].count}`);
    console.log(`   Total artists: ${artistsCount.rows[0].count}`);
    console.log(`   Total albums: ${albumsCount.rows[0].count}`);
    
  } catch (error) {
    console.error('💥 Enhanced import failed:', error);
  } finally {
    pool.end();
  }
}

// Run the enhanced import
const playlistId = '5hVygGomw9zax38quC6mhi';
importEnhancedPlaylistData(playlistId);