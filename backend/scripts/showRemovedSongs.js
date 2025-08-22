const pool = require('../database/db');
require('dotenv').config();

async function showRemovedSongs() {
  try {
    console.log('🔍 Fetching songs flagged as removed from playlist...\n');
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.removed_from_playlist_at,
        s.popularity,
        s.spotify_url,
        string_agg(a.name, ', ' ORDER BY a.name) as artists,
        al.name as album_name
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN albums al ON s.album_id = al.id
      WHERE s.removed_from_playlist = true
      GROUP BY s.id, s.spotify_id, s.title, s.removed_from_playlist_at, s.popularity, s.spotify_url, al.name
      ORDER BY s.removed_from_playlist_at DESC
    `);
    
    if (result.rows.length === 0) {
      console.log('✅ No songs are currently flagged as removed from playlist.');
      return;
    }
    
    console.log(`📊 Found ${result.rows.length} songs flagged as removed from playlist:\n`);
    
    result.rows.forEach((song, index) => {
      console.log(`${index + 1}. ${song.title} by ${song.artists}`);
      console.log(`   Album: ${song.album_name}`);
      console.log(`   Flagged: ${new Date(song.removed_from_playlist_at).toLocaleDateString()}`);
      console.log(`   Spotify: ${song.spotify_url}`);
      console.log('');
    });
    
    console.log(`\n📋 Summary:`);
    console.log(`   • Total flagged songs: ${result.rows.length}`);
    console.log(`   • These songs are in your database but no longer in your Spotify playlist`);
    console.log(`   • You can delete them through Admin > Cleanup > "Removed from Playlist"`);
    
  } catch (error) {
    console.error('❌ Error fetching removed songs:', error);
  } finally {
    process.exit(0);
  }
}

showRemovedSongs();