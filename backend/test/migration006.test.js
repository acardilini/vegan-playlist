const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');

after(async () => { await pool.end(); });

test('song_processing table exists with expected columns', async () => {
  const cols = (await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name='song_processing'`)).rows.map(r => r.column_name);
  for (const c of ['song_id','snooze_until','park_reason','lyrics_tried','processing_note','updated_at']) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
});

test('park_reason CHECK rejects an invalid value', async () => {
  await assert.rejects(
    pool.query(`INSERT INTO song_processing (song_id, park_reason) VALUES (-999, 'bogus')`),
    /check constraint|violates/i);
});

test('songs.language and song_lyrics.translation columns exist', async () => {
  const songCols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='songs'`)).rows.map(r => r.column_name);
  const lyricCols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='song_lyrics'`)).rows.map(r => r.column_name);
  assert.ok(songCols.includes('language'));
  assert.ok(lyricCols.includes('translation'));
});
