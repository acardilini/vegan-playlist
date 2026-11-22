const { test } = require('node:test');
const assert = require('node:assert');
const acb = require('../services/acousticCodebook');

// Pure-function tests over the new 8-dimension audio codebook — no DB, no sentinel.

test('DIMENSIONS lists the seven coded dimensions in page order with site headings', () => {
  assert.deepEqual(acb.DIMENSIONS.map(d => d.key), [
    'musical_mood', 'sonic_intensity', 'production_texture', 'dynamic_arc',
    'vocal_style', 'rhythmic_feel', 'instrumentation',
  ]);
  // production_texture is "Sound" in the codebook; the site calls it Production (a one-constant override)
  assert.deepEqual(acb.DIMENSIONS.map(d => d.heading), [
    'Mood', 'Intensity', 'Production', 'Dynamics', 'Vocals', 'Rhythm', 'Instruments',
  ]);
  assert.equal(acb.componentName('production_texture'), 'Sound');
  assert.ok(acb.DIMENSIONS.every(d => d.column === d.key));
  assert.deepEqual(acb.DIMENSIONS.filter(d => d.multi).map(d => d.key),
    ['musical_mood', 'vocal_style', 'instrumentation']);
  assert.deepEqual(acb.SINGLE_KEYS, ['sonic_intensity', 'production_texture', 'dynamic_arc', 'rhythmic_feel']);
  // The Explore colour menu takes single-value dimensions that fit the 7-colour palette; rhythm has 8 codes.
  assert.deepEqual(acb.COLOUR_KEYS, ['sonic_intensity', 'production_texture', 'dynamic_arc']);
  assert.equal(acb.SAMPLES.key, 'audio_samples');
  assert.equal(acb.SAMPLES.multi, true);
  assert.equal(acb.TEMPO.column, 'tempo_bpm');
  assert.deepEqual(acb.FILTER_KEYS, [...acb.DIMENSIONS.map(d => d.key), 'audio_samples']);
});

test('optionsFor lists codes in codebook order and never offers a hidden code', () => {
  assert.equal(acb.optionsFor('musical_mood').length, 9);
  assert.equal(acb.optionsFor('musical_mood')[0].code, 'FEROCIOUS_AGGRESSIVE');
  const samples = acb.optionsFor('audio_samples');
  assert.equal(samples.length, 5);
  assert.ok(!samples.some(o => o.code === 'NONE'), 'NONE is hidden_in_ui');
  assert.deepEqual(acb.optionsFor('sonic_energy'), [], 'a retired key has no options');
});

test('labels and definitions resolve; unknown codes title-case instead of vanishing', () => {
  assert.equal(acb.codeLabel('musical_mood', 'FEROCIOUS_AGGRESSIVE'), 'Aggressive');
  assert.equal(acb.codeLabel('production_texture', 'RAW_DIY_LOFI'), 'Raw DIY');
  assert.equal(acb.codeLabel('musical_mood', 'SOME_NEW_CODE'), 'Some New Code');
  assert.equal(acb.codeLabel('musical_mood', null), null);
  assert.ok(acb.codeDefinition('musical_mood', 'DARK_OMINOUS').length > 10, 'listener description');
  assert.ok(acb.aiDefinition('musical_mood', 'DARK_OMINOUS').length > 10, 'ai definition');
  assert.notEqual(acb.codeDefinition('musical_mood', 'DARK_OMINOUS'), acb.aiDefinition('musical_mood', 'DARK_OMINOUS'));
  assert.ok(acb.componentDescription('dynamic_arc').length > 20);
});

test('cleanSelection keeps known codes only and drops hidden ones', () => {
  assert.deepEqual(acb.cleanSelection('audio_samples', ['NONE', 'NATURE_ANIMAL_SOUNDSCAPE', 'x']),
    ['NATURE_ANIMAL_SOUNDSCAPE']);
  assert.deepEqual(acb.cleanSelection('sonic_intensity', 'HEAVY_INTENSE'), ['HEAVY_INTENSE']);
  assert.deepEqual(acb.cleanSelection('sonic_intensity', ['BOGUS']), []);
  assert.deepEqual(acb.cleanSelection('sonic_energy', ['MODERATE']), [], 'retired key');
  assert.deepEqual(acb.cleanSelection('musical_mood', null), []);
});

test('selectionClauses: && for multi, = ANY for single, one param array per dimension', () => {
  const r = acb.selectionClauses({
    musical_mood: ['DARK_OMINOUS', 'URGENT_TENSE'], sonic_intensity: ['HEAVY_INTENSE'],
  }, 3);
  assert.deepEqual(r.clauses, [
    'sau.musical_mood && $3::text[]',
    'sau.sonic_intensity = ANY($4::text[])',
  ]);
  assert.deepEqual(r.params, [['DARK_OMINOUS', 'URGENT_TENSE'], ['HEAVY_INTENSE']]);
  assert.equal(r.nextIndex, 5);
  assert.equal(r.needsJoin, true);
});

test('selectionClauses gates audio_samples on the curator approval and ignores old keys', () => {
  const s = acb.selectionClauses({ audio_samples: ['ANIMAL_SLAUGHTER_SFX'] }, 1);
  assert.equal(s.clauses.length, 1);
  assert.match(s.clauses[0], /sau\.audio_samples && \$1::text\[\]/);
  assert.match(s.clauses[0], /s\.show_audio_samples IS TRUE/);

  const none = acb.selectionClauses({ sonic_energy: ['MODERATE'], musical_mood: ['BOGUS'] }, 1);
  assert.deepEqual(none.clauses, []);
  assert.equal(none.needsJoin, false);
  assert.equal(none.nextIndex, 1);
});

test('objectiveMetrics describes the three measured values', () => {
  const m = acb.objectiveMetrics();
  assert.deepEqual(m.map(x => x.key), ['tempo_bpm', 'musical_key', 'loudness_lufs']);
  assert.deepEqual(m.map(x => x.label), ['Tempo', 'Key', 'Loudness']);
  assert.ok(m.every(x => x.description.length > 5 && x.source.length > 2));
});
