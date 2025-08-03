const pool = require('../database/db');
const fs = require('fs');
const path = require('path');

async function exportAllSongsData() {
  try {
    console.log('Exporting all songs with category data...');
    
    // Get all songs with comprehensive data
    const query = `
      SELECT 
        s.id,
        s.title,
        s.spotify_id,
        s.spotify_url,
        s.preview_url,
        s.duration_ms,
        s.popularity,
        s.explicit,
        s.data_source,
        s.date_added,
        s.genre,
        s.parent_genre,
        s.vegan_focus,
        s.animal_category,
        s.advocacy_style,
        s.advocacy_issues,
        s.lyrical_explicitness,
        s.energy,
        s.danceability,
        s.valence,
        s.tempo,
        s.acousticness,
        s.instrumentalness,
        s.liveness,
        s.speechiness,
        s.loudness,
        s.key,
        s.mode,
        s.time_signature,
        -- Album data
        al.name as album_name,
        al.release_date,
        al.total_tracks,
        al.album_type,
        -- Artists (aggregated)
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT a.spotify_id) as artist_spotify_ids,
        -- Artist genres (for songs without migrated genres) 
        ARRAY_AGG(DISTINCT genre_elem) FILTER (WHERE genre_elem IS NOT NULL) as artist_genres
      FROM songs s
      LEFT JOIN albums al ON s.album_id = al.id
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS genre_elem ON true
      GROUP BY s.id, al.id
      ORDER BY s.title, s.id
    `;
    
    const result = await pool.query(query);
    console.log(`Found ${result.rows.length} songs to export`);
    
    // Convert to CSV format
    const headers = [
      'ID', 'Title', 'Artists', 'Album', 'Release Date', 'Duration (ms)', 'Popularity',
      'Genre', 'Parent Genre', 'Artist Genres',
      'Vegan Focus', 'Animal Category', 'Advocacy Style', 'Advocacy Issues', 'Lyrical Explicitness',
      'Energy', 'Danceability', 'Valence', 'Tempo', 'Acousticness', 'Instrumentalness', 
      'Liveness', 'Speechiness', 'Loudness', 'Key', 'Mode', 'Time Signature',
      'Explicit', 'Data Source', 'Date Added', 'Spotify ID', 'Spotify URL', 'Preview URL',
      'Album Type', 'Total Tracks', 'Artist Spotify IDs'
    ];
    
    // Helper function to format array values for CSV
    const formatArrayForCSV = (arr) => {
      if (!arr || arr.length === 0) return '';
      return `"${arr.join('; ')}"`;
    };
    
    // Helper function to escape and quote CSV values
    const formatValueForCSV = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };
    
    // Create CSV content
    let csvContent = headers.join(',') + '\n';
    
    result.rows.forEach(song => {
      const row = [
        song.id,
        formatValueForCSV(song.title),
        formatArrayForCSV(song.artists),
        formatValueForCSV(song.album_name),
        song.release_date || '',
        song.duration_ms || '',
        song.popularity || '',
        song.genre || '',
        song.parent_genre || '',
        formatArrayForCSV(song.artist_genres),
        formatArrayForCSV(song.vegan_focus),
        formatArrayForCSV(song.animal_category),
        formatArrayForCSV(song.advocacy_style),
        formatArrayForCSV(song.advocacy_issues),
        formatArrayForCSV(song.lyrical_explicitness),
        song.energy || '',
        song.danceability || '',
        song.valence || '',
        song.tempo || '',
        song.acousticness || '',
        song.instrumentalness || '',
        song.liveness || '',
        song.speechiness || '',
        song.loudness || '',
        song.key || '',
        song.mode || '',
        song.time_signature || '',
        song.explicit || '',
        song.data_source || '',
        song.date_added || '', 
        song.spotify_id || '',
        song.spotify_url || '',
        song.preview_url || '',
        song.album_type || '',
        song.total_tracks || '',
        formatArrayForCSV(song.artist_spotify_ids)
      ];
      
      csvContent += row.join(',') + '\n';
    });
    
    // Write to file
    const outputPath = path.join(__dirname, '..', '..', 'vegan_playlist_complete_data.csv');
    fs.writeFileSync(outputPath, csvContent, 'utf8');
    
    console.log(`\n✅ Export completed successfully!`);
    console.log(`📄 File saved to: ${outputPath}`);
    console.log(`📊 Total songs exported: ${result.rows.length}`);
    
    // Show some statistics
    const stats = {
      with_genre: result.rows.filter(s => s.genre).length,
      with_vegan_focus: result.rows.filter(s => s.vegan_focus && s.vegan_focus.length > 0).length,
      with_audio_features: result.rows.filter(s => s.energy !== null).length,
      spotify_songs: result.rows.filter(s => s.data_source === 'spotify').length,
      manual_songs: result.rows.filter(s => s.data_source === 'manual').length
    };
    
    console.log(`\n📈 Export Statistics:`);
    console.log(`Songs with genre: ${stats.with_genre}`);
    console.log(`Songs with vegan focus: ${stats.with_vegan_focus}`);
    console.log(`Songs with audio features: ${stats.with_audio_features}`);
    console.log(`Spotify imported: ${stats.spotify_songs}`);
    console.log(`Manually added: ${stats.manual_songs}`);
    
    await pool.end();
  } catch (error) {
    console.error('Export error:', error);
    process.exit(1);
  }
}

exportAllSongsData();