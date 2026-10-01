const { test } = require('node:test');
const assert = require('node:assert');
const cb = require('../services/metadataCodebook');

// Pure-function tests — no DB, no sentinel.

test('COMPONENTS lists the seven components in order with short headings', () => {
  assert.deepEqual(cb.COMPONENT_KEYS, [
    'perspective', 'lyrical_tone', 'intensity', 'clarity',
    'focus_amount', 'target_audience', 'emotions',
  ]);
  assert.deepEqual(cb.COMPONENTS.map(c => c.heading), [
    'Perspective', 'Tone', 'Intensity', 'Clarity', 'Focus', 'Speaking to', 'Emotions',
  ]);
  // emotions is the only multi-valued component; column === key for all seven
  assert.deepEqual(cb.COMPONENTS.filter(c => c.multi).map(c => c.key), ['emotions']);
  assert.ok(cb.COMPONENTS.every(c => c.column === c.key));
});

test('codeLabel and codeDefinition resolve from the codebook', () => {
  assert.equal(cb.codeLabel('perspective', 'MORAL_JUDGEMENT'), 'Moral Judgement');
  assert.equal(cb.codeLabel('emotions', 'OUTRAGE'), 'Outrage');
  assert.ok(cb.codeDefinition('perspective', 'MORAL_JUDGEMENT').length > 0);
});

test('unknown codes fall back to Title Case, null stays null', () => {
  assert.equal(cb.codeLabel('perspective', 'SOME_NEW_CODE'), 'Some New Code');
  assert.equal(cb.codeLabel('perspective', null), null);
  assert.equal(cb.codeDefinition('perspective', 'SOME_NEW_CODE'), '');
});

test('labels never carry the codebook emoji short_tag', () => {
  for (const c of cb.COMPONENTS) {
    for (const o of cb.optionsFor(c.key)) {
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(o.label),
        `${c.key}/${o.code} label must be emoji-free`);
    }
  }
});

test('optionsFor omits the two suppressed absence codes', () => {
  const codes = (key) => cb.optionsFor(key).map(o => o.code);
  assert.ok(!codes('clarity').includes('ABSENT'));
  assert.ok(!codes('target_audience').includes('UNSPECIFIED'));
  // and keeps the real ones
  assert.ok(codes('clarity').includes('EXPLICIT'));
  assert.equal(cb.optionsFor('clarity').length, 4); // 5 codes - ABSENT
  assert.equal(cb.optionsFor('focus_amount').length, 4); // focus_amount has no absence codes now
});

test('cleanSelection strips unknown and suppressed codes', () => {
  assert.deepEqual(
    cb.cleanSelection('clarity', ['EXPLICIT', 'ABSENT', 'NOT_A_CODE']),
    ['EXPLICIT']);
  assert.deepEqual(cb.cleanSelection('perspective', 'MORAL_JUDGEMENT'), ['MORAL_JUDGEMENT']);
  assert.deepEqual(cb.cleanSelection('perspective', undefined), []);
});

test('scalarSelectionClauses: single-valued component uses = ANY, one param array', () => {
  const r = cb.scalarSelectionClauses(
    { perspective: ['MORAL_JUDGEMENT', 'SYSTEMIC_CRITIQUE'] }, 1);
  assert.equal(r.needsJoin, true);
  assert.deepEqual(r.clauses, ['sca.perspective = ANY($1::text[])']);
  assert.deepEqual(r.params, [['MORAL_JUDGEMENT', 'SYSTEMIC_CRITIQUE']]);
  assert.equal(r.nextIndex, 2);
});

test('scalarSelectionClauses: emotions uses array overlap', () => {
  const r = cb.scalarSelectionClauses({ emotions: ['OUTRAGE'] }, 3);
  assert.deepEqual(r.clauses, ['sca.emotions && $3::text[]']);
  assert.equal(r.nextIndex, 4);
});

test('scalarSelectionClauses: components AND together in COMPONENTS order', () => {
  const r = cb.scalarSelectionClauses(
    { emotions: ['OUTRAGE'], perspective: ['MORAL_JUDGEMENT'] }, 1);
  assert.equal(r.clauses.length, 2);
  assert.equal(r.clauses[0], 'sca.perspective = ANY($1::text[])', 'perspective first');
  assert.equal(r.clauses[1], 'sca.emotions && $2::text[]');
});

test('scalarSelectionClauses: a selection of only suppressed codes needs no join', () => {
  const r = cb.scalarSelectionClauses({ clarity: ['ABSENT'] }, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
  assert.deepEqual(r.params, []);
  assert.equal(r.nextIndex, 1);
});

test('scalarSelectionClauses: empty selection needs no join', () => {
  const r = cb.scalarSelectionClauses({}, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
});

test('scalarSelectionClauses: alias is configurable', () => {
  const r = cb.scalarSelectionClauses({ clarity: ['CONTEXTUAL'] }, 1, 'x');
  assert.deepEqual(r.clauses, ['x.clarity = ANY($1::text[])']);
});

test('componentDescription returns the codebook one-liner, empty for unknown', () => {
  assert.match(cb.componentDescription('perspective'), /narrative voice/i);
  assert.equal(cb.componentDescription('not_a_component'), '');
});
