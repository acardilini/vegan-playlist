const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const dataset = require('../services/dataset');
const { getParentGenre } = require('../utils/genreMapping');

// Unique fixture sentinel per test file: ZZZDSET.
const P = 'ZZZDSET';
let albumId;

async function mkSong(title, { published = true, status = 'included', genre = null, album = true } = {}) {
  if (album && !albumId) {
    albumId = (await pool.query(
      `INSERT INTO albums (name, release_date, data_source) VALUES ($1, '1994-05-01', 'manual') RETURNING id`,
      [`${P} Album`])).rows[0].id;
  }
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, genre, album_id)
     VALUES ($1,$2,$3,'manual',$4,$5) RETURNING id`,
    [`${P} ${title}`, status, published, genre, album ? albumId : null])).rows[0].id;
}
async function mkAudio(songId, { genre = 'metal', bpm = 120, stability = 'STABLE', lufs = -9 } = {}) {
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, tempo_bpm, tempo_stability,
       loudness_lufs, inferred_parent_genre)
     VALUES ($1, 'ZZZ-model', 'OK', now(), $2, $3, $4, $5)`, [songId, bpm, stability, lufs, genre]);
}
async function mkLyric(songId, tone) {
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, analyzed_at, lyrical_tone, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'ZZZ-model', now(), $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [songId, tone]);
}

after(async () => {
  const ids = (await pool.query(`SELECT id FROM songs WHERE title LIKE $1`, [`${P}%`])).rows.map(r => r.id);
  if (ids.length) {
    await pool.query(`DELETE FROM song_audio_analysis WHERE song_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM songs WHERE id = ANY($1)`, [ids]);
  }
  await pool.query(`DELETE FROM albums WHERE name LIKE $1`, [`${P}%`]);
  await pool.end();
});

const find = (d, title) => d.songs.find(s => s.t === `${P} ${title}`);

test('a song with its own genre is placed under that genre\'s parent', async () => {
  await mkSong('own', { genre: 'Hardcore Punk' });
  const d = await dataset.buildDataset(pool);
  assert.equal(find(d, 'own').g, getParentGenre('hardcore punk'));
  assert.equal(find(d, 'own').y, 1994);
});

test('a song with no catalogue genre falls back to the audio parent genre in the same field', async () => {
  const id = await mkSong('audiogenre');
  await mkAudio(id, { genre: 'metal' });
  const d = await dataset.buildDataset(pool);
  assert.equal(find(d, 'audiogenre').g, 'metal');
  assert.equal(find(d, 'audiogenre').ha, true);
});

test('an unpublished or non-included song is absent', async () => {
  await mkSong('hidden', { published: false });
  await mkSong('pending', { status: 'pending', published: false });
  const d = await dataset.buildDataset(pool);
  assert.equal(find(d, 'hidden'), undefined);
  assert.equal(find(d, 'pending'), undefined);
});

test('tone is gated by the codebook; legacy and error codes become null', async () => {
  const bad = await mkSong('badtone'); await mkLyric(bad, 'ERROR');
  const good = await mkSong('goodtone'); await mkLyric(good, 'INDICTMENT');
  const d = await dataset.buildDataset(pool);
  assert.equal(find(d, 'badtone').tone, null);
  assert.equal(find(d, 'goodtone').tone, 'INDICTMENT');
  assert.equal(find(d, 'goodtone').hl, true);
  assert.ok(d.labels.tone.INDICTMENT);
});

test('a song with no album has a null year', async () => {
  await mkSong('noalbum', { album: false });
  const d = await dataset.buildDataset(pool);
  assert.equal(find(d, 'noalbum').y, null);
});

test('coverage counts agree with the songs array', async () => {
  const d = await dataset.buildDataset(pool);
  assert.equal(d.coverage.live, d.songs.length);
  assert.equal(d.coverage.dated, d.songs.filter(s => s.y != null).length);
  assert.equal(d.coverage.genre, d.songs.filter(s => s.g).length);
  assert.equal(d.coverage.audio, d.songs.filter(s => s.ha).length);
  assert.equal(d.coverage.lyric, d.songs.filter(s => s.hl).length);
});

test('the payload carries no provenance, text or sample fields', async () => {
  const d = await dataset.buildDataset(pool);
  const json = JSON.stringify(d).toLowerCase();
  for (const word of ['inferred', 'lyrics', 'transcript', 'samples', 'provenance']) {
    assert.ok(!json.includes(`"${word}`) && !json.includes(`${word}"`), `payload must not mention ${word}`);
  }
  assert.deepEqual(Object.keys(d.songs[0]).sort(), ['a', 'g', 'ha', 'hl', 'id', 't', 'tone', 'y']);
});

test('getDataset is cached until cleared', async () => {
  dataset._clearCache();
  const a = await dataset.getDataset(pool);
  const b = await dataset.getDataset(pool);
  assert.strictEqual(a, b);
  dataset._clearCache();
  const c = await dataset.getDataset(pool);
  assert.notStrictEqual(a, c);
});
