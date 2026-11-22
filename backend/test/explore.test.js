const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const explore = require('../services/explore');

// Unique fixture sentinel per test file: ZZZEXP.

test('spaceLabel maps audio to the site word and title-cases anything unknown', () => {
  assert.equal(explore.spaceLabel('thematic'), 'Thematic');
  assert.equal(explore.spaceLabel('audio'), 'Sound');
  assert.equal(explore.spaceLabel('holistic'), 'Holistic');
  assert.equal(explore.spaceLabel('some_new_space'), 'Some New Space');
});

test('discoverSpaces reads the *_2d columns from the live table, minus the hidden ones', async () => {
  const spaces = await explore.discoverSpaces(pool);
  const keys = spaces.map(s => s.key);
  for (const expected of ['thematic', 'audio', 'holistic']) {
    assert.ok(keys.includes(expected), `expected space ${expected}`);
  }
  // semantic_2d is still a populated column; it is hidden by HIDDEN_SPACES, so proving it
  // is absent here is proving the hide-list works — not that the data went away.
  assert.ok(!keys.includes('semantic'), 'the hidden semantic space is not served');
  for (const s of spaces) {
    assert.ok(s.column.endsWith('_2d'), 'column is a 2d column');
    assert.ok(s.label, 'every space has a label');
  }
});

test('each known space is served with a description, and an unknown one with null', async () => {
  const spaces = await explore.discoverSpaces(pool);
  const byKey = Object.fromEntries(spaces.map(s => [s.key, s]));

  // Curator-approved copy pinned exactly; drift in these strings fails the test.
  assert.equal(byKey.thematic.description, 'Positioned by an analysis of the lyrics.');
  assert.equal(byKey.audio.description, "Positioned by an analysis of the song's acoustic properties.");
  assert.equal(byKey.holistic.description, 'Positioned by an analysis of both the lyrics and the sound.');

  // Discovery is data-driven, so a space the pipeline adds later has no copy written for it.
  // It must serve null rather than an invented sentence.
  assert.equal(explore.spaceDescription('some_new_space'), null);
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
  await makeEligible(songId);
}

// The map and lyric-based similarity only include songs with real lyrics AND an analysis (sub-project G), so those
// fixtures get both by default; addAnalysis() below overrides the analysis fields where a test cares.
async function makeEligible(songId) {
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1, 'real words for the map fixture')
                    ON CONFLICT (song_id) DO NOTHING`, [songId]);
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, analyzed_at, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1,'zzzexp-model','2026-07-27 10:00:00','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)
     ON CONFLICT DO NOTHING`, [songId]);
}

async function addAnalysis(songId, fields = {}) {
  const f = {
    focus_amount: null,
    themes: [], topics: [], advocacy: [], tactics: [], moral_frames: [],
    ...fields,
  };
  const j = v => JSON.stringify(v);
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, analyzed_at, themes, topics, advocacy, tactics, moral_frames, focus_amount)
     VALUES ($1,'zzzexp-model','2026-07-27 10:00:00',
             $3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$2)
     ON CONFLICT (song_id, model_used) DO UPDATE SET
       focus_amount = EXCLUDED.focus_amount,
       themes = EXCLUDED.themes, topics = EXCLUDED.topics, advocacy = EXCLUDED.advocacy,
       tactics = EXCLUDED.tactics, moral_frames = EXCLUDED.moral_frames`,
    [songId, f.focus_amount,
      j(f.themes), j(f.topics), j(f.advocacy), j(f.tactics), j(f.moral_frames)]);
}

// The song's audio row (the new analysis); deleting the song cascades it away.
async function addAudio(songId, fields = {}) {
  const f = { sonic_intensity: null, production_texture: null, dynamic_arc: null, ...fields };
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, sonic_intensity, production_texture, dynamic_arc)
     VALUES ($1,'zzzexp-audio','OK','2026-11-01 10:00:00',$2,$3,$4)
     ON CONFLICT (song_id, model_used) DO UPDATE SET
       sonic_intensity = EXCLUDED.sonic_intensity, production_texture = EXCLUDED.production_texture,
       dynamic_arc = EXCLUDED.dynamic_arc`,
    [songId, f.sonic_intensity, f.production_texture, f.dynamic_arc]);
}

const codes = (...ids) => ids.map(code => ({ code, evidence: 'zzzexp' }));

