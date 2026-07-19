const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const analysis = require('../services/analysis');

// Unique fixture sentinel per test file: ZZZANL.

test('DEFAULT_MODEL is gemma4:latest', () => {
  assert.equal(analysis.DEFAULT_MODEL, 'gemma4:latest');
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

// Helper: insert a coded song with the ZZZANL sentinel.
async function mkCodedSong() {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL Coded', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis
      (song_id, model_used, perspective, intensity, clarity, focus_amount, lyrical_tone,
       target_audience, emotions, explanation, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'gemma4:latest', 'animal_pov', 'high_confrontational', 'highly_explicit',
       'central_focus', 'confrontational_militant', 'corporate_exploiters',
       ARRAY['outrage'], 'Test explanation.',
       $2::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [s.id,
     JSON.stringify([{ code: 'killing', evidence: 'ground beef' }]),
     JSON.stringify([{ code: 'cows', evidence: 'Run cows run' }])]);
  return s.id;
}

test('getSongAnalysis returns the full coding with display labels', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  assert.equal(a.perspective, 'animal_pov');
  assert.deepEqual(a.emotions, ['outrage']);
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

test('getSongAnalysis resolves scalar attributes to display labels', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  assert.ok(Array.isArray(a.attributes));
  // fixture: intensity 'high_confrontational', clarity 'highly_explicit', focus 'central_focus'
  const byLabel = Object.fromEntries(a.attributes.map(x => [x.label, x.value]));
  assert.equal(byLabel['Intensity'], 'High/Confrontational');
  assert.equal(byLabel['Clarity'], 'Highly Explicit');
  assert.equal(byLabel['Focus'], 'Central Focus');
  // no null/empty attributes leak in
  assert.ok(a.attributes.every(x => x.value));
});

test('getSongAnalysis returns null for an un-coded song', async () => {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL Uncoded', 'included', true, 'manual') RETURNING id`)).rows[0];
  assert.equal(await analysis.getSongAnalysis(pool, s.id), null);
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

after(async () => {
  await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZANL%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZANL%'`);
  await pool.end();
});
