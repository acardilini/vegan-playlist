import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeText, scoreText, detailText, toneOf, clarityLabel, pillTexts, TIER_OPTIONS, SORT_OPTIONS } from './transcriptConfidence.js';

test('badgeText shows the tier and the score, or the tier alone when there is no score', () => {
  assert.equal(badgeText({ tier: 'HIGH', confidence_score: 95 }), 'HIGH · 95/100');
  assert.equal(badgeText({ tier: 'UNINTELLIGIBLE', confidence_score: 10 }), 'UNINTELLIGIBLE · 10/100');
  assert.equal(badgeText({ tier: 'HIGH' }), 'HIGH');
  assert.equal(badgeText({ tier: 'MEDIUM', confidence_score: null }), 'MEDIUM');
  assert.equal(badgeText({ tier: 'LOW', confidence_score: 0 }), 'LOW · 0/100');
});

test('scoreText is the bare score, or the tier when there is no score', () => {
  assert.equal(scoreText({ tier: 'UNINTELLIGIBLE', confidence_score: 5 }), '5');
  assert.equal(scoreText({ tier: 'HIGH', confidence_score: 95 }), '95');
  assert.equal(scoreText({ tier: 'LOW', confidence_score: 0 }), '0');
  assert.equal(scoreText({ tier: 'HIGH', confidence_score: null }), 'HIGH');
  assert.equal(scoreText({}), '');
});

test('detailText is the full badge and pills joined for a tooltip, never null or undefined', () => {
  assert.equal(detailText({ tier: 'LOW', confidence_score: 40, audio_clarity: 'MUDDY_OR_BURIED', estimated_word_accuracy_pct: 55, inaudible_segments: 6 }),
    'LOW · 40/100 · Muddy / Buried · ~55% words · 6 [inaudible]');
  assert.equal(detailText({ tier: 'HIGH' }), 'HIGH');
  assert.ok(!/null|undefined/.test(detailText({})));
});

test('toneOf maps HIGH good, MEDIUM mid, everything else low', () => {
  assert.equal(toneOf('HIGH'), 'good');
  assert.equal(toneOf('MEDIUM'), 'mid');
  assert.equal(toneOf('LOW'), 'low');
  assert.equal(toneOf('UNINTELLIGIBLE'), 'low');
  assert.equal(toneOf('constructor'), 'low');
  assert.equal(toneOf(undefined), 'low');
});

test('clarityLabel names the four codes and nothing else', () => {
  assert.equal(clarityLabel('CLEAR'), 'Clear');
  assert.equal(clarityLabel('MODERATE'), 'Moderate');
  assert.equal(clarityLabel('MUDDY_OR_BURIED'), 'Muddy / Buried');
  assert.equal(clarityLabel('EXTREME_UNINTELLIGIBLE'), 'Extreme / Unintelligible');
  assert.equal(clarityLabel(null), null);
  assert.equal(clarityLabel('constructor'), null);
});

test('pillTexts lists clarity, accuracy, then inaudible count, omitting what is missing', () => {
  assert.deepEqual(pillTexts({ audio_clarity: 'MODERATE', estimated_word_accuracy_pct: 95, inaudible_segments: 6 }),
    ['Moderate', '~95% words', '6 [inaudible]']);
  assert.deepEqual(pillTexts({}), []);
  assert.deepEqual(pillTexts({ inaudible_segments: 0 }), []);
  assert.deepEqual(pillTexts({ audio_clarity: null, estimated_word_accuracy_pct: null, inaudible_segments: null }), []);
  assert.deepEqual(pillTexts({ estimated_word_accuracy_pct: 0 }), ['~0% words']);
});

test('no output ever contains null or undefined', () => {
  const outs = [
    badgeText({}), badgeText({ tier: 'HIGH' }), ...pillTexts({}), ...pillTexts({ audio_clarity: 'CLEAR' }),
    ...pillTexts({ inaudible_segments: 3 }),
  ];
  for (const o of outs) assert.ok(!/null|undefined/.test(String(o)), String(o));
});

test('the option lists are exactly as specified', () => {
  assert.deepEqual(TIER_OPTIONS, [['', 'All'], ['HIGH', 'High'], ['MEDIUM', 'Medium'], ['LOW', 'Low'], ['UNINTELLIGIBLE', 'Unintelligible']]);
  assert.deepEqual(SORT_OPTIONS, [['best', 'Highest confidence first'], ['worst', 'Lowest confidence first']]);
});
