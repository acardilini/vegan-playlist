const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const audio = require('../services/audioAnalysis');

// Unique fixture sentinel per test file: ZZZAUD. Fixture songs are published (facets are live-gated) but all
// facet queries below are restricted to the sentinel through the constraint hook, so real data never leaks in.
// Deleting a song cascades its audio rows.

const ONLY_FIXTURES = { joinSql: '', where: [`s.title LIKE 'ZZZAUD%'`], params: [] };

async function mkSong(title, { published = true, show = null } = {}) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, show_audio_samples, data_source)
     VALUES ($1,'included',$2,$3,'manual') RETURNING id`, [title, published, show])).rows[0].id;
}
async function mkAudio(songId, o = {}) {
  const r = {
    model: 'zzzaud-model', status: 'OK', at: '2026-11-01T00:00:00Z',
    mood: ['DEFIANT_ANTHEMIC', 'URGENT_TENSE'], intensity: 'ENERGETIC_DRIVING', texture: 'ELECTRONIC_SYNTHETIC',
    vocals: ['SPOKEN_WORD'], rhythm: 'ELECTRONIC_MECHANICAL', instr: ['DRUM_MACHINE_BEATS', 'SYNTHS_ELECTRONICS'],
    samples: ['NONE'], arc: 'STEADY_GROOVE', summary: 'A steady electronic groove.', bpm: 107, stability: 'STEADY',
    key: 'F major', lufs: -14.9,
    details: null, ...o,
  };
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, musical_mood, sonic_intensity,
       production_texture, vocal_style, rhythmic_feel, instrumentation, audio_samples, dynamic_arc, sonic_summary,
       tempo_bpm, tempo_stability, musical_key, loudness_lufs, sample_details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [songId, r.model, r.status, r.at, r.mood, r.intensity, r.texture, r.vocals, r.rhythm, r.instr, r.samples,
      r.arc, r.summary, r.bpm, r.stability, r.key, r.lufs, r.details && JSON.stringify(r.details)]);
}
const SAMPLE_DETAILS = [
  { type: 'ADVOCATE_SPEECH_CLIP', timestamp: '0:44-1:19', description: 'A calm lecture.',
    transcript_excerpt: 'Eating animals acts as mirror.', speaker_or_source: null, identification_confidence: 'UNIDENTIFIED' },
  { type: 'ANIMAL_SLAUGHTER_SFX', timestamp: '2:00-2:20', description: 'Saws and mooing.',
    transcript_excerpt: null, speaker_or_source: 'A documentary', identification_confidence: 'HIGH' },
];

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZAUD%'`);
  await pool.end();
});

test('LATEST_AUDIO and getSongAudio: a song with only a failed row has no audio', async () => {
  const id = await mkSong('ZZZAUD Failed');
  await mkAudio(id, { status: 'ERROR' });
  assert.equal(await audio.getSongAudio(pool, id), null);
  assert.equal(await audio.getSongAudio(pool, 999999999), null);
});

test('the OK row is used even when a newer non-OK row exists beside it', async () => {
  const id = await mkSong('ZZZAUD NewerError');
  await mkAudio(id, { model: 'a-model', summary: 'The OK summary.', at: '2026-11-01T00:00:00Z' });
  await mkAudio(id, { model: 'b-model', status: 'ERROR', at: '2026-11-10T00:00:00Z', summary: 'broken' });
  const a = await audio.getSongAudio(pool, id);
  assert.equal(a.summary, 'The OK summary.');
});

test('getSongAudio: summary, rows in page order with labels, empty arrays omitted, tempo and key', async () => {
  const id = await mkSong('ZZZAUD Full');
  await mkAudio(id, { instr: [] });
  const a = await audio.getSongAudio(pool, id);
  assert.equal(a.summary, 'A steady electronic groove.');
  assert.deepEqual(a.rows.map(r => r.label), ['Mood', 'Intensity', 'Production', 'Dynamics', 'Vocals', 'Rhythm']);
  assert.deepEqual(a.rows[0].values.map(v => v.label), ['Empowering', 'Urgent']);
  assert.ok(a.rows[0].values[0].definition.length > 5);
  assert.equal(a.rows.find(r => r.key === 'production_texture').values[0].label, 'Electronic');
  assert.ok(!a.rows.some(r => r.key === 'instrumentation'), 'a cappella: no empty Instruments row');
  assert.equal(a.tempo_bpm, 107);
  assert.equal(a.key, 'F major');
});

