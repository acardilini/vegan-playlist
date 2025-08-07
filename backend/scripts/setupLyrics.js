const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupLyricsSupport() {
  console.log('🎵 Setting up lyrics functionality...');
  
  // Use the same database connection method as the main app
  let pool;
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  } catch (error) {
    console.error('❌ Failed to create database pool:', error.message);
    console.log('💡 Make sure your DATABASE_URL is set correctly in .env file');
    process.exit(1);
  }

  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking if lyrics columns exist...');
    
    // Check if columns exist
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'songs' 
      AND table_schema = 'public'
      AND column_name IN ('lyrics_url', 'lyrics_source')
    `);
    
    const existingColumns = checkResult.rows.map(row => row.column_name);
    console.log('📋 Existing lyrics columns:', existingColumns);
    
    let needsUpdate = false;
    
    // Add lyrics_url if missing
    if (!existingColumns.includes('lyrics_url')) {
      console.log('➕ Adding lyrics_url column...');
      await client.query(`ALTER TABLE songs ADD COLUMN lyrics_url VARCHAR(500)`);
      console.log('✅ Added lyrics_url column');
      needsUpdate = true;
    }
    
    // Add lyrics_source if missing
    if (!existingColumns.includes('lyrics_source')) {
      console.log('➕ Adding lyrics_source column...');
      await client.query(`ALTER TABLE songs ADD COLUMN lyrics_source VARCHAR(50) DEFAULT 'other'`);
      console.log('✅ Added lyrics_source column');
      needsUpdate = true;
    }
    
    if (needsUpdate) {
      // Create indexes for better performance
      console.log('🔧 Creating database indexes...');
      
      try {
        await client.query(`
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_lyrics_url 
          ON songs(lyrics_url) 
          WHERE lyrics_url IS NOT NULL AND lyrics_url != ''
        `);
        console.log('✅ Created lyrics_url index');
      } catch (indexError) {
        // Non-concurrent version if CONCURRENTLY fails
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_songs_lyrics_url 
          ON songs(lyrics_url) 
          WHERE lyrics_url IS NOT NULL AND lyrics_url != ''
        `);
        console.log('✅ Created lyrics_url index (non-concurrent)');
      }
    }
    
    // Test the setup by counting songs
    const testResult = await client.query(`
      SELECT 
        COUNT(*) as total_songs,
        COUNT(lyrics_url) as songs_with_lyrics
      FROM songs
    `);
    
    const stats = testResult.rows[0];
    console.log(`📊 Database ready: ${stats.total_songs} total songs, ${stats.songs_with_lyrics} with lyrics links`);
    
    if (needsUpdate) {
      console.log('🎉 Lyrics functionality successfully set up!');
      console.log('🔄 Please restart your backend server to use the new features.');
    } else {
      console.log('✨ Lyrics columns already exist - ready to go!');
    }
    
  } catch (error) {
    console.error('❌ Error setting up lyrics support:', error);
    console.error('Details:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('does not exist')) {
      console.log('💡 Make sure your database is running and the songs table exists');
    } else if (error.message.includes('permission denied')) {
      console.log('💡 Check your database user has ALTER TABLE permissions');
    } else if (error.message.includes('SCRAM')) {
      console.log('💡 Check your database password in the .env file');
    }
    
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run setup
if (require.main === module) {
  setupLyricsSupport().catch(console.error);
}

module.exports = setupLyricsSupport;