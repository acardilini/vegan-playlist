const pool = require('../database/db');

async function checkSchema() {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'songs' 
      ORDER BY ordinal_position
    `);
    
    console.log('Songs table columns:');
    console.log('==================');
    result.rows.forEach(row => {
      console.log(`${row.column_name.padEnd(25)}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
    });

    // Also check manual_songs table
    const manualResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'manual_songs' 
      ORDER BY ordinal_position
    `);
    
    console.log('\nManual_songs table columns:');
    console.log('===========================');
    manualResult.rows.forEach(row => {
      console.log(`${row.column_name.padEnd(25)}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkSchema();