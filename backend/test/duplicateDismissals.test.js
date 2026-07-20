const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const { getDismissedPairKeys, dismissGroup } = require('../services/duplicateDismissals');

// ZZZDUP sentinel — duplicate_dismissals has FKs to songs, so we insert real songs.
async function mkSong(title) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,'pending',false,'manual') RETURNING id`,
    [title])).rows[0].id;
}

test('dismissGroup records all pairs canonically and getDismissedPairKeys returns them', async () => {
  const a = await mkSong('ZZZDUP One');
  const b = await mkSong('ZZZDUP Two');
  const c = await mkSong('ZZZDUP Three');
  const n = await dismissGroup(pool, [c, a, b]); // deliberately unordered
  assert.equal(n, 3);
  const keys = await getDismissedPairKeys(pool);
  const [x, y, z] = [a, b, c].sort((m, n) => m - n);
  assert.ok(keys.has(`${x}:${y}`));
  assert.ok(keys.has(`${x}:${z}`));
  assert.ok(keys.has(`${y}:${z}`));
});

test('dismissGroup is idempotent (ON CONFLICT DO NOTHING)', async () => {
  const a = await mkSong('ZZZDUP Ida');
  const b = await mkSong('ZZZDUP Idb');
  await dismissGroup(pool, [a, b]);
  await dismissGroup(pool, [a, b]); // no throw
  const keys = await getDismissedPairKeys(pool);
  const [x, y] = [a, b].sort((m, n) => m - n);
  assert.ok(keys.has(`${x}:${y}`));
});

after(async () => {
  await pool.query(`DELETE FROM duplicate_dismissals WHERE song_id_a IN (SELECT id FROM songs WHERE title LIKE 'ZZZDUP%') OR song_id_b IN (SELECT id FROM songs WHERE title LIKE 'ZZZDUP%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZDUP%'`);
  await pool.end();
});
