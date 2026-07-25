const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const analysis = require('../services/analysis');

// Unique fixture sentinel per test file: ZZZANL.

test('model selection is by latest pass, not a fixed constant', () => {
  assert.equal(analysis.CODE_MODEL, undefined, 'CODE_MODEL removed');
  assert.equal(analysis.SCALAR_MODEL, undefined, 'SCALAR_MODEL removed');
  assert.equal(analysis.ANY_TIER_SQL, undefined, 'ANY_TIER_SQL removed');
  assert.ok(analysis.LATEST_ANALYSIS.includes('DISTINCT ON (song_id)'), 'LATEST_ANALYSIS picks one row per song');
  assert.ok(analysis.hasAnalysisExists('s').includes('EXISTS'));
});

test('taxonomy exposes the five evidence dimensions with labels', () => {
  assert.ok(Array.isArray(analysis.taxonomy.themes));
  // topics column is displayed as "targets"; taxonomy stores it under "targets"
  assert.equal(analysis.label('themes', 'killing'), 'Killing');
  assert.equal(analysis.label('topics', 'slaughterhouses'), 'Slaughterhouses');
  assert.equal(analysis.label('advocacy', 'boycott'), 'Boycott');
  // unknown code falls back to de-snake-cased Title Case
  assert.equal(analysis.label('themes', 'some_new_code'), 'Some New Code');
});

// Helpers: insert songs with the ZZZANL sentinel, each with a single "latest pass" row.
const MODEL = 'gemini-3.5-flash-lite'; // any string; single row per fixture song

async function mkSong(title) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ($1, 'included', true, 'manual') RETURNING id`, [title])).rows[0].id;
}

// Insert ONE analysis row (the new "complete pass" model). Fields default to empty.
async function addAnalysis(songId, fields = {}, { model = MODEL, analyzedAt = '2026-07-25 10:00:00' } = {}) {
  const f = {
    explanation: null, themes: '[]', topics: '[]', advocacy: '[]', tactics: '[]', moral_frames: '[]',
    perspective: null, lyrical_tone: null, intensity: null, clarity: null, focus_amount: null,
    target_audience: null, emotions: [], ...fields,
  };
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, analyzed_at, explanation, themes, topics, advocacy, tactics, moral_frames,
        perspective, lyrical_tone, intensity, clarity, focus_amount, target_audience, emotions)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::text[])`,
    [songId, model, analyzedAt, f.explanation, f.themes, f.topics, f.advocacy, f.tactics, f.moral_frames,
     f.perspective, f.lyrical_tone, f.intensity, f.clarity, f.focus_amount, f.target_audience, f.emotions]);
}

const CODED = {
  explanation: 'Test explanation.',
  themes: JSON.stringify([{ code: 'killing', evidence: 'ground beef' }]),
  topics: JSON.stringify([{ code: 'cows', evidence: 'Run cows run' }]),
  perspective: 'MORAL_ACCUSER_JUDGE', lyrical_tone: 'CONDESCENDING_SNARK_AND_SATIRE',
  intensity: 'MORAL_OUTRAGE_AND_CONDEMNATION', clarity: 'SYSTEMIC_COMMODIFICATION_CRITIQUE',
  focus_amount: 'CENTRAL_THESIS', target_audience: 'HYPOCRITES_AND_SELF_DECEIVERS',
  emotions: ['MORAL_OUTRAGE', 'SARDONIC_MOCKERY'],
};

async function mkCodedSong() {
  const id = await mkSong('ZZZANL Coded');
  await addAnalysis(id, CODED);
  return id;
}

test('getSongAnalysis returns the full coding with display labels', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  assert.equal(a.perspective, 'MORAL_ACCUSER_JUDGE'); // raw code still exposed
  assert.equal(a.themes[0].code, 'killing');
  assert.equal(a.themes[0].label, 'Killing');
  assert.equal(a.themes[0].evidence, 'ground beef');
  // enriched from the taxonomy hierarchy
  assert.equal(a.themes[0].sub_dimension, 'cruelty_suffering');
  assert.equal(a.themes[0].sub_dimension_label, 'Bodily Harm, Confinement & Suffering');
  assert.equal(a.themes[0].group, 'violence');
  // topics column surfaces as "targets"
  assert.equal(a.targets[0].code, 'cows');
  assert.equal(a.targets[0].label, 'Cows');
  assert.equal(a.targets[0].sub_dimension, 'farmed_domesticated');
  assert.deepEqual(a.actions, []);
});