test('mapRows returns live mapped songs only', async () => {
  const spaces = await explore.discoverSpaces(pool);

  const live = await mkSong('ZZZEXP Live');
  await addCoords(live);
  await addAudio(live, { sonic_intensity: 'HEAVY_INTENSE' });

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
  assert.deepEqual(row.thematic_2d, [3, 4], 'coordinates come through as numbers');
  assert.ok(!('semantic_2d' in row), 'a hidden space is not even selected');
  assert.equal(row.sonic_intensity, 'HEAVY_INTENSE', 'the song\'s audio codes come through');
  assert.ok(!('sonic_energy' in row) && !('emotional_mood' in row), 'the retired acoustic columns are not selected');
  assert.equal(row.title, 'ZZZEXP Live');
});

test('codeFor collapses absent, suppressed and missing values into NOT_CODED', () => {
  assert.equal(explore.codeFor('sonic_intensity', { sonic_intensity: 'HEAVY_INTENSE' }),
    'HEAVY_INTENSE');
  assert.equal(explore.codeFor('sonic_intensity', { sonic_intensity: null }), explore.NOT_CODED);
  // ABSENT is a suppressed absence code, not a finding
  assert.equal(explore.codeFor('focus_amount', { focus_amount: 'ABSENT' }), explore.NOT_CODED);
  assert.equal(explore.codeFor('focus_amount', { focus_amount: 'PRIMARY' }), 'PRIMARY');
  // genre buckets to its parent
  assert.equal(explore.codeFor('genre', { genre: 'metalcore' }), 'metal');
  assert.equal(explore.codeFor('genre', { genre: null }), explore.NOT_CODED);
});

test('mapPayload assembles spaces, legends, coverage and songs', async () => {
  const id = await mkSong('ZZZEXP Payload');
  await addCoords(id);
  await addAnalysis(id, { focus_amount: 'ABSENT' });
  await addAudio(id, { sonic_intensity: 'HEAVY_INTENSE' });

  const p = await explore.mapPayload(pool);

  assert.ok(p.spaces.some(s => s.key === 'audio' && s.label === 'Sound'));
  assert.ok(p.coverage.mapped > 0 && p.coverage.live >= p.coverage.mapped,
    'coverage counts are sane');
  assert.equal(p.coverage.mapped, p.songs.length, 'mapped count matches the songs served');

  const intensity = p.colourBy.find(c => c.key === 'sonic_intensity');
  assert.equal(intensity.label, 'Intensity');
  assert.ok(intensity.codes.every(c => c.count > 0), 'legend lists only codes actually present');
  assert.ok(intensity.codes.some(c => c.code === 'HEAVY_INTENSE' && c.label === 'Heavy'));
  // The colour menu is the three palette-sized audio dimensions, focus, genre and the theme dimensions.
  assert.deepEqual(p.colourBy.map(c => c.key), [
    'sonic_intensity', 'production_texture', 'dynamic_arc', 'focus_amount', 'genre',
    'themes', 'targets', 'actions', 'moral_frames',
  ]);
  // Not coded is drawn neutral grey, so it takes no palette slot: the coloured codes must fit the 7.
  assert.ok(p.colourBy.every(c => c.codes.filter(x => x.code !== explore.NOT_CODED).length <= 7
    || c.key === 'genre'), 'each legend fits the palette');

  // The fixture's focus_amount is the suppressed ABSENT, so this bucket is guaranteed present —
  // assert on it unconditionally rather than skipping when it happens to be absent.
  const focus = p.colourBy.find(c => c.key === 'focus_amount');
  const notCoded = focus.codes.find(c => c.code === explore.NOT_CODED);
  assert.ok(notCoded, 'the Not coded bucket exists');
  assert.equal(notCoded.label, 'Not coded');
  assert.equal(focus.codes[focus.codes.length - 1].code, explore.NOT_CODED,
    'Not coded sorts last');

  const song = p.songs.find(s => s.id === id);
  assert.deepEqual(song.coords.thematic, [3, 4]);
  assert.ok(!('semantic' in song.coords), 'no coordinates are served for a hidden space');
  assert.equal(song.codes.sonic_intensity, 'HEAVY_INTENSE');
  assert.equal(song.codes.focus_amount, explore.NOT_CODED, 'suppressed code is bucketed');
  assert.equal(song.artist, '', 'a song with no artist rows serves an empty artist string');
});

