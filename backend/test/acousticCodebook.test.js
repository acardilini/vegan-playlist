const { test } = require('node:test');
const assert = require('node:assert');
const acb = require('../services/acousticCodebook');

// Pure-function tests — no DB, no sentinel.

test('COMPONENTS lists the five enum dimensions in order with short headings', () => {
  assert.deepEqual(acb.COMPONENT_KEYS, [
    'sonic_energy', 'emotional_mood', 'rhythmic_style', 'acoustic_type', 'vocal_delivery',
  ]);
  assert.deepEqual(acb.COMPONENTS.map(c => c.heading), [
    'Energy', 'Mood', 'Rhythm', 'Instruments', 'Vocals',
  ]);
  assert.ok(acb.COMPONENTS.every(c => c.column === c.key));
  // tempo is an integer range, not an enum component
  assert.ok(!acb.COMPONENT_KEYS.includes('tempo_bpm'));
  assert.equal(acb.TEMPO.column, 'tempo_bpm');
  assert.equal(acb.TEMPO.heading, 'Tempo');
});

test('codeLabel, codeDefinition and component text resolve from the acoustic codebook', () => {
  assert.equal(acb.codeLabel('sonic_energy', 'MODERATE_BALANCED'), 'Moderate & Balanced');
  assert.equal(acb.codeLabel('vocal_delivery', 'SPOKEN_WORD_RAP'), 'Spoken Word & Rap');
  assert.ok(acb.codeDefinition('rhythmic_style', 'DRIVING_STEADY_PULSE').length > 0);
  assert.equal(acb.componentName('sonic_energy'), 'Sonic Energy & Intensity');
  assert.ok(acb.componentDescription('emotional_mood').length > 20);
  assert.ok(acb.componentDescription('tempo_bpm').length > 20, 'tempo has component text too');
});

test('unknown codes title-case rather than vanish (acoustic display is ungated)', () => {
  assert.equal(acb.codeLabel('sonic_energy', 'SOME_NEW_CODE'), 'Some New Code');
  assert.equal(acb.codeLabel('sonic_energy', null), null);
  assert.equal(acb.codeDefinition('sonic_energy', 'SOME_NEW_CODE'), '');
});

test('labels never carry the codebook emoji short_tag', () => {
  for (const c of acb.COMPONENTS) {
    for (const o of acb.optionsFor(c.key)) {
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(o.label),
        `${c.key}/${o.code} label must be emoji-free`);
    }
  }
});

test('optionsFor returns every code in codebook order', () => {
  assert.deepEqual(acb.optionsFor('acoustic_type').map(o => o.code),
    ['UNPLUGGED_ACOUSTIC', 'HYBRID_SEMI_ACOUSTIC', 'ELECTRIC_AMPLIFIED']);
  assert.equal(acb.optionsFor('acoustic_type')[0].label, 'Unplugged Acoustic');
});

test('cleanSelection keeps known codes and drops invented ones (filters ARE gated)', () => {
  assert.deepEqual(acb.cleanSelection('vocal_delivery', ['SPOKEN_WORD_RAP', 'NOT_A_CODE']),
    ['SPOKEN_WORD_RAP']);
  assert.deepEqual(acb.cleanSelection('vocal_delivery', 'SPOKEN_WORD_RAP'), ['SPOKEN_WORD_RAP']);
  assert.deepEqual(acb.cleanSelection('vocal_delivery', null), []);
  assert.deepEqual(acb.cleanSelection('no_such_component', ['X']), []);
});

test('acousticSelectionClauses: OR within a component, one param array per component', () => {
  const r = acb.acousticSelectionClauses({
    sonic_energy: ['MODERATE_BALANCED', 'DRIVING_ENERGETIC'],
    vocal_delivery: ['SPOKEN_WORD_RAP'],
  }, 3);
  assert.equal(r.needsJoin, true);
  assert.deepEqual(r.clauses, [
    'sca.sonic_energy = ANY($3::text[])',
    'sca.vocal_delivery = ANY($4::text[])',
  ]);
  assert.deepEqual(r.params, [['MODERATE_BALANCED', 'DRIVING_ENERGETIC'], ['SPOKEN_WORD_RAP']]);
  assert.equal(r.nextIndex, 5);
});

test('acousticSelectionClauses: empty and all-invalid selections need no join', () => {
  assert.equal(acb.acousticSelectionClauses({}, 1).needsJoin, false);
  const bogus = acb.acousticSelectionClauses({ sonic_energy: ['NOPE'] }, 1);
  assert.equal(bogus.needsJoin, false);
  assert.deepEqual(bogus.clauses, []);
  assert.equal(bogus.nextIndex, 1);
});
