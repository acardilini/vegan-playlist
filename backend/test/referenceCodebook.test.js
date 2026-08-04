const { test } = require('node:test');
const assert = require('node:assert');
const ref = require('../services/referenceCodebook');
const acb = require('../services/acousticCodebook');
const taxonomy = require('../data/taxonomy.json');

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