test('normaliseCloud centres, scales uniformly and keeps nulls', () => {
  const out = explore.normaliseCloud([[0, 0, 0], [10, 0, 0], [0, 4, 0], null]);
  // R = max(10, 4, 0) / 2 * 1.15 = 5.75 on EVERY axis (uniform scale, no distortion)
  assert.equal(out[1][0], Math.round(((10 - 5) / 5.75) * 1e4) / 1e4);
  assert.equal(out[2][1], Math.round(((4 - 2) / 5.75) * 1e4) / 1e4);
  assert.equal(out[3], null);
  for (const p of out.filter(Boolean)) {
    for (const v of p) {
      assert.ok(Math.abs(v) <= 1, 'inside the unit cube');
      assert.equal(v, Math.round(v * 1e4) / 1e4, 'rounded to 4 dp');
    }
  }
});

test('normaliseCloud survives degenerate input', () => {
  assert.deepEqual(explore.normaliseCloud([]), []);
  assert.deepEqual(explore.normaliseCloud([[3, 3, 3]]), [[0, 0, 0]]);
  assert.deepEqual(explore.normaliseCloud([[1, 2, 3], [1, 2, 3], [1, 2, 3]]),
    [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(explore.normaliseCloud([null, null]), [null, null]);
});

test('column3dFor pairs a 2d column with its 3d sibling', () => {
  assert.equal(explore.column3dFor('thematic', ['thematic_2d', 'thematic_3d']), 'thematic_3d');
  assert.equal(explore.column3dFor('foo', ['foo_2d']), null);
  assert.equal(explore.column3dFor('Bad-Name', ['Bad-Name_3d']), null);
});

test('mapPayload serves normalised coords3 and has3d', async () => {
  const id = await mkSong('ZZZEXP Coords3');
  await addCoords(id);
  const p = await explore.mapPayload(pool);
  assert.equal(p.spaces.find(s => s.key === 'thematic').has3d, true);
  const song = p.songs.find(s => s.id === id);
  assert.equal(song.coords3.thematic.length, 3);
  for (const v of song.coords3.thematic) {
    assert.ok(Number.isFinite(v) && Math.abs(v) <= 1, 'finite and normalised');
  }
  assert.ok(!('semantic' in song.coords3), 'no 3D coordinates for a hidden space');
});

test('themeSubCounts counts distinct codebook codes per sub-dimension', () => {
  const m = explore.themeSubCounts('themes', [
    { code: 'captivity' }, { code: 'captivity' }, { code: 'slaughter' }, { code: 'speciesism' },
    { code: 'not_a_code' }, {}, null,
  ]);
  assert.equal(m.get('cruelty_suffering'), 2);
  assert.equal(m.get('psychology_barriers'), 1);
  assert.equal(m.size, 2);
  assert.equal(explore.themeSubCounts('themes', null).size, 0);
  assert.equal(explore.themeSubCounts('themes', 'junk').size, 0);
});

test('themeBucket: most codes wins; a tie goes to the rarer sub-dimension, then taxonomy order', () => {
  assert.equal(explore.themeBucket(new Map([['a', 3], ['b', 1]])), 'a');
  assert.equal(explore.themeBucket(new Map()), explore.NOT_CODED);
  assert.equal(explore.themeBucket(new Map([['a', 1]])), 'a');
  const tie = new Map([['a', 2], ['b', 2]]);
  // fewer songs touch b, so b wins the tie
  assert.equal(explore.themeBucket(tie, new Map([['a', 100], ['b', 5]])), 'b');
  // equally rare: taxonomy order decides
  assert.equal(explore.themeBucket(tie, new Map([['a', 5], ['b', 5]]), ['b', 'a']), 'b');
  // nothing to go on: alphabetical, so the result is still deterministic
  assert.equal(explore.themeBucket(tie), 'a');
  // only the tied maximum competes: a sub-dimension with fewer codes never wins on rarity alone
  assert.equal(explore.themeBucket(new Map([['a', 3], ['b', 3], ['c', 1]]),
    new Map([['a', 50], ['b', 40], ['c', 1]])), 'b');
});

test('theme colour-by via mapPayload: bucket, subs, legend order and palette fit', async () => {
  const a = await mkSong('ZZZEXP Theme A');
  await addCoords(a);
  await addAnalysis(a, { themes: codes('captivity', 'slaughter', 'speciesism') });
  const b = await mkSong('ZZZEXP Theme B');
  await addCoords(b);
  await addAnalysis(b, { themes: codes('captivity', 'speciesism') });
  const c = await mkSong('ZZZEXP Theme C');
  await addCoords(c);
  // tactics mirrors advocacy and is never read: a tactics-only song has no theme finding
  await addAnalysis(c, { tactics: codes('underground_rescue') });

  const p = await explore.mapPayload(pool);
  const sa = p.songs.find(s => s.id === a);
  const sb = p.songs.find(s => s.id === b);
  const sc = p.songs.find(s => s.id === c);
  assert.equal(sa.codes.themes, 'cruelty_suffering');
  assert.deepEqual(sa.subs.themes, ['cruelty_suffering', 'psychology_barriers']);
  // B ties 1-1 between two sub-dimensions: the rarer one on the map wins (taxonomy order if equal)
  const touching = (sub) => p.songs.filter(s => (s.subs.themes || []).includes(sub)).length;
  const [first, second] = ['cruelty_suffering', 'psychology_barriers'];   // taxonomy order
  const expected = touching(second) < touching(first) ? second : first;
  assert.equal(sb.codes.themes, expected);
  assert.deepEqual(sb.subs.themes, ['cruelty_suffering', 'psychology_barriers'],
    'a tied song still carries both, so spotlighting either one lights it');
  assert.ok(!p.songs.some(s => s.codes.themes === 'MIXED'), 'no song is left Mixed');
  assert.equal(sc.codes.themes, explore.NOT_CODED);
  assert.ok(!sc.subs || !('themes' in sc.subs), 'no theme finding -> no subs entry');
  assert.equal(sc.codes.actions, explore.NOT_CODED, 'tactics is never read for actions');

  const legend = p.colourBy.find(l => l.key === 'themes');
  assert.equal(legend.label, 'Themes');
  assert.ok(legend.codes.every(e => e.count > 0), 'only present buckets are listed');
  const cruelty = legend.codes.find(e => e.code === 'cruelty_suffering');
  assert.equal(cruelty.label, 'Bodily Harm, Confinement & Suffering');
  assert.ok(!legend.codes.some(e => e.code === 'MIXED'), 'there is no Mixed entry any more');
  assert.equal(legend.codes[legend.codes.length - 1].code, explore.NOT_CODED, 'Not coded last');
  assert.ok(cruelty, 'sub-dimensions are listed');
  for (const key of ['themes', 'targets', 'actions', 'moral_frames']) {
    const l = p.colourBy.find(x => x.key === key);
    assert.ok(l, `${key} is in the colour-by menu`);
    assert.ok(l.codes.length <= 5, `${key} legend (<= 4 sub-dimensions + Not coded) fits the palette`);
    // the legend counts colour buckets, but a pick lights every song that touches it: say so
    assert.match(l.note, /touches/i, `${key} carries the usage note`);
  }
  assert.equal(p.colourBy.find(x => x.key === 'genre').note, undefined, 'other dimensions carry no note');
});

test('genreTopSet picks the top-N named parents and never the literal other', () => {
  // Synthetic rows, independent of the live catalogue: metal(4) > hardcore(3) > punk(2) >
  // folk(1). 'christian' maps to the literal 'other' parent and is given the highest count
  // of all, to prove it is excluded from the ranking regardless of count.
  const rows = [
    ...Array(4).fill({ genre: 'metalcore' }),  // -> metal
    ...Array(3).fill({ genre: 'hardcore' }),   // -> hardcore
    ...Array(2).fill({ genre: 'punk' }),       // -> punk
    { genre: 'folk' },                         // -> folk (outside the top 3)
    ...Array(5).fill({ genre: 'christian' }),  // -> other (literal parent, never ranked)
    { genre: null },                           // -> NOT_CODED
  ];
  const top = explore.genreTopSet(rows);

  assert.ok(top.has('metal'));
  assert.ok(top.has('hardcore'));
  assert.ok(top.has('punk'));
  assert.ok(!top.has('folk'), 'a genre outside the top 3 gets no colour slot');
  assert.ok(!top.has('other'), 'the literal other parent is never ranked, whatever its count');
  assert.ok(!top.has(explore.NOT_CODED));
  assert.equal(top.size, 3);
});

test('the genre legend names every genre, nesting the small ones under Other genres', () => {
  const rows = [
    ...Array(4).fill({ genre: 'metalcore' }),
    ...Array(3).fill({ genre: 'hardcore' }),
    ...Array(2).fill({ genre: 'punk' }),
    { genre: 'folk' },
    ...Array(5).fill({ genre: 'christian' }),  // -> other
    { genre: null },
  ];
  const codes = explore.legendFor(
    { key: 'genre', label: 'Genre', source: 'genre' }, rows, explore.genreTopSet(rows));

  // Top 3 are their own entries, in count order, with no children.
  assert.deepEqual(codes.slice(0, 3).map(c => c.code), ['metal', 'hardcore', 'punk']);
  assert.equal(codes[0].count, 4);
  assert.ok(!codes[0].children, 'a top-3 genre is a leaf');

  // Then the group, carrying its members. Its count is the sum of theirs.
  const group = codes.find(c => c.code === explore.OTHER_GENRES);
  assert.ok(group, 'the Other genres group exists');
  assert.equal(group.label, 'Other genres');
  assert.equal(group.count, 6, 'folk(1) + other(5)');
  assert.deepEqual(group.children.map(c => c.code), ['other', 'folk'],
    'members sort by descending count');
  assert.equal(group.children[0].label, 'Unclassified genre',
    'the literal other parent is NOT labelled "Other" inside a group called "Other genres"');
  assert.equal(group.children[1].label, 'Folk');

  // Not coded stays its own last entry and is never swept into the group.
  const last = codes[codes.length - 1];
  assert.equal(last.code, explore.NOT_CODED);
  assert.equal(last.count, 1);
  assert.ok(!group.children.some(c => c.code === explore.NOT_CODED));
});

test('a song carries its raw parent genre, so a small genre can be spotlit by name', async () => {
  const folkId = await mkSong('ZZZEXP Folk', { genre: 'folk' });
  await addCoords(folkId);

  const p = await explore.mapPayload(pool);
  const song = p.songs.find(s => s.id === folkId);

  assert.equal(song.codes.genre, 'folk',
    'raw parent genre, not OTHER_GENRES — the spotlight targets this value');

  // And that raw code is reachable in the legend: either as its own entry or as a
  // named child of the group. This is the invariant — a dot is always explained.
  const genre = p.colourBy.find(c => c.key === 'genre');
  const flat = genre.codes.flatMap(c => [c, ...(c.children || [])]);
  assert.ok(flat.some(c => c.code === 'folk'), 'every raw code appears in its own legend');
});

test('genre colour-by via mapPayload: no-genre stays NOT_CODED, legend fits the palette, ' +
  'and every song codes.genre is in its own legend', async () => {
  // This test goes through the real DB/mapPayload path, so it deliberately asserts only
  // structural properties that hold no matter what the live catalogue's genre distribution
  // is — never "genre X is/isn't in the top 3", which the pure genreTopSet test above already
  // covers deterministically.
  const noGenreId = await mkSong('ZZZEXP Genre none');
  await addCoords(noGenreId);

  const p = await explore.mapPayload(pool);
  const genreLegend = p.colourBy.find(c => c.key === 'genre');
  const topLevelCodes = genreLegend.codes.map(c => c.code);
  // Flattened view: every top-level entry plus any children of the Other genres group.
  // This is what "in the legend" means now that small genres are named, not folded away.
  const flatCodes = genreLegend.codes.flatMap(c => [c.code, ...(c.children || []).map(ch => ch.code)]);

  // At most 5 top-level entries: 3 named genres + "Other genres" + "Not coded" is the
  // palette budget. Members nested inside "Other genres" don't count against this — the
  // palette caps colour slots, not how many genres are named.
  assert.ok(genreLegend.codes.length <= 5, `genre legend fits the palette, got ${topLevelCodes}`);
  assert.ok(!topLevelCodes.includes('other'),
    'the literal other parent never appears as its own TOP-LEVEL bucket');

  // Not coded is present (this fixture guarantees it) and sorts last; if Other genres is
  // present it sits immediately before Not coded.
  assert.ok(topLevelCodes.includes(explore.NOT_CODED));
  assert.equal(topLevelCodes[topLevelCodes.length - 1], explore.NOT_CODED, 'Not coded sorts last');
  const otherIdx = topLevelCodes.indexOf(explore.OTHER_GENRES);
  if (otherIdx !== -1) {
    assert.equal(otherIdx, topLevelCodes.length - 2, 'Other genres sits immediately before Not coded');
    const otherEntry = genreLegend.codes[otherIdx];
    assert.equal(otherEntry.label, explore.OTHER_GENRES_LABEL);
  }

  // No genre at all still buckets to NOT_CODED, not Other genres.
  const noGenreSong = p.songs.find(s => s.id === noGenreId);
  assert.equal(noGenreSong.codes.genre, explore.NOT_CODED);

  // The invariant: every song's codes.genre value appears somewhere in the genre legend,
  // either as a top-level entry or nested as a child of Other genres.
  for (const song of p.songs) {
    assert.ok(flatCodes.includes(song.codes.genre),
      `song ${song.id} codes.genre=${song.codes.genre} missing from genre legend ${flatCodes}`);
  }
});

test('a non-genre dimension is completely unaffected by the genre fold', async () => {
  const a = await mkSong('ZZZEXP NonGenre A');
  await addCoords(a);
  await addAudio(a, { sonic_intensity: 'HEAVY_INTENSE' });

  const b = await mkSong('ZZZEXP NonGenre B');
  await addCoords(b);
  await addAudio(b, { sonic_intensity: 'INTIMATE_SPARSE' });

  const c = await mkSong('ZZZEXP NonGenre C');
  await addCoords(c);
  await addAudio(c, { sonic_intensity: null });

  const p = await explore.mapPayload(pool);
  const energy = p.colourBy.find(c => c.key === 'sonic_intensity');
  const codes = energy.codes.map(x => x.code);

  assert.ok(codes.includes('HEAVY_INTENSE'), 'fixture code A is in the legend');
  assert.ok(codes.includes('INTIMATE_SPARSE'), 'fixture code B is in the legend');
  assert.ok(!codes.includes('OTHER_GENRES'), 'the genre-only fold bucket never leaks in here');

  const songA = p.songs.find(s => s.id === a);
  const songB = p.songs.find(s => s.id === b);
  const songC = p.songs.find(s => s.id === c);
  assert.equal(songA.codes.sonic_intensity, 'HEAVY_INTENSE');
  assert.equal(songB.codes.sonic_intensity, 'INTIMATE_SPARSE');
  assert.equal(songC.codes.sonic_intensity, explore.NOT_CODED);
});

// The message tab reads the analysis project's 1188-dim lyric-hybrid vector (qualitative codes + centred BGE-M3),
// the same vector behind the Thematic space of the Explore map.
async function addLyricEmbedding(songId, vec) {
  await makeEligible(songId);
  await pool.query(
    `INSERT INTO song_embeddings (song_id, lyric_hybrid_embedding, updated_at)
     VALUES ($1, $2::float8[], now())
     ON CONFLICT (song_id) DO UPDATE SET lyric_hybrid_embedding = EXCLUDED.lyric_hybrid_embedding`,
    [songId, vec]);
}
const lyricHybrid = (...lead) => { const v = new Array(1188).fill(0); lead.forEach((x, i) => { v[i] = x; }); return v; };

test('message similarity is cosine over the 1188-dim lyric-hybrid embedding, ranks by cosine and respects the publish filter', async () => {
  const entry = explore.SIMILARITY.find(s => s.key === 'message');
  assert.equal(entry.column, 'lyric_hybrid_embedding');
  assert.equal(entry.metric, 'cosine');
  assert.equal(entry.dims, 1188);

  const target = await mkSong('ZZZEXP Target');
  const near = await mkSong('ZZZEXP Near');
  const far = await mkSong('ZZZEXP Far');
  const hidden = await mkSong('ZZZEXP Hidden', { published: false });
  const wrongLength = await mkSong('ZZZEXP Message wronglen');
  const legacyOnly = await mkSong('ZZZEXP Message legacy');

  // `near` points almost the same way as the target, `far` is orthogonal.
  await addLyricEmbedding(target, lyricHybrid(1, 0, 0));
  await addLyricEmbedding(near, lyricHybrid(0.98, 0.2, 0));
  await addLyricEmbedding(far, lyricHybrid(0, 1, 0));
  await addLyricEmbedding(hidden, lyricHybrid(1, 0, 0));   // a perfect match, but unpublished
  await addLyricEmbedding(wrongLength, [1, 0, 0]);          // a perfect direction, but not 1188-dim
  // A song holding only the older lyric_embedding has nothing to compare.
  await makeEligible(legacyOnly);
  await pool.query(
    `INSERT INTO song_embeddings (song_id, lyric_embedding, updated_at) VALUES ($1, $2::float8[], now())
     ON CONFLICT (song_id) DO UPDATE SET lyric_embedding = EXCLUDED.lyric_embedding`,
    [legacyOnly, [1, 0, 0]]);

  const rows = await explore.similarByEmbedding(pool, target, entry, 5000);
  const ids = rows.map(r => r.id);

  assert.ok(!ids.includes(target), 'the song itself is excluded');
  assert.ok(!ids.includes(hidden), 'unpublished songs are excluded');
  assert.ok(!ids.includes(wrongLength), 'a vector of the wrong length never enters the comparison');
  assert.ok(!ids.includes(legacyOnly), 'the older lyric_embedding is ignored');
  assert.ok(ids.indexOf(near) < ids.indexOf(far), 'nearer song ranks first');
});

// The new audio embedding: one 574-dim hybrid vector per song, built by the analysis project.
async function addHybridEmbedding(songId, vec) {
  await pool.query(
    `INSERT INTO song_embeddings (song_id, audio_hybrid_embedding, updated_at)
     VALUES ($1, $2::float8[], now())
     ON CONFLICT (song_id) DO UPDATE SET audio_hybrid_embedding = EXCLUDED.audio_hybrid_embedding`,
    [songId, vec]);
}
const hybrid = (...lead) => { const v = new Array(574).fill(0); lead.forEach((x, i) => { v[i] = x; }); return v; };

test('sound similarity is cosine over the 574-dim hybrid embedding and ignores other lengths and the legacy column', async () => {
  const entry = explore.SIMILARITY.find(s => s.key === 'sound');
  assert.equal(entry.column, 'audio_hybrid_embedding');
  assert.equal(entry.metric, 'cosine');
  assert.equal(entry.dims, 574);

  const target = await mkSong('ZZZEXP Sound target');
  const near = await mkSong('ZZZEXP Sound near');
  const far = await mkSong('ZZZEXP Sound far');
  const wrongLength = await mkSong('ZZZEXP Sound wronglen');
  const legacyOnly = await mkSong('ZZZEXP Sound legacy');

  await addHybridEmbedding(target, hybrid(1, 0, 0));
  await addHybridEmbedding(near, hybrid(0.98, 0.2, 0));
  await addHybridEmbedding(far, hybrid(0, 1, 0));
  await addHybridEmbedding(wrongLength, [1, 0, 0]);          // a perfect direction, but not 574-dim
  // A song holding only the retired audio_embedding has nothing to compare.
  await pool.query(
    `INSERT INTO song_embeddings (song_id, audio_embedding, updated_at) VALUES ($1, $2::float8[], now())
     ON CONFLICT (song_id) DO UPDATE SET audio_embedding = EXCLUDED.audio_embedding`,
    [legacyOnly, [1, 0, 0, 0, 0, 0]]);

  const rows = await explore.similarByEmbedding(pool, target, entry, 500);
  const ids = rows.map(r => r.id);

  assert.ok(!ids.includes(target), 'the song itself is excluded');
  assert.ok(!ids.includes(wrongLength), 'a vector of the wrong length never enters the comparison');
  assert.ok(!ids.includes(legacyOnly), 'the legacy audio_embedding is ignored');
  assert.ok(ids.includes(near) && ids.includes(far));
  assert.ok(ids.indexOf(near) < ids.indexOf(far), 'the nearer direction ranks first');
});

test('a song whose hybrid embedding is the wrong length has no sound neighbours', async () => {
  const odd = await mkSong('ZZZEXP Sound odd target');
  await addHybridEmbedding(odd, [1, 0, 0]);
  const entry = explore.SIMILARITY.find(s => s.key === 'sound');
  const rows = await explore.similarByEmbedding(pool, odd, entry, 10);
  assert.deepEqual(rows, []);
});

test('similarFor omits a tab with no embedding and falls back to genre when both are missing', async () => {
  // A song with neither embedding, sharing a genre with two others.
  const lonely = await mkSong('ZZZEXP Lonely', { genre: 'zzzexp-genre' });
  const mate1 = await mkSong('ZZZEXP Mate one', { genre: 'zzzexp-genre' });
  const mate2 = await mkSong('ZZZEXP Mate two', { genre: 'zzzexp-genre' });

  const none = await explore.similarFor(pool, lonely, 6);
  assert.deepEqual(none.tabs, [], 'no embeddings means no tabs');
  assert.ok(none.fallback, 'the genre fallback fires');
  assert.equal(none.fallback.label, 'More in this genre');
  const fallbackIds = none.fallback.songs.map(s => s.id);
  assert.ok(fallbackIds.includes(mate1) && fallbackIds.includes(mate2));
  assert.ok(!fallbackIds.includes(lonely), 'the song itself is excluded');

  // A song with only a lyric embedding gets one tab and no fallback.
  const messageOnly = await mkSong('ZZZEXP Message only');
  await addLyricEmbedding(messageOnly, lyricHybrid(1, 0, 0));
  const one = await explore.similarFor(pool, messageOnly, 6);
  assert.deepEqual(one.tabs.map(t => t.key), ['message']);
  assert.equal(one.fallback, null, 'no fallback when at least one tab exists');
});

test('mapPayload serves labels2d and labels3d per space', async () => {
  const p = await explore.mapPayload(pool);
  for (const s of p.spaces) {
    assert.ok(Array.isArray(s.labels2d), `${s.key} labels2d`);
    assert.ok(Array.isArray(s.labels3d), `${s.key} labels3d`);
    for (const l of s.labels2d) {
      assert.ok(typeof l.label === 'string' && l.label.length > 0);
      assert.equal(l.centre.length, 2);
      assert.ok(l.centre.every(Number.isFinite));
      assert.ok([1, 2].includes(l.level), 'level 1 coarse or 2 fine');
      assert.ok(Number.isInteger(l.count) && l.count >= (l.level === 1 ? 15 : 10));
    }
    if (!s.has3d) assert.deepEqual(s.labels3d, []);
    for (const l of s.labels3d) {
      assert.equal(l.centre.length, 3);
      assert.ok(l.centre.every(v => Number.isFinite(v) && Math.abs(v) <= 1), '3D centre is normalised');
    }
  }
});

test('labels are stable between payload builds', async () => {
  const a = await explore.mapPayload(pool);
  const b = await explore.mapPayload(pool);
  for (let i = 0; i < a.spaces.length; i++) {
    assert.ok(Array.isArray(a.spaces[i].labels2d), 'labels exist, so equality is not vacuous');
    assert.deepEqual(a.spaces[i].labels2d, b.spaces[i].labels2d);
    assert.deepEqual(a.spaces[i].labels3d, b.spaces[i].labels3d);
  }
});

test('labelItems keeps only mapped songs and codebook-known terms', () => {
  const rows = [
    { thematic_2d: [1, 2], genre: 'folk', themes: [{ code: 'captivity' }, { code: 'not_a_real_code' }], topics: [], advocacy: [], moral_frames: [] },
    { thematic_2d: null, genre: 'folk', themes: [{ code: 'captivity' }], topics: [], advocacy: [], moral_frames: [] },
    { thematic_2d: [3, 4], genre: null, themes: [], topics: [], advocacy: [], moral_frames: [] },
  ];
  const items = explore.labelItems(rows, { column: 'thematic_2d' }, '2d', null);
  assert.equal(items.length, 2, 'the unmapped row is absent');
  assert.deepEqual(items[0].terms, ['themes:captivity'], 'unknown codes are dropped');
  assert.equal(items[0].genre, 'folk');
  assert.equal(items[1].genre, null);
  const other = explore.labelItems(
    [{ thematic_2d: [1, 1], genre: 'zzzexp-unmapped-genre', themes: [], topics: [], advocacy: [], moral_frames: [] }],
    { column: 'thematic_2d' }, '2d', null);
  assert.equal(other[0].genre, null, 'a genre the site does not classify (other) is not a label term');
});

after(async () => {
  if (made.songs.length) {
    await pool.query('DELETE FROM song_coordinates WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM song_lyrics WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM song_lyric_analysis WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM song_embeddings WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM songs WHERE id = ANY($1::int[])', [made.songs]);
  }
  await pool.end();
});
