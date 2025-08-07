const pool = require('../database/db');

async function updateExistingSubmission() {
  try {
    console.log('Updating existing submission to detect duplicates...');
    
    // Update the existing submission to detect the duplicate
    const updateQuery = `
      UPDATE song_submissions 
      SET existing_song_id = (
        SELECT s.id
        FROM songs s
        JOIN song_artists sa ON s.id = sa.song_id
        JOIN artists a ON sa.artist_id = a.id
        WHERE LOWER(a.name) = LOWER('The Smiths')
        AND (
          LOWER(s.title) = LOWER('Meat is Murder') OR
          LOWER(s.title) LIKE LOWER('Meat is Murder') || '%' OR
          LOWER(REGEXP_REPLACE(s.title, ' - \\d+ Remaster$', '', 'i')) = LOWER('Meat is Murder') OR
          LOWER(REGEXP_REPLACE(s.title, ' \\(.*\\)$', '', 'i')) = LOWER('Meat is Murder')
        )
        LIMIT 1
      )
      WHERE song_title = 'Meat is Murder' AND artist_name = 'The Smiths'
    `;
    
    const result = await pool.query(updateQuery);
    console.log('Updated existing submission with duplicate detection:', result.rowCount, 'rows affected');
    
    // Check the result
    const checkQuery = `
      SELECT ss.*, s.title as existing_song_title, s.spotify_url as existing_song_spotify_url
      FROM song_submissions ss
      LEFT JOIN songs s ON ss.existing_song_id = s.id
      WHERE ss.song_title = 'Meat is Murder' AND ss.artist_name = 'The Smiths'
    `;
    
    const check = await pool.query(checkQuery);
    console.log('Submission after update:');
    console.log('- Song:', check.rows[0].song_title, 'by', check.rows[0].artist_name);
    console.log('- Existing song ID:', check.rows[0].existing_song_id);
    console.log('- Existing song title:', check.rows[0].existing_song_title);
    console.log('- Status should show "Already in playlist" flag now');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

updateExistingSubmission();