test('getSongAnalysis enriches each code with its taxonomy definition', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  assert.equal(typeof a.themes[0].definition, 'string');
  assert.ok(a.themes[0].definition.length > 0, 'killing has a non-empty definition');
});

test('getSongAnalysis resolves scalar attributes to codebook labels with definitions', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  const byLabel = Object.fromEntries(a.attributes.map(x => [x.label, x.value]));
  assert.equal(byLabel['Perspective'], 'Moral Accuser');
  assert.equal(byLabel['Tone'], 'Satirical & Sarcastic');
  assert.equal(byLabel['Focus'], 'Central Thesis');
  assert.equal(byLabel['Audience'], 'Hypocritical Animal Lovers');
  assert.ok(a.attributes.every(x => x.value), 'no null/empty attributes leak in');
  const persp = a.attributes.find(x => x.label === 'Perspective');
  assert.ok(persp.definition.length > 0, 'definition carried for the tooltip');
  // emotions arrive as display labels, not raw codes
  assert.deepEqual(a.emotions, ['Moral Outrage', 'Sardonic Mockery']);
});

test('getSongAnalysis returns null for an un-coded song', async () => {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL Uncoded', 'included', true, 'manual') RETURNING id`)).rows[0];
  assert.equal(await analysis.getSongAnalysis(pool, s.id), null);
});

test('getSongAnalysis returns chips only when the latest row has only thematic codes', async () => {
  const id = await mkSong('ZZZANL CodeOnly');
  await addAnalysis(id, { themes: CODED.themes, topics: CODED.topics, explanation: 'Test explanation.' });
  const a = await analysis.getSongAnalysis(pool, id);
  assert.equal(a.themes[0].code, 'killing');
  assert.deepEqual(a.attributes, [], 'no scalar row -> no attributes');
  assert.deepEqual(a.emotions, []);
  assert.equal(a.explanation, 'Test explanation.');
});

test('getSongAnalysis returns attributes only when the latest row has only scalars', async () => {
  const id = await mkSong('ZZZANL ScalarOnly');
  await addAnalysis(id, {
    perspective: CODED.perspective, lyrical_tone: CODED.lyrical_tone, intensity: CODED.intensity,
    clarity: CODED.clarity, focus_amount: CODED.focus_amount, target_audience: CODED.target_audience,
    emotions: CODED.emotions,
  });
  const a = await analysis.getSongAnalysis(pool, id);
  assert.ok(a, 'scalar-only song still has an analysis');
  assert.deepEqual(a.themes, [], 'no code row -> no chips');
  assert.ok(!a.explanation, 'no explanation on a scalar-only pass');
  assert.equal(a.attributes.length, 6, 'all six single-valued components present');
});

test('getSongAnalysis drops suppressed scalar values', async () => {
  const id = await mkSong('ZZZANL Suppressed');
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, perspective, focus_amount, target_audience, emotions,
        themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'MORAL_ACCUSER_JUDGE', 'ABSENCE_OF_FOCUS', 'UNSPECIFIED', ARRAY[]::text[],
             '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [id, MODEL]);
  const a = await analysis.getSongAnalysis(pool, id);
  const labels = a.attributes.map(x => x.label);
  assert.ok(labels.includes('Perspective'));
  assert.ok(!labels.includes('Focus'), 'ABSENCE_OF_FOCUS suppressed');
  assert.ok(!labels.includes('Audience'), 'UNSPECIFIED suppressed');
});

