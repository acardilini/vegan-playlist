const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const explore = require('../services/explore');

// Unique fixture sentinel per test file: ZZZEXP.

test('spaceLabel maps audio to the site word and title-cases anything unknown', () => {
  assert.equal(explore.spaceLabel('semantic'), 'Semantic');
  assert.equal(explore.spaceLabel('audio'), 'Sound');
  assert.equal(explore.spaceLabel('holistic'), 'Holistic');
  assert.equal(explore.spaceLabel('some_new_space'), 'Some New Space');
});

test('discoverSpaces reads the *_2d columns from the live table', async () => {
  const spaces = await explore.discoverSpaces(pool);
  const keys = spaces.map(s => s.key);
  for (const expected of ['semantic', 'thematic', 'audio', 'holistic']) {
    assert.ok(keys.includes(expected), `expected space ${expected}`);
  }
  for (const s of spaces) {
    assert.ok(s.column.endsWith('_2d'), 'column is a 2d column');
    assert.ok(s.label, 'every space has a label');
  }
});

// --- fixtures -------------------------------------------------------------
const made = { songs: [] };

async function mkSong(title, { published = true, status = 'included' } = {}) {
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ($1, $2, $3, 'manual') RETURNING id`, [title, status, published])).rows[0].id;
  made.songs.push(id);
  return id;
}

async function addCoords(songId) {
  await pool.query(
    `INSERT INTO song_coordinates
       (song_id, semantic_2d, semantic_3d, thematic_2d, thematic_3d,
        audio_2d, audio_3d, holistic_2d, holistic_3d)
     VALUES ($1, '{1,2}', '{1,2,3}', '{3,4}', '{1,2,3}',
             '{5,6}', '{1,2,3}', '{7,8}', '{1,2,3}')`, [songId]);
}

async function addAnalysis(songId, fields = {}) {
  const f = { sonic_energy: null, focus_amount: null, ...fields };
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, analyzed_at, themes, topics, advocacy, tactics, moral_frames,
        sonic_energy, focus_amount)
     VALUES ($1,'zzzexp-model','2026-07-27 10:00:00',
             '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$2,$3)`,
    [songId, f.sonic_energy, f.focus_amount]);
}

test('mapRows returns live mapped songs only', async () => {
  const spaces = await explore.discoverSpaces(pool);

  const live = await mkSong('ZZZEXP Live');
  await addCoords(live);
  await addAnalysis(live, { sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY' });

  const unpublished = await mkSong('ZZZEXP Unpublished', { published: false });
  await addCoords(unpublished);

  const pending = await mkSong('ZZZEXP Pending', { status: 'pending', published: false });
  await addCoords(pending);

  const unmapped = await mkSong('ZZZEXP No coords');

  const rows = await explore.mapRows(pool, spaces);
  const ids = rows.map(r => r.id);

  assert.ok(ids.includes(live), 'live mapped song is present');
  assert.ok(!ids.includes(unpublished), 'included-but-unpublished song is excluded');
  assert.ok(!ids.includes(pending), 'pending song is excluded');
  assert.ok(!ids.includes(unmapped), 'song without coordinates is excluded');

  const row = rows.find(r => r.id === live);
  assert.deepEqual(row.semantic_2d, [1, 2], 'coordinates come through as numbers');
  assert.equal(row.sonic_energy, 'EXPLOSIVE_HIGH_INTENSITY', 'latest-pass codes come through');
  assert.equal(row.title, 'ZZZEXP Live');
});

test('codeFor collapses absent, suppressed and missing values into NOT_CODED', () => {
  assert.equal(explore.codeFor('sonic_energy', { sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY' }),
    'EXPLOSIVE_HIGH_INTENSITY');
  assert.equal(explore.codeFor('sonic_energy', { sonic_energy: null }), explore.NOT_CODED);
  // ABSENCE_OF_FOCUS is a suppressed absence code, not a finding
  assert.equal(explore.codeFor('focus_amount', { focus_amount: 'ABSENCE_OF_FOCUS' }), explore.NOT_CODED);
  assert.equal(explore.codeFor('focus_amount', { focus_amount: 'CENTRAL_THESIS' }), 'CENTRAL_THESIS');
  // genre buckets to its parent
  assert.equal(explore.codeFor('genre', { genre: 'metalcore' }), 'metal');
  assert.equal(explore.codeFor('genre', { genre: null }), explore.NOT_CODED);
});

test('mapPayload assembles spaces, legends, coverage and songs', async () => {
  const id = await mkSong('ZZZEXP Payload');
  await addCoords(id);
  await addAnalysis(id, { sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY', focus_amount: 'ABSENCE_OF_FOCUS' });

  const p = await explore.mapPayload(pool);

  assert.ok(p.spaces.some(s => s.key === 'audio' && s.label === 'Sound'));
  assert.ok(p.coverage.mapped > 0 && p.coverage.live >= p.coverage.mapped,
    'coverage counts are sane');
  assert.equal(p.coverage.mapped, p.songs.length, 'mapped count matches the songs served');

  const energy = p.colourBy.find(c => c.key === 'sonic_energy');
  assert.equal(energy.label, 'Energy');
  assert.ok(energy.codes.every(c => c.count > 0), 'legend lists only codes actually present');
  assert.ok(energy.codes.some(c => c.code === 'EXPLOSIVE_HIGH_INTENSITY'));

  // The fixture's focus_amount is ABSENCE_OF_FOCUS, so this bucket is guaranteed present —
  // assert on it unconditionally rather than skipping when it happens to be absent.
  const focus = p.colourBy.find(c => c.key === 'focus_amount');
  const notCoded = focus.codes.find(c => c.code === explore.NOT_CODED);
  assert.ok(notCoded, 'the Not coded bucket exists');
  assert.equal(notCoded.label, 'Not coded');
  assert.equal(focus.codes[focus.codes.length - 1].code, explore.NOT_CODED,
    'Not coded sorts last');

  const song = p.songs.find(s => s.id === id);
  assert.deepEqual(song.coords.semantic, [1, 2]);
  assert.equal(song.codes.sonic_energy, 'EXPLOSIVE_HIGH_INTENSITY');
  assert.equal(song.codes.focus_amount, explore.NOT_CODED, 'suppressed code is bucketed');
  assert.equal(song.artist, '', 'a song with no artist rows serves an empty artist string');
});

after(async () => {
  if (made.songs.length) {
    await pool.query('DELETE FROM song_coordinates WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM song_lyric_analysis WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM songs WHERE id = ANY($1::int[])', [made.songs]);
  }
  await pool.end();
});
