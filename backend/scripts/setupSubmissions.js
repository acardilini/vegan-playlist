const fs = require('fs');
const path = require('path');
const pool = require('../database/db');

async function setupSubmissions() {
  try {
    console.log('Setting up song_submissions table...');
    
    // Read the SQL schema file
    const schemaPath = path.join(__dirname, '../database/song_submissions_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute the SQL
    await pool.query(schema);
    
    console.log('✅ Song submissions table created successfully!');
    console.log('✅ Indexes created successfully!');
    console.log('✅ Triggers created successfully!');
    
    // Test the table by inserting and then deleting a test record
    console.log('\nTesting table with sample data...');
    
    const testResult = await pool.query(`
      INSERT INTO song_submissions (song_title, artist_name, submission_reason)
      VALUES ('Test Song', 'Test Artist', 'This is a test submission')
      RETURNING id
    `);
    
    const testId = testResult.rows[0].id;
    console.log(`✅ Test record inserted with ID: ${testId}`);
    
    // Clean up test record
    await pool.query('DELETE FROM song_submissions WHERE id = $1', [testId]);
    console.log('✅ Test record cleaned up');
    
    console.log('\n🎵 Song submission feature is ready to use!');
    console.log('API endpoints available at:');
    console.log('- POST /api/submissions/submit');
    console.log('- GET /api/submissions/admin');
    console.log('- GET /api/submissions/stats');
    
  } catch (error) {
    console.error('❌ Error setting up submissions table:', error);
    console.error('Details:', error.message);
  } finally {
    await pool.end();
  }
}

setupSubmissions();