// A pipeline re-run has previously written typo'd codes and prompt-template artifacts into
// these columns. Display must drop them rather than Title-Case them onto a public page.
test('getSongAnalysis drops off-codebook scalar values instead of showing them', async () => {
  const id = await mkSong('ZZZANL OffCodebook');
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, perspective, intensity, clarity, emotions,
        themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'EXACT_ENUM_CODE_KEY', 'VISVERAL_HORROR_AND_ABJECTION',
             'SYSTEMIC_COMMODIFICATION_CRITIQUE', ARRAY['MORAL_OUTRAGE','NOT_A_REAL_EMOTION'],
             '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [id, MODEL]);
  const a = await analysis.getSongAnalysis(pool, id);
  const labels = a.attributes.map(x => x.label);
  assert.ok(!labels.includes('Perspective'), 'template artifact dropped, not title-cased');
  assert.ok(!labels.includes('Intensity'), 'typo code dropped');
  assert.ok(labels.includes('Clarity'), 'the valid sibling still renders');
  assert.deepEqual(a.emotions, ['Moral Outrage'], 'unknown emotion dropped, valid one kept');
  // nothing rendered may be raw or invented text
  assert.ok(a.attributes.every(x => !/[A-Z]{2,}_/.test(x.value)));
});

test('facetTree returns the hierarchy with distinct-song counts', async () => {
  await mkCodedSong(); // themes:[killing] (cruelty_suffering/violence), targets:[cows] (farmed_domesticated/mammals)
  const t = await analysis.facetTree(pool);
  assert.equal(t.themes.label, 'Core Sentiments & Themes');
  assert.ok(t.themes.count >= 1);
  const cruelty = t.themes.sub_dimensions.find(s => s.id === 'cruelty_suffering');
  assert.ok(cruelty && cruelty.count >= 1, 'cruelty_suffering sub-dim present');
  assert.equal(cruelty.label, 'Bodily Harm, Confinement & Suffering');
  const violence = cruelty.groups.find(g => g.id === 'violence');
  assert.ok(violence, 'violence group present');
  const killing = violence.codes.find(c => c.code === 'killing');
  assert.ok(killing && killing.count >= 1);
  assert.equal(killing.label, 'Killing');
  // empty nodes omitted
  assert.ok(t.themes.sub_dimensions.every(s => s.groups.length > 0));
  assert.ok(t.themes.sub_dimensions.every(s => s.groups.every(g => g.codes.length > 0)));
  // targets tree too
  const farmed = t.targets.sub_dimensions.find(s => s.id === 'farmed_domesticated');
  assert.ok(farmed.groups.find(g => g.id === 'mammals').codes.find(c => c.code === 'cows'));
});

test('facetFilterConditions builds AND clauses with mapped columns', () => {
  const { clauses, params, needsJoin } = analysis.facetFilterConditions(
    { themes: ['killing', 'suffering'], targets: ['cows'] }, 5);
  assert.equal(needsJoin, true);
  assert.equal(clauses.length, 3); // two themes + one target, all ANDed
  assert.ok(clauses.includes('sa.themes @> $5::jsonb'));
  assert.ok(clauses.includes('sa.themes @> $6::jsonb'));
  assert.ok(clauses.includes('sa.topics @> $7::jsonb')); // targets -> topics column
  assert.deepEqual(JSON.parse(params[0]), [{ code: 'killing' }]);
  assert.deepEqual(JSON.parse(params[2]), [{ code: 'cows' }]);
});

