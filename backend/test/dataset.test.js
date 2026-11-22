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
  assert.deepEqual(Object.keys(d.songs[0]).sort(), ['a', 'act', 'aud', 'avoc', 'emo', 'frm', 'g', 'ha', 'hl', 'id', 't', 'thm', 'tone', 'y']);
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

// ---- Arguments fields (aud, frm, act, emo, avoc, thm) ----
const analysis = require('../services/analysis');
const tx = analysis.taxonomy;
const T0 = tx.themes[0].id, T1 = tx.themes[1].id;
const A0 = tx.actions[0].id;
const F0 = tx.moral_frames[0].id, F1 = tx.moral_frames[1].id;
const ev = (codes) => JSON.stringify(codes.map(code => ({ code, evidence: 'ZZZ evidence text' })));

async function mkLyricFull(songId, { tone = null, themes = [], advocacy = [], moralFrames = [], emotions = [], audience = null } = {}) {
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, analyzed_at, lyrical_tone, themes, topics, advocacy, tactics,
       moral_frames, emotions, target_audience)
     VALUES ($1, 'ZZZ-model', now(), $2, $3::jsonb, '[]'::jsonb, $4::jsonb, '[]'::jsonb, $5::jsonb, $6::text[], $7)`,
    [songId, tone, ev(themes), ev(advocacy), ev(moralFrames), emotions, audience]);
}
async function mkVocal(songId, vocal) {
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, vocal_style)
     VALUES ($1, 'ZZZ-model', 'OK', now(), $2::text[])`, [songId, vocal]);
}

test('thm keeps listed order, drops unknown codes and duplicates', async () => {
  const id = await mkSong('thm'); await mkLyricFull(id, { themes: [T0, 'zzz_bogus', T1, T0] });
  const d = await dataset.buildDataset(pool);
  assert.deepEqual(find(d, 'thm').thm, [T0, T1]);
});

test('frm and act are the first valid code', async () => {
  const id = await mkSong('frmact');
  await mkLyricFull(id, { moralFrames: ['zzz_bogus', F0, F1], advocacy: [A0] });
  const none = await mkSong('noact'); await mkLyricFull(none, { advocacy: [] });
  const d = await dataset.buildDataset(pool);
  assert.equal(find(d, 'frmact').frm, F0);
  assert.equal(find(d, 'frmact').act, A0);
  assert.equal(find(d, 'noact').act, null);
});

test('emo, aud and avoc are the first codebook-valid value', async () => {
  const id = await mkSong('scalars');
  await mkLyricFull(id, { emotions: ['ZZZ_BOGUS', 'GRIEF', 'OUTRAGE'], audience: 'COMPLACENT_AND_INDIFFERENT_PUBLIC' });
  await mkVocal(id, ['ZZZ_BOGUS', 'RAW_SHOUTED']);
  const d = await dataset.buildDataset(pool);
  assert.equal(find(d, 'scalars').emo, 'GRIEF');
  assert.equal(find(d, 'scalars').aud, 'COMPLACENT_AND_INDIFFERENT_PUBLIC');
  assert.equal(find(d, 'scalars').avoc, 'RAW_SHOUTED');
});

test('a song with no lyric analysis has null codes and an empty thm', async () => {
  await mkSong('nolyric');
  const d = await dataset.buildDataset(pool);
  const s = find(d, 'nolyric');
  for (const k of ['aud', 'frm', 'act', 'emo', 'avoc']) assert.equal(s[k], null, k);
  assert.deepEqual(s.thm, []);
});

test('labels carry a label for each code that appears', async () => {
  const id = await mkSong('labels');
  await mkLyricFull(id, { themes: [T0], advocacy: [A0], moralFrames: [F0], emotions: ['GRIEF'], audience: 'COMPLACENT_AND_INDIFFERENT_PUBLIC' });
  await mkVocal(id, ['RAW_SHOUTED']);
  const d = await dataset.buildDataset(pool);
  const pairs = [['thm', T0], ['frm', F0], ['act', A0], ['emo', 'GRIEF'], ['aud', 'COMPLACENT_AND_INDIFFERENT_PUBLIC'], ['avoc', 'RAW_SHOUTED']];
  for (const [k, code] of pairs) {
    assert.ok(typeof d.labels[k][code] === 'string' && d.labels[k][code].length > 0, `${k}.${code}`);
  }
});

test('no song object carries an evidence key', async () => {
  const id = await mkSong('noevtext'); await mkLyricFull(id, { themes: [T0], advocacy: [A0], moralFrames: [F0] });
  const d = await dataset.buildDataset(pool);
  assert.equal(JSON.stringify(d.songs).includes('evidence'), false);
});
