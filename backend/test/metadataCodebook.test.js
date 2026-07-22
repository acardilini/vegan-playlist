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
    'Perspective', 'Tone', 'Intensity', 'Clarity', 'Focus', 'Audience', 'Emotions',
  ]);
  // emotions is the only multi-valued component; column === key for all seven
  assert.deepEqual(cb.COMPONENTS.filter(c => c.multi).map(c => c.key), ['emotions']);
  assert.ok(cb.COMPONENTS.every(c => c.column === c.key));
});

test('codeLabel and codeDefinition resolve from the codebook', () => {
  assert.equal(cb.codeLabel('perspective', 'MORAL_ACCUSER_JUDGE'), 'Moral Accuser');
  assert.equal(cb.codeLabel('emotions', 'MORAL_OUTRAGE'), 'Moral Outrage');
  assert.ok(cb.codeDefinition('perspective', 'MORAL_ACCUSER_JUDGE').length > 0);
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

test('optionsFor omits the four suppressed absence codes', () => {
  const codes = (key) => cb.optionsFor(key).map(o => o.code);
  assert.ok(!codes('clarity').includes('THEMATIC_ABSENCE'));
  assert.ok(!codes('focus_amount').includes('ABSENCE_OF_FOCUS'));
  assert.ok(!codes('focus_amount').includes('INSUFFICIENT_DATA'));
  assert.ok(!codes('target_audience').includes('UNSPECIFIED'));
  // and keeps the real ones
  assert.ok(codes('focus_amount').includes('CENTRAL_THESIS'));
  assert.equal(cb.optionsFor('focus_amount').length, 4); // 6 codes - 2 suppressed
});

test('cleanSelection strips unknown and suppressed codes', () => {
  assert.deepEqual(
    cb.cleanSelection('focus_amount', ['CENTRAL_THESIS', 'ABSENCE_OF_FOCUS', 'NOT_A_CODE']),
    ['CENTRAL_THESIS']);
  assert.deepEqual(cb.cleanSelection('perspective', 'MORAL_ACCUSER_JUDGE'), ['MORAL_ACCUSER_JUDGE']);
  assert.deepEqual(cb.cleanSelection('perspective', undefined), []);
});

test('scalarSelectionClauses: single-valued component uses = ANY, one param array', () => {
  const r = cb.scalarSelectionClauses(
    { perspective: ['MORAL_ACCUSER_JUDGE', 'SYSTEMIC_SOCIAL_CRITIC'] }, 1);
  assert.equal(r.needsJoin, true);
  assert.deepEqual(r.clauses, ['sca.perspective = ANY($1::text[])']);
  assert.deepEqual(r.params, [['MORAL_ACCUSER_JUDGE', 'SYSTEMIC_SOCIAL_CRITIC']]);
  assert.equal(r.nextIndex, 2);
});

test('scalarSelectionClauses: emotions uses array overlap', () => {
  const r = cb.scalarSelectionClauses({ emotions: ['MORAL_OUTRAGE'] }, 3);
  assert.deepEqual(r.clauses, ['sca.emotions && $3::text[]']);
  assert.equal(r.nextIndex, 4);
});

test('scalarSelectionClauses: components AND together in COMPONENTS order', () => {
  const r = cb.scalarSelectionClauses(
    { emotions: ['MORAL_OUTRAGE'], perspective: ['MORAL_ACCUSER_JUDGE'] }, 1);
  assert.equal(r.clauses.length, 2);
  assert.equal(r.clauses[0], 'sca.perspective = ANY($1::text[])', 'perspective first');
  assert.equal(r.clauses[1], 'sca.emotions && $2::text[]');
});

test('scalarSelectionClauses: a selection of only suppressed codes needs no join', () => {
  const r = cb.scalarSelectionClauses({ focus_amount: ['ABSENCE_OF_FOCUS'] }, 1);
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
  const r = cb.scalarSelectionClauses({ clarity: ['SYSTEMIC_COMMODIFICATION_CRITIQUE'] }, 1, 'x');
  assert.deepEqual(r.clauses, ['x.clarity = ANY($1::text[])']);
});