test('facetFilterConditions with no selections needs no join', () => {
  const r = analysis.facetFilterConditions({}, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
  assert.deepEqual(r.params, []);
});

test('themeCounts aggregates real themes from song_lyric_analysis', async () => {
  await mkCodedSong(); // themes:[killing]
  const rows = await analysis.themeCounts(pool, 15);
  const killing = rows.find(r => r.theme === 'killing');
  assert.ok(killing && killing.song_count >= 1);
  assert.equal(killing.label, 'Killing');
  assert.ok(rows.length <= 15);
});

test('facetTree rolls up two codes in the same group with distinct-song counts', async () => {
  // Live CODE_MODEL data already has plenty of coverage for the violence group's other
  // codes (e.g. systemic_violence), so we diff before/after our two fixture songs rather
  // than asserting on raw totals — isolates the property from live-data composition.
  const getViolence = async () => {
    const t = await analysis.facetTree(pool);
    const cruelty = t.themes.sub_dimensions.find(s => s.id === 'cruelty_suffering');
    const violence = cruelty.groups.find(g => g.id === 'violence');
    return {
      violence: violence.count,
      killing: (violence.codes.find(c => c.code === 'killing') || { count: 0 }).count,
      brutality: (violence.codes.find(c => c.code === 'brutality') || { count: 0 }).count,
    };
  };
  const before = await getViolence();

  // Song A: both violence codes; Song B: only killing. Group "violence" = 2 distinct songs.
  const a = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL TwoCode A', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $3, $2::jsonb, '[]', '[]', '[]', '[]')`,
    [a.id, JSON.stringify([{ code: 'killing', evidence: 'x' }, { code: 'brutality', evidence: 'y' }]), MODEL]);
  const b = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL TwoCode B', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $3, $2::jsonb, '[]', '[]', '[]', '[]')`,
    [b.id, JSON.stringify([{ code: 'killing', evidence: 'z' }]), MODEL]);

  const after = await getViolence();
  const dKilling = after.killing - before.killing;
  const dBrutality = after.brutality - before.brutality;
  const dViolence = after.violence - before.violence;
  // Distinct-song rollup: killing in A+B, brutality in A only, group = 2 distinct songs.
  assert.equal(dKilling, 2, 'killing counts both new songs');
  assert.equal(dBrutality, 1, 'brutality counts new song A only');
  // Discriminating: the violence group's count is the UNION of its codes' distinct songs.
  // A buggy occurrence-SUM rollup would instead add killing+brutality's occurrence deltas (3).
  assert.equal(dViolence, 2, 'group counts 2 new distinct songs, not 3 new occurrences');
  assert.ok(dViolence < dKilling + dBrutality, 'group delta is NOT occurrence sum of code deltas');
});