test('an unmetered track hides its tempo', async () => {
  const id = await mkSong('ZZZAUD Unmetered');
  await mkAudio(id, { bpm: 90, stability: 'UNMETERED' });
  const nul = await mkSong('ZZZAUD NullTempo');
  await mkAudio(nul, { bpm: null });
  assert.equal((await audio.getSongAudio(pool, id)).tempo_bpm, null);
  assert.equal((await audio.getSongAudio(pool, nul)).tempo_bpm, null);
});

test('samples reach getSongAudio only when the curator approved them', async () => {
  const opts = { samples: ['ADVOCATE_SPEECH_CLIP', 'ANIMAL_SLAUGHTER_SFX'], details: SAMPLE_DETAILS };
  const unreviewed = await mkSong('ZZZAUD SampUnrev', { show: null });
  const hidden = await mkSong('ZZZAUD SampHidden', { show: false });
  const shown = await mkSong('ZZZAUD SampShown', { show: true });
  for (const id of [unreviewed, hidden, shown]) await mkAudio(id, opts);

  assert.equal((await audio.getSongAudio(pool, unreviewed)).samples, null);
  assert.equal((await audio.getSongAudio(pool, hidden)).samples, null);
  const s = (await audio.getSongAudio(pool, shown)).samples;
  assert.deepEqual(s.types.map(t => t.label), ['Advocate Speech', 'Slaughterhouse Sounds']);
  assert.equal(s.items.length, 2);
  assert.deepEqual(s.items[0], {
    type: 'ADVOCATE_SPEECH_CLIP', label: 'Advocate Speech', timestamp: '0:44-1:19', startSec: 44, endSec: 79,
    transcript: 'Eating animals acts as mirror.', source: null, confidence: 'UNIDENTIFIED',
  });   // a quote carries no `description`: the analysis' own words are never served beside a quote
  assert.equal(s.items[1].transcript, null);
  assert.equal(s.items[1].description, 'Saws and mooing.', 'a sample with no quote carries its description');
  assert.ok(!('description' in s.items[0]), 'a quoted sample does not');
  assert.equal(s.items[1].source, 'A documentary', 'HIGH confidence: the source is named');
  // hidden data must not appear anywhere in the public payload
  assert.doesNotMatch(JSON.stringify(await audio.getSongAudio(pool, hidden)), /lecture|mooing|ADVOCATE|SLAUGHTER/);
});

test('approved but NONE-only samples give no samples block', async () => {
  const id = await mkSong('ZZZAUD NoneSamples', { show: true });
  await mkAudio(id, { samples: ['NONE'] });
  assert.equal((await audio.getSongAudio(pool, id)).samples, null);
});

test('getAdminAudio shows samples regardless of the gate, plus status and the decision', async () => {
  const id = await mkSong('ZZZAUD Admin', { show: null });
  await mkAudio(id, { samples: ['ADVOCATE_SPEECH_CLIP'], details: SAMPLE_DETAILS.slice(0, 1) });
  const a = await audio.getAdminAudio(pool, id);
  assert.equal(a.status, 'OK');
  assert.equal(a.show_audio_samples, null);
  assert.equal(a.samples.items.length, 1);
  assert.equal(a.model, 'zzzaud-model');

  const failed = await mkSong('ZZZAUD AdminFailed');
  await mkAudio(failed, { status: 'UNAVAILABLE' });
  const f = await audio.getAdminAudio(pool, failed);
  assert.equal(f.status, 'UNAVAILABLE');
  assert.equal(f.rows.length, 0);
  assert.equal(await audio.getAdminAudio(pool, await mkSong('ZZZAUD AdminNoRow')), null);
});

test('audioFacets counts distinct live songs per code, in codebook order', async () => {
  const a = await mkSong('ZZZAUD FacetA'); await mkAudio(a, { mood: ['DARK_OMINOUS', 'URGENT_TENSE'] });
  const b = await mkSong('ZZZAUD FacetB'); await mkAudio(b, { mood: ['DARK_OMINOUS'], intensity: 'HEAVY_INTENSE' });
  const unpub = await mkSong('ZZZAUD FacetUnpub', { published: false }); await mkAudio(unpub, { mood: ['DARK_OMINOUS'] });
  const failed = await mkSong('ZZZAUD FacetFailed'); await mkAudio(failed, { status: 'ERROR', mood: ['DARK_OMINOUS'] });

  const f = await audio.audioFacets(pool, Object.fromEntries(
    ['musical_mood', 'sonic_intensity'].map(k => [k, ONLY_FIXTURES])));
  const mood = f.musical_mood;
  assert.equal(mood.heading, 'Mood');
  assert.equal(mood.multi, true);
  assert.equal(mood.options[0].code, 'FEROCIOUS_AGGRESSIVE');
  const count = (code) => mood.options.find(o => o.code === code).count;
  assert.equal(count('DARK_OMINOUS'), 2, 'unpublished and failed rows do not count');
  assert.ok(count('URGENT_TENSE') >= 1);
  assert.equal(f.sonic_intensity.multi, false);
  assert.ok(f.sonic_intensity.options.find(o => o.code === 'HEAVY_INTENSE').count >= 1);
  assert.deepEqual(Object.keys(f).sort(), [...require('../services/acousticCodebook').FILTER_KEYS].sort());
});

