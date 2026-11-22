const { test, after } = require('node:test');
const assert = require('node:assert');
const ref = require('../services/referenceCodebook');
const audioAnalysis = require('../services/audioAnalysis');
const taxonomy = require('../data/taxonomy.json');
const pool = require('../database/db');
const analysisModule = require('../services/analysis');

// Unique fixture sentinel per test file: ZZZREF.

test('catalogue lists all four thematic dimensions with descriptions', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.thematic.map(d => d.key),
    ['themes', 'targets', 'actions', 'moral_frames']);
  for (const d of c.thematic) {
    assert.ok(d.label, `${d.key} has a label`);
    assert.ok(d.description.length > 20, `${d.key} has a description`);
    assert.ok(d.sub_dimensions.length > 0, `${d.key} has sub-dimensions`);
  }
});

test('catalogue keeps every taxonomy term, including ones no song carries', () => {
  const c = ref.catalogue();
  // A term ID is unique within its dimension, not globally: the four dimensions are four
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

test('catalogue lists the six metadata components and hides the four absence codes', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.metadata.map(m => m.key), [
    'perspective', 'lyrical_tone', 'clarity',
    'focus_amount', 'target_audience', 'emotions',
  ]);
  assert.equal(c.metadata.find(m => m.key === 'target_audience').heading, 'Speaking to');
  const codes = c.metadata.flatMap(m => m.codes.map(x => x.code));
  for (const hidden of ['ABSENT', 'UNSPECIFIED']) {
    assert.ok(!codes.includes(hidden), `${hidden} must not be served`);
  }
  for (const m of c.metadata) {
    assert.ok(m.description.length > 20, `${m.key} has a description`);
    assert.ok(m.codes.every(x => x.definition.length > 0), `${m.key} codes are defined`);
  }
});

test('catalogue lists the seven audio dimensions and the samples, with both definitions and no hidden code', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.acoustic.map(a => a.key), [
    'musical_mood', 'sonic_intensity', 'production_texture', 'dynamic_arc',
    'vocal_style', 'rhythmic_feel', 'instrumentation', 'audio_samples',
  ]);
  assert.equal(c.acoustic.find(a => a.key === 'production_texture').heading, 'Production');
  for (const a of c.acoustic) {
    assert.ok(a.description.length > 20, `${a.key} has a description`);
    assert.ok(a.codes.length > 0, `${a.key} lists codes`);
    assert.ok(!('derivation_source' in a), `${a.key} carries no derivation source`);
    for (const code of a.codes) {
      assert.ok(code.definition.length > 0, `${a.key}/${code.code} has the AI definition`);
      assert.ok(code.listener.length > 0, `${a.key}/${code.code} has the listener description`);
      assert.ok(!('threshold' in code), 'no threshold');
      assert.equal(code.count, 0, 'catalogue() is count-free');
    }
  }
  const samples = c.acoustic.find(a => a.key === 'audio_samples').codes.map(x => x.code);
  assert.ok(!samples.includes('NONE'), 'the hidden NONE code is never listed');
  assert.deepEqual(c.objective.map(m => m.label), ['Tempo', 'Key', 'Loudness']);
  assert.ok(c.objective.every(m => m.description.length > 0));
});

const express = require('express');

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

const mkSong = async (title, published = true) => (await pool.query(
  `INSERT INTO songs (title, status, published, data_source) VALUES ($1, 'included', $2, 'manual') RETURNING id`,
  [title, published])).rows[0].id;

test('payload audio counts equal the browse sidebar counts, code for code', async () => {
  const p = await ref.payload(pool);
  const facets = await audioAnalysis.audioFacets(pool, {});
  for (const dim of p.acoustic) {
    const byCode = new Map((facets[dim.key].options || []).map(o => [o.code, o.count]));
    for (const code of dim.codes) {
      assert.equal(code.count, byCode.get(code.code) || 0, `${dim.key}/${code.code} agrees with the sidebar`);
    }
  }
  assert.ok(p.acoustic.find(a => a.key === 'musical_mood').codes.some(c => c.count > 0), 'some mood is in use');
});

test('a samples count only includes songs whose samples the curator approved', async () => {
  const code = 'FOUND_SOUND_OTHER';
  const count = async () => (await ref.payload(pool)).acoustic.find(a => a.key === 'audio_samples')
    .codes.find(c => c.code === code).count;
  const before = await count();
  const id = await mkSong('ZZZREF sample gate');
  try {
    await pool.query(
      `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, audio_samples)
       VALUES ($1, 'zzzref-audio', 'OK', NOW(), ARRAY[$2]::text[])`, [id, code]);
    assert.equal(await count(), before, 'an unreviewed song adds nothing');
    await pool.query('UPDATE songs SET show_audio_samples = false WHERE id = $1', [id]);
    assert.equal(await count(), before, 'a reviewed-and-hidden song adds nothing');
    await pool.query('UPDATE songs SET show_audio_samples = true WHERE id = $1', [id]);
    assert.equal(await count(), before + 1, 'approving it counts it');
  } finally {
    await pool.query('DELETE FROM song_audio_analysis WHERE song_id = $1', [id]);
    await pool.query('DELETE FROM songs WHERE id = $1', [id]);
  }
});

test('coverage.audio reports how many live songs have a sound analysis and which model made it', async () => {
  const { audio } = (await ref.payload(pool)).coverage;
  assert.ok(Number.isInteger(audio.analysed) && audio.analysed > 0);
  assert.ok(Array.isArray(audio.models) && audio.models.length > 0);
  assert.ok(audio.models.every(m => m.model && Number.isInteger(m.songs)));
  assert.equal(audio.models.reduce((n, m) => n + m.songs, 0), audio.analysed, 'each analysed song has one latest row');
  assert.ok(!Number.isNaN(Date.parse(audio.latest)), 'latest parses as a date');
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

// Mount the real router on an ephemeral port rather than assuming a server is running —
// the curator's :5000 may be serving older code, and we must not disturb it.
async function withServer(fn) {
  const app = express();
  app.use('/api/analysis', require('../routes/analysis'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(r => server.close(r));
  }
}

test('GET /api/analysis/codebook serves the whole reference payload', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/analysis/codebook`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.thematic.length, 4);
    assert.equal(body.metadata.length, 6);
    assert.equal(body.acoustic.length, 8);
    assert.equal(body.objective.length, 3);
    assert.ok(body.coverage.live_songs > 1000);
    const codes = body.metadata.flatMap(m => m.codes.map(c => c.code));
    assert.ok(!codes.includes('UNSPECIFIED'), 'suppressed codes never reach the wire');
  });
});