test('facetTree accepts a constraint that narrows the counted set', async () => {
  // One coded song with theme killing; constrain to a non-matching language -> zero counts.
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, language)
     VALUES ('ZZZANL Constrained', 'included', true, 'manual', ARRAY['English']) RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $3, $2::jsonb, '[]', '[]', '[]', '[]')`,
    [s.id, JSON.stringify([{ code: 'killing', evidence: 'x' }]), MODEL]);

  // Constrain to a language that no coded song has -> killing count unaffected by our new row.
  const constrained = await analysis.facetTree(pool, {
    joinSql: '', where: [`s.language && $1::text[]`], params: [['ZZZ-NoSuchLang']],
  });
  // themes dimension should have no 'killing' contribution from our English song under this constraint
  const cruelty = (constrained.themes.sub_dimensions || []).find(sd => sd.id === 'cruelty_suffering');
  const killing = cruelty && cruelty.groups.find(g => g.id === 'violence')?.codes.find(c => c.code === 'killing');
  const constrainedCount = killing ? killing.count : 0;

  const unconstrained = await analysis.facetTree(pool);
  const uKilling = unconstrained.themes.sub_dimensions.find(sd => sd.id === 'cruelty_suffering')
    .groups.find(g => g.id === 'violence').codes.find(c => c.code === 'killing');
  assert.ok(uKilling.count > constrainedCount, 'constraint reduces the counted set');
});

test('facetSelectionClauses: a group is one OR-term over its codes', () => {
  const { clauses, params, needsJoin } = analysis.facetSelectionClauses(
    { groups: ['themes:violence'] }, 1);
  assert.equal(needsJoin, true);
  assert.equal(clauses.length, 1, 'one term = one clause');
  // violence group = killing, brutality, systemic_violence (3 codes) -> parenthesised OR
  assert.match(clauses[0], /^\(sa\.themes @> \$1::jsonb OR sa\.themes @> \$2::jsonb OR sa\.themes @> \$3::jsonb\)$/);
  assert.equal(params.length, 3);
  const codes = params.map(p => JSON.parse(p)[0].code).sort();
  assert.deepEqual(codes, ['brutality', 'killing', 'systemic_violence']);
});

test('facetSelectionClauses: a sub-dimension ORs all its codes in one term', () => {
  const { clauses, params } = analysis.facetSelectionClauses(
    { subdims: ['themes:cruelty_suffering'] }, 1);
  assert.equal(clauses.length, 1);
  assert.ok(clauses[0].startsWith('(') && clauses[0].includes(' OR '));
  assert.ok(params.length > 3, 'cruelty_suffering spans several codes');
});

test('facetSelectionClauses: codes AND with a group term, indices sequential', () => {
  const { clauses, params, needsJoin } = analysis.facetSelectionClauses(
    { codes: { targets: ['cows'] }, groups: ['themes:violence'] }, 5);
  assert.equal(needsJoin, true);
  assert.equal(clauses.length, 2, 'one code term + one group term');
  assert.ok(clauses.includes('sa.topics @> $5::jsonb'), 'code term first, at startIndex');
  assert.ok(clauses.some(c => c.startsWith('(sa.themes @> $6::jsonb OR')), 'group term continues numbering');
  assert.equal(params.length, 4); // cows + 3 violence codes
});

test('facetSelectionClauses: empty selection needs no join', () => {
  const r = analysis.facetSelectionClauses({}, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
  assert.deepEqual(r.params, []);
});

test('scalarFacets counts distinct live songs per code, in codebook order', async () => {
  const id = await mkSong('ZZZANL Facet');
  // perspective MORAL_ACCUSER_JUDGE, emotions [MORAL_OUTRAGE, SARDONIC_MOCKERY]
  await addAnalysis(id, {
    perspective: CODED.perspective, lyrical_tone: CODED.lyrical_tone, intensity: CODED.intensity,
    clarity: CODED.clarity, focus_amount: CODED.focus_amount, target_audience: CODED.target_audience,
    emotions: CODED.emotions,
  });
  const f = await analysis.scalarFacets(pool, {});
  assert.equal(f.perspective.heading, 'Perspective');
  assert.equal(f.emotions.multi, true);
  const persp = f.perspective.options.find(o => o.code === 'MORAL_ACCUSER_JUDGE');
  assert.ok(persp && persp.count >= 1);
  const emo = f.emotions.options.find(o => o.code === 'SARDONIC_MOCKERY');
  assert.ok(emo && emo.count >= 1, 'array column is unnested for counting');
  // zero-count options are kept so the group shape is stable
  assert.ok(f.perspective.options.length > 1);
  // suppressed codes never appear as options
  assert.ok(!f.focus_amount.options.some(o => o.code === 'ABSENCE_OF_FOCUS'));
});

test('scalarFacets applies a per-component constraint', async () => {
  const id = await mkSong('ZZZANL FacetConstrained');
  await addAnalysis(id, {
    perspective: CODED.perspective, lyrical_tone: CODED.lyrical_tone, intensity: CODED.intensity,
    clarity: CODED.clarity, focus_amount: CODED.focus_amount, target_audience: CODED.target_audience,
    emotions: CODED.emotions,
  });
  await pool.query(`UPDATE songs SET language = ARRAY['ZZZ-NoSuchLang'] WHERE id = $1`, [id]);
  const constrained = await analysis.scalarFacets(pool, {
    perspective: { joinSql: '', where: [`s.language && $1::text[]`], params: [['ZZZ-NoSuchLang']] },
  });
  const only = constrained.perspective.options.find(o => o.code === 'MORAL_ACCUSER_JUDGE');
  assert.equal(only.count, 1, 'only the constrained song counts');
});

test('facetTree carries a description for every dimension', async () => {
  await mkCodedSong();
  const t = await analysis.facetTree(pool);
  for (const dim of ['themes', 'targets', 'actions', 'tactics', 'moral_frames']) {
    if (!t[dim]) continue; // dimension absent from this dataset — nothing to describe
    assert.equal(typeof t[dim].description, 'string');
    assert.ok(t[dim].description.length > 20, `${dim} has a real description`);
  }
});

test('scalarFacets carries a description for every component', async () => {
  const f = await analysis.scalarFacets(pool, {});
  for (const key of Object.keys(f)) {
    assert.ok(f[key].description.length > 20, `${key} has a real description`);
  }
});

test('getSongAnalysis exposes component and dimension descriptions for tooltips', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  const persp = a.attributes.find(x => x.label === 'Perspective');
  assert.ok(persp.component_description.length > 20, 'component description for the label tooltip');
  assert.notEqual(persp.component_description, persp.definition, 'component text differs from the code definition');
  assert.equal(typeof a.dimension_descriptions.themes, 'string');
  assert.ok(a.dimension_descriptions.moral_frames.length > 20);
});

after(async () => {
  await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZANL%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZANL%'`);
  await pool.end();
});
