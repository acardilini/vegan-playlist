const pool = require('../database/db');

async function runMigration() {
  try {
    console.log('🔄 Running database migration...');
    
    // Add enhanced fields to songs table
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS track_number INTEGER');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS disc_number INTEGER');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS available_markets JSONB');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS playlist_added_at TIMESTAMP');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS playlist_added_by VARCHAR(255)');
    
    // Audio features
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS energy DECIMAL(3,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS danceability DECIMAL(3,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS valence DECIMAL(3,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS acousticness DECIMAL(3,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS instrumentalness DECIMAL(3,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS liveness DECIMAL(3,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS speechiness DECIMAL(3,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS tempo DECIMAL(6,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS loudness DECIMAL(6,2)');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS key INTEGER');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS mode INTEGER');
    await pool.query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS time_signature INTEGER');
    
    // Add enhanced fields to albums table
    await pool.query('ALTER TABLE albums ADD COLUMN IF NOT EXISTS album_type VARCHAR(50)');
    await pool.query('ALTER TABLE albums ADD COLUMN IF NOT EXISTS label VARCHAR(255)');
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the new columns exist
    const songsSchema = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'songs' 
      AND column_name IN ('track_number', 'playlist_added_at', 'energy', 'album_type')
      ORDER BY column_name
    `);
    
    console.log('🔍 New columns added:');
    songsSchema.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    pool.end();
  }
}

runMigration();