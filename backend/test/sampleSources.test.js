const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const audio = require('../services/audioAnalysis');
const curation = require('../services/curation');

// Unique fixture sentinel per test file: ZZZSMS. Deleting a song cascades its audio rows and its saved sample sources.

async function mkSong(title, { show = true } = {}) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, show_audio_samples, data_source)
     VALUES ($1,'included',true,$2,'manual') RETURNING id`, [title, show])).rows[0].id;
}

const A = { type: 'ADVOCATE_SPEECH_CLIP', timestamp: '0:44-1:19' };
const B = { type: 'ADVOCATE_SPEECH_CLIP', timestamp: '3:00-3:20' };
const C = { type: 'ANIMAL_SLAUGHTER_SFX', timestamp: '2:00-2:20' };
const DETAILS = [
  { ...A, description: 'A calm lecture.', transcript_excerpt: 'Eating animals acts as mirror.',
    speaker_or_source: 'ZZZSMS Maybe', identification_confidence: 'MEDIUM' },
  { ...B, description: 'Another lecture.', transcript_excerpt: 'Compassion is a choice.',
    speaker_or_source: null, identification_confidence: 'UNIDENTIFIED' },
  { ...C, description: 'Saws and mooing.', transcript_excerpt: null,
    speaker_or_source: 'ZZZSMS Doc', identification_confidence: 'HIGH' },
];

async function mkFixture(title, { show = true } = {}) {
  const id = await mkSong(title, { show });
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, musical_mood, sonic_intensity,
       production_texture, vocal_style, rhythmic_feel, instrumentation, audio_samples, dynamic_arc, sonic_summary,
       tempo_bpm, tempo_stability, musical_key, loudness_lufs, sample_details)
     VALUES ($1,'zzzsms-model','OK','2026-11-01T00:00:00Z',$2,'ENERGETIC_DRIVING','ELECTRONIC_SYNTHETIC',$3,
       'ELECTRONIC_MECHANICAL',$4,$5,'STEADY_GROOVE','A groove.',107,'STEADY','F major',-14.9,$6)`,
    [id, ['DEFIANT_ANTHEMIC'], ['SPOKEN_WORD'], ['DRUM_MACHINE_BEATS'],
      ['ADVOCATE_SPEECH_CLIP', 'ANIMAL_SLAUGHTER_SFX'], JSON.stringify(DETAILS)]);
  return id;
}
async function saveSource(id, s, source) {
  await pool.query(
    `INSERT INTO song_sample_sources (song_id, sample_type, timestamp, source) VALUES ($1,$2,$3,$4)`,
    [id, s.type, s.timestamp, source]);
}
const item = (block, s) => block.samples.items.find((i) => i.type === s.type && i.timestamp === s.timestamp);

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZSMS%'`);
  await pool.end();
});

test('without a saved source the samples behave as before', async () => {
  const id = await mkFixture('ZZZSMS Plain');
  const pub = await audio.getSongAudio(pool, id);
  assert.equal(item(pub, A).source, null);
  assert.equal(item(pub, A).confirmed, false);
  assert.equal(item(pub, C).source, 'ZZZSMS Doc');
  const adm = await audio.getAdminAudio(pool, id);
  assert.equal(item(adm, A).suggested, 'ZZZSMS Maybe');
  assert.equal(item(adm, C).suggested, null);
});

test('a saved source wins, per sample', async () => {
  const id = await mkFixture('ZZZSMS Saved');
  await saveSource(id, A, 'ZZZSMS Speaker');
  await saveSource(id, C, 'ZZZSMS Override');
  const pub = await audio.getSongAudio(pool, id);
  assert.equal(item(pub, A).source, 'ZZZSMS Speaker');
  assert.equal(item(pub, A).confirmed, true);
  assert.equal(item(pub, B).source, null);
  assert.equal(item(pub, C).source, 'ZZZSMS Override');
});