test('an exclude-self constraint widens a count: the constraint decides which songs count', async () => {
  const f = await audio.audioFacets(pool, {
    musical_mood: { joinSql: '', where: [`s.title = 'ZZZAUD FacetB'`], params: [] },
  });
  assert.equal(f.musical_mood.options.find(o => o.code === 'DARK_OMINOUS').count, 1);
  assert.equal(f.musical_mood.options.find(o => o.code === 'URGENT_TENSE').count, 0);
});

test('the audio_samples facet counts only songs the curator approved', async () => {
  const opts = { samples: ['ANIMAL_SLAUGHTER_SFX'], details: SAMPLE_DETAILS.slice(1) };
  const shown = await mkSong('ZZZAUD FSampShown', { show: true });
  const unrev = await mkSong('ZZZAUD FSampUnrev', { show: null });
  const hid = await mkSong('ZZZAUD FSampHid', { show: false });
  for (const id of [shown, unrev, hid]) await mkAudio(id, opts);
  const f = await audio.audioFacets(pool, { audio_samples: { joinSql: '', where: [`s.title LIKE 'ZZZAUD FSamp%'`], params: [] } });
  const opt = f.audio_samples.options.find(o => o.code === 'ANIMAL_SLAUGHTER_SFX');
  assert.equal(opt.count, 1);
  assert.ok(!f.audio_samples.options.some(o => o.code === 'NONE'));
});

test('MOOD_SUBQUERY and attachMood give the first-listed mood label, or null', async () => {
  const id = await mkSong('ZZZAUD Mood'); await mkAudio(id, { mood: ['FEROCIOUS_AGGRESSIVE', 'DARK_OMINOUS'] });
  const none = await mkSong('ZZZAUD MoodNone');
  const rows = (await pool.query(
    `SELECT s.id, ${audio.MOOD_SUBQUERY('s.id')} AS mood_code FROM songs s WHERE s.id = ANY($1) ORDER BY s.id`, [[id, none]])).rows;
  const out = audio.attachMood(rows);
  assert.equal(out[0].mood, 'Aggressive');
  assert.equal(out[1].mood, null);
  assert.ok(!('mood_code' in out[0]));
});

test('tempoRange and coverage return sane live figures', async () => {
  const t = await audio.tempoRange(pool);
  assert.ok(t.min_bpm > 0 && t.max_bpm >= t.min_bpm);
  const c = await audio.coverage(pool);
  assert.ok(c.analysed > 0);
  assert.ok(Array.isArray(c.models) && c.models.length > 0);
  assert.equal(typeof c.models[0].model, 'string');
  assert.ok(c.latest === null || !Number.isNaN(Date.parse(c.latest)));
});

test('SAMPLES_PENDING_SQL matches songs with samples and no decision only', async () => {
  const pending = await mkSong('ZZZAUD PendYes', { show: null });
  await mkAudio(pending, { samples: ['FOUND_SOUND_OTHER'], details: SAMPLE_DETAILS.slice(0, 1) });
  const decided = await mkSong('ZZZAUD PendDecided', { show: false });
  await mkAudio(decided, { samples: ['FOUND_SOUND_OTHER'], details: SAMPLE_DETAILS.slice(0, 1) });
  const none = await mkSong('ZZZAUD PendNone', { show: null });
  await mkAudio(none, { samples: ['NONE'] });
  const noAudio = await mkSong('ZZZAUD PendNoAudio', { show: null });
  const r = await pool.query(
    `SELECT s.id FROM songs s WHERE s.id = ANY($1) AND ${audio.SAMPLES_PENDING_SQL('s')}`, [[pending, decided, none, noAudio]]);
  assert.deepEqual(r.rows.map(x => x.id), [pending]);
});
