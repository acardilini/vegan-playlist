import test from 'node:test';
import assert from 'node:assert/strict';
import { splitColumns, sampleHeading, hasSoundContent } from './soundLayout.js';

// Shapes match what GET /api/analysis/song/:id serves as `audio` (services/audioAnalysis.getSongAudio).
const row = (key, label, ...labels) => ({
  key, label, description: `${label} description`,
  values: labels.map((l) => ({ code: l.toUpperCase(), label: l, definition: '' })),
});
const FULL = {
  summary: 'A heavy track.',
  rows: [
    row('musical_mood', 'Mood', 'Dark', 'Urgent'),
    row('sonic_intensity', 'Intensity', 'Heavy'),
    row('production_texture', 'Production', 'Raw'),
    row('dynamic_arc', 'Dynamics', 'Relentless'),
    row('vocal_style', 'Vocals', 'Screamed'),
    row('rhythmic_feel', 'Rhythm', 'Blast beat'),
    row('instrumentation', 'Instruments', 'Guitar', 'Drums'),
  ],
  tempo_bpm: 107, key: 'F major', samples: null,
};

test('splitColumns puts Mood, Intensity, Production and Dynamics left; Vocals, Rhythm, Instruments and Tempo · Key right', () => {
  const { left, right } = splitColumns(FULL);
  assert.deepEqual(left.map((r) => r.label), ['Mood', 'Intensity', 'Production', 'Dynamics']);
  assert.deepEqual(right.map((r) => r.label), ['Vocals', 'Rhythm', 'Instruments', 'Tempo · Key']);
  assert.equal(right[3].key, 'tempo_key');
  assert.equal(right[3].text, '107 BPM · F major');
});

test('splitColumns carries each row\'s values through untouched', () => {
  const { left } = splitColumns(FULL);
  assert.deepEqual(left[0].values.map((v) => v.label), ['Dark', 'Urgent']);
});

test('an a cappella song drops the Instruments row and keeps the rest', () => {
  const audio = { ...FULL, rows: FULL.rows.filter((r) => r.key !== 'instrumentation') };
  const { right } = splitColumns(audio);
  assert.deepEqual(right.map((r) => r.label), ['Vocals', 'Rhythm', 'Tempo · Key']);
});

test('a row with no values is dropped', () => {
  const audio = { ...FULL, rows: [...FULL.rows.slice(0, 6), { ...row('instrumentation', 'Instruments'), values: [] }] };
  assert.ok(!splitColumns(audio).right.some((r) => r.key === 'instrumentation'));
});

test('tempo null leaves only the key; key null leaves only the tempo; neither adds no row', () => {
  assert.equal(splitColumns({ ...FULL, tempo_bpm: null }).right.at(-1).text, 'F major');
  assert.equal(splitColumns({ ...FULL, key: null }).right.at(-1).text, '107 BPM');
  const none = splitColumns({ ...FULL, tempo_bpm: null, key: null });
  assert.ok(!none.right.some((r) => r.key === 'tempo_key'));
});

test('splitColumns tolerates a sparse or missing audio block', () => {
  assert.deepEqual(splitColumns({ rows: [], tempo_bpm: null, key: null }), { left: [], right: [] });
  assert.deepEqual(splitColumns(null), { left: [], right: [] });
  assert.deepEqual(splitColumns({}), { left: [], right: [] });
});

test('sampleHeading counts the items and names the types', () => {
  const samples = {
    types: [{ code: 'ADVOCATE_SPEECH', label: 'Advocate Speech' }],
    items: [{ type: 'ADVOCATE_SPEECH' }, { type: 'ADVOCATE_SPEECH' }, { type: 'ADVOCATE_SPEECH' }, { type: 'ADVOCATE_SPEECH' }],
  };
  assert.equal(sampleHeading(samples), 'Samples heard (4)');
});

test('sampleHeading falls back to the type count when the details are missing', () => {
  const samples = { types: [{ code: 'A', label: 'A' }, { code: 'B', label: 'B' }], items: [] };
  assert.equal(sampleHeading(samples), 'Samples heard (2)');
});

test('hasSoundContent: true for a summary, rows or approved samples; false for nothing, null or an empty block', () => {
  assert.equal(hasSoundContent(FULL), true);
  assert.equal(hasSoundContent({ summary: 'Heavy.', rows: [], tempo_bpm: null, key: null, samples: null }), true, 'a summary alone');
  assert.equal(hasSoundContent({ summary: '', rows: FULL.rows.slice(0, 1), samples: null }), true, 'rows alone');
  assert.equal(hasSoundContent({ summary: '', rows: [], tempo_bpm: 100, key: null, samples: null }), true, 'tempo alone');
  assert.equal(hasSoundContent({ summary: '', rows: [], samples: { types: [{ code: 'A', label: 'A' }], items: [] } }), true, 'samples alone');
  assert.equal(hasSoundContent({ summary: '', rows: [], tempo_bpm: null, key: null, samples: null }), false);
  assert.equal(hasSoundContent(null), false);
  assert.equal(hasSoundContent(undefined), false);
});