test('the public block never carries the guess or orphans', async () => {
  const id = await mkFixture('ZZZSMS Public');
  await saveSource(id, { type: A.type, timestamp: '9:00-9:10' }, 'ZZZSMS Gone');
  const text = JSON.stringify((await audio.getSongAudio(pool, id)).samples);
  for (const bad of ['suggested', 'orphans', 'ZZZSMS Maybe', 'ZZZSMS Gone']) {
    assert.ok(!text.includes(bad), `public samples must not contain ${bad}`);
  }
});

test('an unapproved song serves no samples even with a saved source', async () => {
  const id = await mkFixture('ZZZSMS Unapproved', { show: null });
  await saveSource(id, A, 'ZZZSMS Speaker');
  assert.equal((await audio.getSongAudio(pool, id)).samples, null);
});

test('a saved source matching no sample is an orphan, admin only', async () => {
  const id = await mkFixture('ZZZSMS Orphan');
  await saveSource(id, { type: A.type, timestamp: '9:00-9:10' }, 'ZZZSMS Gone');
  const adm = await audio.getAdminAudio(pool, id);
  assert.deepEqual(adm.samples.orphans, [{ type: A.type, timestamp: '9:00-9:10', source: 'ZZZSMS Gone' }]);
});

// ---- curation.setSampleSource ----
const rowCount = async (id) =>
  (await pool.query('SELECT count(*)::int n FROM song_sample_sources WHERE song_id=$1', [id])).rows[0].n;

test('setSampleSource saves, replaces and clears', async () => {
  const id = await mkFixture('ZZZSMS Writer');
  let wb = await curation.setSampleSource(pool, id, { ...A, source: '  ZZZSMS Speaker  ' });
  assert.equal(item(wb.audio, A).source, 'ZZZSMS Speaker', 'trimmed');
  assert.equal(item(wb.audio, A).confirmed, true);
  wb = await curation.setSampleSource(pool, id, { ...A, source: 'ZZZSMS Other' });
  assert.equal(item(wb.audio, A).source, 'ZZZSMS Other');
  assert.equal(await rowCount(id), 1, 'a second save replaces, never adds');
  wb = await curation.setSampleSource(pool, id, { ...A, source: '   ' });
  assert.equal(item(wb.audio, A).source, null);
  assert.equal(item(wb.audio, A).confirmed, false);
  assert.equal(await rowCount(id), 0);
});

test('setSampleSource rejects bad input and writes nothing', async () => {
  const id = await mkFixture('ZZZSMS Bad');
  const bad = [
    { timestamp: A.timestamp, source: 'x' },
    { type: A.type, source: 'x' },
    { ...A },
    { ...A, source: 42 },
    { ...A, source: 'x'.repeat(201) },
    { type: A.type, timestamp: '9:00-9:10', source: 'x' },
    { type: A.type, timestamp: '0:44\u20131:19', source: 'x' },
  ];
  for (const b of bad) {
    await assert.rejects(() => curation.setSampleSource(pool, id, b), (e) => e.code === 'BAD_INPUT', JSON.stringify(b));
  }
  await assert.rejects(() => curation.setSampleSource(pool, 999999999, { ...A, source: 'x' }), (e) => e.code === 'NOT_FOUND');
  assert.equal(await rowCount(id), 0);
});

test('setSampleSource lets an orphan be cleared', async () => {
  const id = await mkFixture('ZZZSMS ClearOrphan');
  await saveSource(id, { type: A.type, timestamp: '9:00-9:10' }, 'ZZZSMS Gone');
  const wb = await curation.setSampleSource(pool, id, { type: A.type, timestamp: '9:00-9:10', source: '' });
  assert.deepEqual(wb.audio.samples.orphans, []);
  assert.equal(await rowCount(id), 0);
});

test('setSampleSource leaves the other sample of the same type alone', async () => {
  const id = await mkFixture('ZZZSMS SameType');
  const wb = await curation.setSampleSource(pool, id, { ...A, source: 'ZZZSMS Speaker' });
  assert.equal(item(wb.audio, B).source, null);
  assert.equal(item(wb.audio, B).confirmed, false);
});
