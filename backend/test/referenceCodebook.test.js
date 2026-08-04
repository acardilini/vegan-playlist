const { test, after } = require('node:test');
const assert = require('node:assert');
const ref = require('../services/referenceCodebook');
const acb = require('../services/acousticCodebook');
const taxonomy = require('../data/taxonomy.json');
const pool = require('../database/db');
const analysisModule = require('../services/analysis');

// Unique fixture sentinel per test file: ZZZREF.

test('acousticCodebook exposes derivation source and per-code thresholds', () => {
  assert.match(acb.derivationSource('sonic_energy'), /Librosa/);
  assert.match(acb.derivationSource('tempo_bpm'), /Librosa/);
  assert.equal(acb.derivationSource('not_a_dimension'), '');
  assert.match(acb.codeThreshold('sonic_energy', 'EXPLOSIVE_HIGH_INTENSITY'), /RMS/);
  assert.equal(acb.codeThreshold('sonic_energy', 'NOT_A_CODE'), '');
});

test('catalogue lists all five thematic dimensions with descriptions', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.thematic.map(d => d.key),
    ['themes', 'targets', 'actions', 'tactics', 'moral_frames']);
  for (const d of c.thematic) {
    assert.ok(d.label, `${d.key} has a label`);
    assert.ok(d.description.length > 20, `${d.key} has a description`);
    assert.ok(d.sub_dimensions.length > 0, `${d.key} has sub-dimensions`);
  }
});

test('catalogue keeps every taxonomy term, including ones no song carries', () => {
  const c = ref.catalogue();
  // A term ID is unique within its dimension, not globally: the five dimensions are five
  // independent columns, and the curator deliberately uses e.g. `boycott` as both an Action
  // and a Tactic. So count per dimension.
  for (const d of c.thematic) {
    const codes = [];
    for (const sd of d.sub_dimensions) {
      for (const g of sd.groups) {
        for (const t of g.terms) {
          assert.ok(t.definition.length > 0, `${d.key}/${t.code} has a definition`);
          assert.equal(t.count, 0, 'catalogue() is count-free');
          codes.push(t.code);
        }
      }
    }
    const expected = taxonomy[d.key].length;
    assert.equal(codes.length, expected,
      `${d.key}: every taxonomy term appears, none dropped for being unused`);
    assert.equal(new Set(codes).size, codes.length,
      `${d.key}: no term is placed in two groups`);
  }
});

test('catalogue lists the seven metadata components and hides the four absence codes', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.metadata.map(m => m.key), [
    'perspective', 'lyrical_tone', 'intensity', 'clarity',
    'focus_amount', 'target_audience', 'emotions',
  ]);
  assert.equal(c.metadata.find(m => m.key === 'target_audience').heading, 'Speaking to');
  const codes = c.metadata.flatMap(m => m.codes.map(x => x.code));
  for (const hidden of ['THEMATIC_ABSENCE', 'ABSENCE_OF_FOCUS', 'INSUFFICIENT_DATA', 'UNSPECIFIED']) {
    assert.ok(!codes.includes(hidden), `${hidden} must not be served`);
  }
  for (const m of c.metadata) {
    assert.ok(m.description.length > 20, `${m.key} has a description`);
    assert.ok(m.codes.every(x => x.definition.length > 0), `${m.key} codes are defined`);
  }
});

test('catalogue lists six acoustic dimensions, each with a derivation source', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.acoustic.map(a => a.key), [
    'sonic_energy', 'emotional_mood', 'rhythmic_style',
    'acoustic_type', 'vocal_delivery', 'tempo_bpm',
  ]);
  for (const a of c.acoustic) {
    assert.ok(a.derivation_source.length > 0, `${a.key} names its derivation`);
    assert.ok(a.description.length > 20, `${a.key} has a description`);
  }
  const energy = c.acoustic.find(a => a.key === 'sonic_energy');
  assert.ok(energy.codes.every(x => x.threshold.length > 0), 'every energy code shows its threshold');
  // tempo is an integer, not an enum — it carries no codes.
  assert.deepEqual(c.acoustic.find(a => a.key === 'tempo_bpm').codes, []);
});

