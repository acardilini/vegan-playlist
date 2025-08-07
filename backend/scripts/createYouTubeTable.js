const pool = require('../database/db');
const fs = require('fs');
const path = require('path');

async function createYouTubeTable() {
  try {
    console.log('🎥 Creating YouTube videos table...');
    
    // Read the SQL schema file
    const schemaPath = path.join(__dirname, '../database/youtube_videos_schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute the schema
    await pool.query(schemaSql);
    
    console.log('✅ YouTube videos table created successfully!');
    
    // Test the table by checking if it exists
    const testQuery = `
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'youtube_videos'
      ORDER BY ordinal_position;
    `;
    
    const result = await pool.query(testQuery);
    
    if (result.rows.length > 0) {
      console.log('\n📋 YouTube videos table structure:');
      result.rows.forEach(row => {
        console.log(`  ${row.column_name}: ${row.data_type}`);
      });
      
      // Test indexes
      const indexQuery = `
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'youtube_videos';
      `;
      
      const indexes = await pool.query(indexQuery);
      if (indexes.rows.length > 0) {
        console.log('\n🔍 Indexes created:');
        indexes.rows.forEach(idx => {
          console.log(`  ${idx.indexname}`);
        });
      }
      
      console.log('\n🎯 Ready to use YouTube video integration!');
      console.log('📝 You can now:');
      console.log('  • Add YouTube URLs in the admin interface');
      console.log('  • View videos on song detail pages');
      console.log('  • Manage multiple videos per song');
      
    } else {
      console.log('❌ Table creation may have failed - no columns found');
    }
    
  } catch (error) {
    console.error('❌ Error creating YouTube table:', error.message);
    console.error('Full error:', error);
  } finally {
    // Don't close the pool here in case other operations need it
    process.exit(0);
  }
}

// Run the script
createYouTubeTable();