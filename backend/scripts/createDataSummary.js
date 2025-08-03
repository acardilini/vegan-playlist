const pool = require('../database/db');
const fs = require('fs');
const path = require('path');

async function createDataSummary() {
  try {
    console.log('Creating data summary report...');
    
    // Get comprehensive statistics
    const totalSongs = await pool.query('SELECT COUNT(*) as count FROM songs');
    
    const genreStats = await pool.query(`
      SELECT 
        COUNT(*) as total_songs,
        COUNT(genre) as with_genre,
        COUNT(parent_genre) as with_parent_genre
      FROM songs
    `);
    
    const parentGenreBreakdown = await pool.query(`
      SELECT parent_genre, COUNT(*) as count 
      FROM songs 
      WHERE parent_genre IS NOT NULL 
      GROUP BY parent_genre 
      ORDER BY count DESC
    `);
    
    const topSpecificGenres = await pool.query(`
      SELECT genre, COUNT(*) as count 
      FROM songs 
      WHERE genre IS NOT NULL 
      GROUP BY genre 
      ORDER BY count DESC 
      LIMIT 20
    `);
    
    const veganFocusStats = await pool.query(`
      SELECT UNNEST(vegan_focus) as category, COUNT(*) as count
      FROM songs 
      WHERE vegan_focus IS NOT NULL 
      GROUP BY UNNEST(vegan_focus)
      ORDER BY count DESC
    `);
    
    const animalCategoryStats = await pool.query(`
      SELECT UNNEST(animal_category) as category, COUNT(*) as count
      FROM songs 
      WHERE animal_category IS NOT NULL 
      GROUP BY UNNEST(animal_category)
      ORDER BY count DESC
    `);
    
    const advocacyStyleStats = await pool.query(`
      SELECT UNNEST(advocacy_style) as category, COUNT(*) as count
      FROM songs 
      WHERE advocacy_style IS NOT NULL 
      GROUP BY UNNEST(advocacy_style)
      ORDER BY count DESC
    `);
    
    const audioFeaturesStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE energy IS NOT NULL) as with_energy,
        COUNT(*) FILTER (WHERE danceability IS NOT NULL) as with_danceability,
        COUNT(*) FILTER (WHERE valence IS NOT NULL) as with_valence,
        COUNT(*) FILTER (WHERE tempo IS NOT NULL) as with_tempo,
        ROUND(AVG(energy)::numeric, 3) as avg_energy,
        ROUND(AVG(danceability)::numeric, 3) as avg_danceability,
        ROUND(AVG(valence)::numeric, 3) as avg_valence,
        ROUND(AVG(tempo)::numeric, 1) as avg_tempo
      FROM songs
    `);
    
    // Create summary report
    let report = `# VEGAN PLAYLIST - DATA SUMMARY REPORT
Generated: ${new Date().toLocaleString()}

## OVERVIEW
Total Songs in Database: ${totalSongs.rows[0].count}
Songs with Genre Data: ${genreStats.rows[0].with_genre}
Songs with Parent Genre: ${genreStats.rows[0].with_parent_genre}

## GENRE BREAKDOWN

### Parent Genres:
`;
    
    parentGenreBreakdown.rows.forEach(row => {
      report += `${row.parent_genre}: ${row.count} songs\n`;
    });
    
    report += `\n### Top 20 Specific Genres:
`;
    
    topSpecificGenres.rows.forEach(row => {
      report += `${row.genre}: ${row.count} songs\n`;
    });
    
    if (veganFocusStats.rows.length > 0) {
      report += `\n## VEGAN FOCUS CATEGORIES:
`;
      veganFocusStats.rows.forEach(row => {
        report += `${row.category}: ${row.count} songs\n`;
      });
    } else {
      report += `\n## VEGAN FOCUS CATEGORIES:
No vegan focus data currently categorized.
`;
    }
    
    if (animalCategoryStats.rows.length > 0) {
      report += `\n## ANIMAL CATEGORIES:
`;
      animalCategoryStats.rows.forEach(row => {
        report += `${row.category}: ${row.count} songs\n`;
      });
    } else {
      report += `\n## ANIMAL CATEGORIES:
No animal category data currently categorized.
`;
    }
    
    if (advocacyStyleStats.rows.length > 0) {
      report += `\n## ADVOCACY STYLES:
`;
      advocacyStyleStats.rows.forEach(row => {
        report += `${row.category}: ${row.count} songs\n`;
      });
    } else {
      report += `\n## ADVOCACY STYLES:
No advocacy style data currently categorized.
`;
    }
    
    const audioStats = audioFeaturesStats.rows[0];
    report += `\n## AUDIO FEATURES ANALYSIS:
Songs with Energy data: ${audioStats.with_energy}
Songs with Danceability data: ${audioStats.with_danceability}
Songs with Valence data: ${audioStats.with_valence}
Songs with Tempo data: ${audioStats.with_tempo}

Average Audio Features:
- Energy: ${audioStats.avg_energy} (0.0 = low energy, 1.0 = high energy)
- Danceability: ${audioStats.avg_danceability} (0.0 = less danceable, 1.0 = more danceable)
- Valence: ${audioStats.avg_valence} (0.0 = negative/sad, 1.0 = positive/happy)
- Tempo: ${audioStats.avg_tempo} BPM

## DATA COMPLETENESS:
Genre Migration: ${((genreStats.rows[0].with_genre / totalSongs.rows[0].count) * 100).toFixed(1)}% complete
Audio Features: ${((audioStats.with_energy / totalSongs.rows[0].count) * 100).toFixed(1)}% complete

## FILES GENERATED:
1. vegan_playlist_complete_data.csv - Complete spreadsheet with all songs and categories
2. data_summary_report.txt - This summary report

## COLUMN DESCRIPTIONS:

### Basic Song Info:
- ID: Unique song identifier
- Title: Song title
- Artists: All artists (separated by semicolons)
- Album: Album name
- Release Date: Album release date
- Duration (ms): Song length in milliseconds
- Popularity: Spotify popularity score (0-100)

### Genre Classification:
- Genre: Specific genre (e.g., "hardcore punk", "metalcore")
- Parent Genre: Broader category (e.g., "punk", "metal")
- Artist Genres: Original Spotify artist genres

### Vegan/Advocacy Categories:
- Vegan Focus: Type of vegan messaging
- Animal Category: Specific animals mentioned
- Advocacy Style: Approach to advocacy
- Advocacy Issues: Specific issues addressed
- Lyrical Explicitness: How explicit the vegan message is

### Audio Features (Spotify API):
- Energy: Perceptual measure of intensity (0.0-1.0)
- Danceability: How suitable for dancing (0.0-1.0)
- Valence: Musical positivity/happiness (0.0-1.0)
- Tempo: BPM (beats per minute)
- Acousticness: Whether track is acoustic (0.0-1.0)
- Instrumentalness: Likelihood of no vocals (0.0-1.0)
- Liveness: Presence of audience/live recording (0.0-1.0)
- Speechiness: Presence of spoken words (0.0-1.0)
- Loudness: Overall loudness in dB
- Key: Musical key (0-11, C=0, C#=1, etc.)
- Mode: Major (1) or minor (0)
- Time Signature: Beats per measure

### Metadata:
- Explicit: Contains explicit content
- Data Source: "spotify" or "manual"
- Date Added: When added to database
- Spotify ID: Unique Spotify identifier
- Spotify URL: Link to song on Spotify
- Preview URL: 30-second preview link
- Album Type: single, album, compilation
- Total Tracks: Number of tracks in album
- Artist Spotify IDs: Unique Spotify identifiers for artists
`;
    
    // Write summary report
    const summaryPath = path.join(__dirname, '..', '..', 'data_summary_report.txt');
    fs.writeFileSync(summaryPath, report, 'utf8');
    
    console.log(`\n✅ Summary report created!`);
    console.log(`📄 File saved to: ${summaryPath}`);
    
    await pool.end();
  } catch (error) {
    console.error('Summary creation error:', error);
    process.exit(1);
  }
}

createDataSummary();