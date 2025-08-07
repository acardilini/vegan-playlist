const pool = require('../database/db');

async function addFeaturedField() {
  try {
    console.log('Checking if featured column exists...');
    
    // Check if column exists
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'songs' AND column_name = 'featured'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('Featured column already exists!');
      return;
    }
    
    console.log('Adding featured column to songs table...');
    
    // Add the column
    await pool.query(`
      ALTER TABLE songs ADD COLUMN featured BOOLEAN DEFAULT FALSE
    `);
    
    console.log('Featured column added successfully!');
    
    // Create index
    await pool.query(`
      CREATE INDEX idx_songs_featured ON songs(featured) WHERE featured = TRUE
    `);
    
    console.log('Index created for featured column!');
    
    // Add comment
    await pool.query(`
      COMMENT ON COLUMN songs.featured IS 'Manually pinned featured songs for homepage display'
    `);
    
    console.log('Column comment added!');
    console.log('Featured field migration completed successfully!');
    
  } catch (error) {
    console.error('Error adding featured field:', error);
  } finally {
    await pool.end();
  }
}

addFeaturedField();