const pool = require('../database/db');

// Mood classification based on genres, titles, and other signals
function classifyMood(song, artists) {
  const title = song.title.toLowerCase();
  const artistGenres = artists.flatMap(a => a.genres || []).map(g => g.toLowerCase());
  
  // Aggressive/Intense moods
  if (
    artistGenres.some(g => g.includes('hardcore') || g.includes('metal') || g.includes('punk')) ||
    title.includes('rage') || title.includes('destroy') || title.includes('fight') ||
    title.includes('war') || title.includes('kill') || title.includes('hate')
  ) {
    return {
      mood: 'intense',
      energy_estimate: 0.9,
      danceability_estimate: 0.3,
      valence_estimate: 0.2
    };
  }
  
  // Danceable/Upbeat moods
  if (
    artistGenres.some(g => g.includes('dance') || g.includes('electronic') || g.includes('disco')) ||
    title.includes('dance') || title.includes('party') || title.includes('groove') ||
    title.includes('beat') || title.includes('move')
  ) {
    return {
      mood: 'danceable',
      energy_estimate: 0.8,
      danceability_estimate: 0.9,
      valence_estimate: 0.8
    };
  }
  
  // Chill/Peaceful moods
  if (
    artistGenres.some(g => g.includes('ambient') || g.includes('folk') || g.includes('acoustic')) ||
    title.includes('peace') || title.includes('calm') || title.includes('gentle') ||
    title.includes('quiet') || title.includes('soft') || title.includes('rest')
  ) {
    return {
      mood: 'chill',
      energy_estimate: 0.3,
      danceability_estimate: 0.4,
      valence_estimate: 0.7
    };
  }
  
  // Energetic/Positive moods
  if (
    artistGenres.some(g => g.includes('rock') || g.includes('pop')) ||
    title.includes('power') || title.includes('strong') || title.includes('rise') ||
    title.includes('go') || title.includes('run') || title.includes('free') ||
    song.popularity > 50
  ) {
    return {
      mood: 'energetic',
      energy_estimate: 0.7,
      danceability_estimate: 0.6,
      valence_estimate: 0.7
    };
  }
  
  // Melancholic/Sad moods
  if (
    title.includes('cry') || title.includes('lost') || title.includes('alone') ||
    title.includes('sad') || title.includes('dark') || title.includes('empty') ||
    title.includes('broken')
  ) {
    return {
      mood: 'melancholic',
      energy_estimate: 0.2,
      danceability_estimate: 0.2,
      valence_estimate: 0.2
    };
  }
  
  // Default balanced mood
  return {
    mood: 'balanced',
    energy_estimate: 0.5,
    danceability_estimate: 0.5,
    valence_estimate: 0.5
  };
}

async function addCustomMoodData() {
  try {
    console.log('🎨 Creating custom mood classifications...');
    
    // Get all songs with their artists and genres
    const songs = await pool.query(`
      SELECT 
        s.id,
        s.title,
        s.popularity,
        ARRAY_AGG(jsonb_build_object(
          'name', a.name,
          'genres', a.genres
        )) as artists
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      GROUP BY s.id, s.title, s.popularity
    `);
    
    console.log(`🎵 Processing ${songs.rows.length} songs...`);
    
    let processed = 0;
    const moodCounts = {};
    
    for (const songData of songs.rows) {
      const moodData = classifyMood(songData, songData.artists);
      
      // Update the song with our custom mood data
      await pool.query(`
        UPDATE songs SET 
          energy = $1,
          danceability = $2,
          valence = $3,
          custom_mood = $4
        WHERE id = $5
      `, [
        moodData.energy_estimate,
        moodData.danceability_estimate,
        moodData.valence_estimate,
        moodData.mood,
        songData.id
      ]);
      
      // Count moods
      moodCounts[moodData.mood] = (moodCounts[moodData.mood] || 0) + 1;
      processed++;
      
      if (processed % 50 === 0) {
        console.log(`   Processed ${processed} songs...`);
      }
    }
    
    console.log(`\n🎉 Custom mood classification complete!`);
    console.log(`📊 Mood distribution:`);
    Object.entries(moodCounts).forEach(([mood, count]) => {
      console.log(`   ${mood}: ${count} songs`);
    });
    
    // Show some examples
    const examples = await pool.query(`
      SELECT title, custom_mood, energy, danceability, valence
      FROM songs 
      WHERE custom_mood IS NOT NULL
      ORDER BY custom_mood, energy DESC
      LIMIT 15
    `);
    
    console.log(`\n🎵 Example classifications:`);
    examples.rows.forEach(song => {
      console.log(`   ${song.custom_mood.toUpperCase()}: "${song.title}" (E:${song.energy} D:${song.danceability} V:${song.valence})`);
    });
    
  } catch (error) {
    console.error('💥 Failed to add custom mood data:', error);
  } finally {
    pool.end();
  }
}

addCustomMoodData();