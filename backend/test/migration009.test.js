const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');

after(async () => { await pool.end(); });

test('songs.language is a text array', async () => {
  const r = await pool.query(`
    SELECT data_type, udt_name FROM information_schema.columns
    WHERE table_name = 'songs' AND column_name = 'language'`);
  assert.equal(r.rows[0].data_type, 'ARRAY');
  assert.equal(r.rows[0].udt_name, '_text');
});

test('existing language values survived the conversion', async () => {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS n FROM songs WHERE language IS NOT NULL AND cardinality(language) > 0`);
  assert.ok(r.rows[0].n >= 38, `expected at least the 38 pre-migration rows, got ${r.rows[0].n}`);
});

test("the 'Mouri' typo was corrected to 'Māori'", async () => {
  const bad = await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE 'Mouri' = ANY(language)`);
  assert.equal(bad.rows[0].n, 0, "no row should still say 'Mouri'");
  const good = await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE 'Māori' = ANY(language)`);
  assert.equal(good.rows[0].n, 1);
});
