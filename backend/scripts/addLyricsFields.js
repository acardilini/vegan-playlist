const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function addLyricsFields() {
  const client = await pool.connect();
  
  try {
    console.log('Adding lyrics fields to songs table...');
    
    // Check if columns already exist
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'songs' AND column_name IN ('lyrics_url', 'lyrics_source')
    `);
    
    const existingColumns = checkResult.rows.map(row => row.column_name);
    
    // Add lyrics_url if it doesn't exist
    if (!existingColumns.includes('lyrics_url')) {
      await client.query(`
        ALTER TABLE songs 
        ADD COLUMN lyrics_url VARCHAR(500)
      `);
      console.log('✅ Added lyrics_url column');
    } else {
      console.log('ℹ️  lyrics_url column already exists');
    }
    
    // Add lyrics_source if it doesn't exist
    if (!existingColumns.includes('lyrics_source')) {
      await client.query(`
        ALTER TABLE songs 
        ADD COLUMN lyrics_source VARCHAR(50) DEFAULT 'other'
      `);
      console.log('✅ Added lyrics_source column');
    } else {
      console.log('ℹ️  lyrics_source column already exists');
    }
    
    // Create an index for faster queries on lyrics availability
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_lyrics_url 
      ON songs(lyrics_url) 
      WHERE lyrics_url IS NOT NULL AND lyrics_url != ''
    `);
    console.log('✅ Created index on lyrics_url');
    
    console.log('🎉 Lyrics fields migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Error adding lyrics fields:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
addLyricsFields().catch(console.error);