after(async () => { await pool.end(); });

test('payload fills real counts and keeps zero-count terms', async () => {
  const p = await ref.payload(pool);
  const allTerms = p.thematic.flatMap(d =>
    d.sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms)));

  assert.ok(allTerms.some(t => t.count > 0), 'some terms are in use');
  assert.ok(allTerms.some(t => t.count === 0), 'zero-count terms survive into the payload');
  assert.ok(allTerms.every(t => Number.isInteger(t.count)), 'counts are integers, not strings');

  // A dimension's count is the number of distinct songs carrying any of its terms, so it is
  // at least as large as its biggest term and no larger than the sum of them.
  for (const d of p.thematic) {
    const terms = d.sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms));
    const max = Math.max(0, ...terms.map(t => t.count));
    const sum = terms.reduce((n, t) => n + t.count, 0);
    assert.ok(d.count >= max, `${d.key}: dimension count >= largest term`);
    assert.ok(d.count <= sum, `${d.key}: dimension count <= sum of terms`);
  }
});

test('a term count matches a direct query for that code', async () => {
  const p = await ref.payload(pool);
  const term = p.thematic
    .find(d => d.key === 'targets')
    .sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms))
    .find(t => t.count > 0);
  assert.ok(term, 'targets has at least one coded term');

  const direct = (await pool.query(
    `SELECT COUNT(DISTINCT s.id)::int AS n
       FROM songs s
       JOIN ${analysisModule.LATEST_ANALYSIS} sa ON sa.song_id = s.id
       CROSS JOIN LATERAL jsonb_array_elements(sa.topics) AS elem
      WHERE s.status = 'included' AND s.published = true
        AND elem->>'code' = $1`, [term.code])).rows[0].n;
  assert.equal(term.count, direct, `${term.code} count matches a direct query`);
});

test('an unpublished song raises no count (the publish gate holds)', async () => {
  // ZZZREF fixture: an unpublished song carrying a known code, which must stay invisible.
  const code = 'factory_farming';
  const before = await termCount(code);

  const songId = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZREF publish gate', 'included', false, 'manual') RETURNING id`)).rows[0].id;
  try {
    await pool.query(
      `INSERT INTO song_lyric_analysis (song_id, topics, model_used, analyzed_at)
       VALUES ($1, $2::jsonb, 'ZZZREF-model', NOW())`,
      [songId, JSON.stringify([{ code }])]);
    assert.equal(await termCount(code), before, 'unpublished song did not raise the count');

    await pool.query('UPDATE songs SET published = true WHERE id = $1', [songId]);
    assert.equal(await termCount(code), before + 1, 'publishing it does raise the count');
  } finally {
    await pool.query('DELETE FROM song_lyric_analysis WHERE song_id = $1', [songId]);
    await pool.query('DELETE FROM songs WHERE id = $1', [songId]);
  }

  async function termCount(c) {
    const p = await ref.payload(pool);
    return p.thematic.find(d => d.key === 'targets')
      .sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms))
      .find(t => t.code === c).count;
  }
});

test('coverage reports live, analysed and mapped songs plus the latest-pass models', async () => {
  const c = (await ref.payload(pool)).coverage;
  assert.ok(c.live_songs > 1000, 'live songs looks like the real catalogue');
  assert.ok(c.artists > 100, 'artists counted');
  assert.ok(c.analysed_songs > 0 && c.analysed_songs <= c.live_songs);
  assert.ok(c.mapped_songs > 0 && c.mapped_songs <= c.live_songs);
  assert.ok(Array.isArray(c.latest_pass_models) && c.latest_pass_models.length > 0);
  assert.ok(c.latest_pass_models.every(m => m.model && Number.isInteger(m.songs)));
  // Ordered by song count, descending — the page renders them in this order.
  const counts = c.latest_pass_models.map(m => m.songs);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  // Every analysed song has exactly one latest pass.
  assert.equal(counts.reduce((a, b) => a + b, 0), c.analysed_songs);
  assert.ok(!Number.isNaN(Date.parse(c.latest_pass_at)), 'latest_pass_at parses as a date');
});
