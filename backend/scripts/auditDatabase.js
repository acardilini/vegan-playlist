const pool = require('../database/db');

async function auditDatabase() {
  console.log('🔍 Starting Database Completion Audit...\n');
  
  try {
    // Get total song count
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM songs');
    const totalSongs = parseInt(totalResult.rows[0].total);
    console.log(`📊 Total songs in database: ${totalSongs}\n`);

    // Basic metadata completion rates
    console.log('📋 BASIC METADATA COMPLETION:');
    console.log('=' .repeat(50));
    
    const metadataFields = [
      { field: 'title', label: 'Song Title' },
      { field: 'duration_ms', label: 'Duration' },
      { field: 'popularity', label: 'Popularity Score' },
      { field: 'explicit', label: 'Explicit Flag' },
      { field: 'album_id', label: 'Album Info' },
      { field: 'track_number', label: 'Track Number' },
      { field: 'genre', label: 'Genre' },
      { field: 'parent_genre', label: 'Parent Genre' }
    ];

    for (const { field, label } of metadataFields) {
      let query;
      if (field === 'title' || field === 'genre' || field === 'parent_genre') {
        // String fields
        query = `
          SELECT COUNT(*) as completed 
          FROM songs 
          WHERE ${field} IS NOT NULL 
          AND TRIM(${field}) != ''
        `;
      } else if (field === 'explicit') {
        // Boolean field
        query = `
          SELECT COUNT(*) as completed 
          FROM songs 
          WHERE ${field} IS NOT NULL
        `;
      } else {
        // Numeric fields
        query = `
          SELECT COUNT(*) as completed 
          FROM songs 
          WHERE ${field} IS NOT NULL 
          AND ${field} != 0
        `;
      }
      
      const completedResult = await pool.query(query);
      const completed = parseInt(completedResult.rows[0].completed);
      const percentage = ((completed / totalSongs) * 100).toFixed(1);
      console.log(`${label.padEnd(20)}: ${completed.toString().padStart(4)}/${totalSongs} (${percentage}%)`);
    }

    // YouTube video coverage
    console.log('\n🎥 YOUTUBE VIDEO COVERAGE:');
    console.log('=' .repeat(50));
    
    const youtubeResult = await pool.query(`
      SELECT COUNT(DISTINCT s.id) as songs_with_videos
      FROM songs s
      INNER JOIN youtube_videos yv ON s.id = yv.song_id
    `);
    const songsWithVideos = parseInt(youtubeResult.rows[0].songs_with_videos);
    const songsWithoutVideos = totalSongs - songsWithVideos;
    const youtubePercentage = ((songsWithVideos / totalSongs) * 100).toFixed(1);
    
    console.log(`Songs with videos     : ${songsWithVideos.toString().padStart(4)}/${totalSongs} (${youtubePercentage}%)`);
    console.log(`Songs needing videos  : ${songsWithoutVideos.toString().padStart(4)}/${totalSongs} (${(100 - parseFloat(youtubePercentage)).toFixed(1)}%)`);

    // Audio features completion
    console.log('\n🎵 AUDIO FEATURES COMPLETION:');
    console.log('=' .repeat(50));
    
    const audioFields = [
      { field: 'energy', label: 'Energy' },
      { field: 'danceability', label: 'Danceability' },
      { field: 'valence', label: 'Valence' },
      { field: 'acousticness', label: 'Acousticness' },
      { field: 'instrumentalness', label: 'Instrumentalness' },
      { field: 'speechiness', label: 'Speechiness' },
      { field: 'tempo', label: 'Tempo' },
      { field: 'loudness', label: 'Loudness' }
    ];

    for (const { field, label } of audioFields) {
      const completedResult = await pool.query(`
        SELECT COUNT(*) as completed 
        FROM songs 
        WHERE ${field} IS NOT NULL
      `);
      const completed = parseInt(completedResult.rows[0].completed);
      const percentage = ((completed / totalSongs) * 100).toFixed(1);
      console.log(`${label.padEnd(20)}: ${completed.toString().padStart(4)}/${totalSongs} (${percentage}%)`);
    }

    // Review and rating completion
    console.log('\n📝 REVIEW & CONTENT COMPLETION:');
    console.log('=' .repeat(50));
    
    const contentFields = [
      { field: 'your_review', label: 'Your Review' },
      { field: 'rating', label: 'Rating' },
      { field: 'lyrics', label: 'Lyrics' },
      { field: 'notes', label: 'Internal Notes' },
      { field: 'inclusion_notes', label: 'Inclusion Notes' }
    ];

    for (const { field, label } of contentFields) {
      let query;
      if (field === 'lyrics') {
        // Lyrics is only in manual_songs table
        query = `
          SELECT COUNT(*) as completed 
          FROM songs s
          LEFT JOIN manual_songs ms ON s.manual_song_id = ms.id
          WHERE ms.${field} IS NOT NULL AND TRIM(ms.${field}) != ''
        `;
      } else if (field === 'notes') {
        // Notes is only in manual_songs table  
        query = `
          SELECT COUNT(*) as completed 
          FROM songs s
          LEFT JOIN manual_songs ms ON s.manual_song_id = ms.id
          WHERE ms.${field} IS NOT NULL AND TRIM(ms.${field}) != ''
        `;
      } else if (field === 'rating') {
        // Rating is an integer
        query = `
          SELECT COUNT(*) as completed 
          FROM songs 
          WHERE ${field} IS NOT NULL AND ${field} > 0
        `;
      } else {
        // These are text fields in songs table
        query = `
          SELECT COUNT(*) as completed 
          FROM songs 
          WHERE ${field} IS NOT NULL AND TRIM(${field}) != ''
        `;
      }
      
      const completedResult = await pool.query(query);
      const completed = parseInt(completedResult.rows[0].completed);
      const percentage = ((completed / totalSongs) * 100).toFixed(1);
      console.log(`${label.padEnd(20)}: ${completed.toString().padStart(4)}/${totalSongs} (${percentage}%)`);
    }

    // Source breakdown
    console.log('\n📊 SONGS BY SOURCE:');
    console.log('=' .repeat(50));
    
    const sourceResult = await pool.query(`
      SELECT data_source, COUNT(*) as count
      FROM songs 
      GROUP BY data_source
      ORDER BY count DESC
    `);
    
    for (const row of sourceResult.rows) {
      const percentage = ((row.count / totalSongs) * 100).toFixed(1);
      console.log(`${row.data_source.padEnd(20)}: ${row.count.toString().padStart(4)}/${totalSongs} (${percentage}%)`);
    }

    // Priority recommendations
    console.log('\n🎯 PRIORITY RECOMMENDATIONS:');
    console.log('=' .repeat(50));
    
    console.log(`1. Songs needing YouTube videos: ${songsWithoutVideos} songs`);
    console.log(`2. Songs missing basic metadata varies by field`);

    // Most incomplete songs
    console.log('\n🚨 MOST INCOMPLETE SONGS:');
    console.log('=' .repeat(50));
    
    const incompleteResult = await pool.query(`
      SELECT 
        s.id,
        s.title,
        string_agg(a.name, ', ') as artists,
        s.data_source,
        CASE WHEN yv.song_id IS NOT NULL THEN 1 ELSE 0 END as has_video,
        CASE WHEN s.duration_ms IS NOT NULL THEN 1 ELSE 0 END as has_duration,
        CASE WHEN s.genre IS NOT NULL THEN 1 ELSE 0 END as has_genre
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.song_id
      LEFT JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN (SELECT DISTINCT song_id FROM youtube_videos) yv ON s.id = yv.song_id
      GROUP BY s.id, s.title, s.data_source, s.duration_ms, s.genre, yv.song_id
      ORDER BY (CASE WHEN yv.song_id IS NOT NULL THEN 1 ELSE 0 END +
                CASE WHEN s.duration_ms IS NOT NULL THEN 1 ELSE 0 END +
                CASE WHEN s.genre IS NOT NULL THEN 1 ELSE 0 END) ASC
      LIMIT 10
    `);

    for (const song of incompleteResult.rows) {
      const completionScore = song.has_video + song.has_duration + song.has_genre;
      const missing = [];
      if (!song.has_video) missing.push('Video');
      if (!song.has_duration) missing.push('Duration');
      if (!song.has_genre) missing.push('Genre');

      console.log(`${song.title} by ${song.artists}`);
      console.log(`   Missing: ${missing.join(', ')} (Score: ${completionScore}/3)`);
    }

    console.log('\n✅ Database audit complete!\n');
    
  } catch (error) {
    console.error('❌ Error during database audit:', error);
  } finally {
    await pool.end();
  }
}

// Run the audit
auditDatabase();