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

async function mkSong(title, { published = true, status = 'included', genre = null } = {}) {
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, genre)
     VALUES ($1, $2, $3, 'manual', $4) RETURNING id`, [title, status, published, genre])).rows[0].id;
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

test('genreFold folds outside-top-3 and the literal other parent into Other genres', () => {
  // A synthetic rows array, independent of anything in the database: metal(4) >
  // hardcore(3) > punk(2) > folk(1) — folk sits outside the top 3. 'christian' maps to
  // the literal 'other' parent and is given the highest count of all, to prove rule 1:
  // 'other' is excluded from the top-N ranking regardless of count. This test never
  // touches the DB, so it cannot fail for a live-catalogue-genre-distribution reason.
  const rows = [
    ...Array(4).fill({ genre: 'metalcore' }),  // -> metal
    ...Array(3).fill({ genre: 'hardcore' }),   // -> hardcore
    ...Array(2).fill({ genre: 'punk' }),       // -> punk
    { genre: 'folk' },                         // -> folk (outside top 3)
    ...Array(5).fill({ genre: 'christian' }),  // -> other (literal parent, excluded from ranking)
    { genre: null },                           // -> NOT_CODED
  ];
  const fold = explore.genreFold(rows);
  const bucket = row => fold('genre', explore.codeFor('genre', row));

  assert.equal(bucket({ genre: 'metalcore' }), 'metal');
  assert.equal(bucket({ genre: 'hardcore' }), 'hardcore');
  assert.equal(bucket({ genre: 'punk' }), 'punk');
  // A genre outside the top 3 lands in Other genres, not a bucket of its own.
  assert.equal(bucket({ genre: 'folk' }), explore.OTHER_GENRES);
  // The literal 'other' parent lands in Other genres even though it out-counts everything.
  assert.equal(bucket({ genre: 'christian' }), explore.OTHER_GENRES);
  // No genre at all still buckets to NOT_CODED, not Other genres.
  assert.equal(bucket({ genre: null }), explore.NOT_CODED);

  // Non-genre dimensions pass through unchanged — the fold is genre-only.
  assert.equal(fold('sonic_energy', 'EXPLOSIVE_HIGH_INTENSITY'), 'EXPLOSIVE_HIGH_INTENSITY');
  assert.equal(fold('focus_amount', explore.NOT_CODED), explore.NOT_CODED);

  assert.equal(explore.OTHER_GENRES_LABEL, 'Other genres');
});

test('genre colour-by via mapPayload: no-genre stays NOT_CODED, legend fits the palette, ' +
  'and every song codes.genre is in its own legend', async () => {
  // This test goes through the real DB/mapPayload path, so it deliberately asserts only
  // structural properties that hold no matter what the live catalogue's genre distribution
  // is — never "genre X is/isn't in the top 3", which the pure genreFold test above already
  // covers deterministically.
  const noGenreId = await mkSong('ZZZEXP Genre none');
  await addCoords(noGenreId);

  const p = await explore.mapPayload(pool);
  const genreLegend = p.colourBy.find(c => c.key === 'genre');
  const codes = genreLegend.codes.map(c => c.code);

  // At most 5 entries: 3 named genres + "Other genres" + "Not coded" is the palette budget.
  assert.ok(genreLegend.codes.length <= 5, `genre legend fits the palette, got ${codes}`);
  assert.ok(!codes.includes('other'), 'the literal other parent never appears as its own bucket');

  // Not coded is present (this fixture guarantees it) and sorts last; if Other genres is
  // present it sits immediately before Not coded.
  assert.ok(codes.includes(explore.NOT_CODED));
  assert.equal(codes[codes.length - 1], explore.NOT_CODED, 'Not coded sorts last');
  const otherIdx = codes.indexOf(explore.OTHER_GENRES);
  if (otherIdx !== -1) {
    assert.equal(otherIdx, codes.length - 2, 'Other genres sits immediately before Not coded');
    const otherEntry = genreLegend.codes[otherIdx];
    assert.equal(otherEntry.label, explore.OTHER_GENRES_LABEL);
  }

  // No genre at all still buckets to NOT_CODED, not Other genres.
  const noGenreSong = p.songs.find(s => s.id === noGenreId);
  assert.equal(noGenreSong.codes.genre, explore.NOT_CODED);

  // The invariant: every song's codes.genre value appears somewhere in the genre legend.
  // Checked over the whole payload (not just this fixture) so a fold applied to only one
  // of legendFor/mapPayload's consumers would be caught even by songs outside this test.
  for (const song of p.songs) {
    assert.ok(codes.includes(song.codes.genre),
      `song ${song.id} codes.genre=${song.codes.genre} missing from genre legend ${codes}`);
  }
});

test('a non-genre dimension is completely unaffected by the genre fold', async () => {
  const a = await mkSong('ZZZEXP NonGenre A');
  await addCoords(a);
  await addAnalysis(a, { sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY' });

  const b = await mkSong('ZZZEXP NonGenre B');
  await addCoords(b);
  await addAnalysis(b, { sonic_energy: 'SOFT_CALM_ACOUSTIC' });

  const c = await mkSong('ZZZEXP NonGenre C');
  await addCoords(c);
  await addAnalysis(c, { sonic_energy: null });

  const p = await explore.mapPayload(pool);
  const energy = p.colourBy.find(c => c.key === 'sonic_energy');
  const codes = energy.codes.map(x => x.code);

  assert.ok(codes.includes('EXPLOSIVE_HIGH_INTENSITY'), 'fixture code A is in the legend');
  assert.ok(codes.includes('SOFT_CALM_ACOUSTIC'), 'fixture code B is in the legend');
  assert.ok(!codes.includes('OTHER_GENRES'), 'the genre-only fold bucket never leaks in here');

  const songA = p.songs.find(s => s.id === a);
  const songB = p.songs.find(s => s.id === b);
  const songC = p.songs.find(s => s.id === c);
  assert.equal(songA.codes.sonic_energy, 'EXPLOSIVE_HIGH_INTENSITY');
  assert.equal(songB.codes.sonic_energy, 'SOFT_CALM_ACOUSTIC');
  assert.equal(songC.codes.sonic_energy, explore.NOT_CODED);
});

after(async () => {
  if (made.songs.length) {
    await pool.query('DELETE FROM song_coordinates WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM song_lyric_analysis WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM songs WHERE id = ANY($1::int[])', [made.songs]);
  }
  await pool.end();
});
