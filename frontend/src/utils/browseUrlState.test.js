import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilterState, termHref } from './browseUrlState.js';

// Every key the Reference page can link on: the five thematic dimensions, the seven scalar
// components and the five acoustic ones.
const KEYS = [
  'themes', 'targets', 'actions', 'tactics', 'moral_frames',
  'perspective', 'lyrical_tone', 'intensity', 'clarity', 'focus_amount',
  'target_audience', 'emotions',
  'sonic_energy', 'emotional_mood', 'rhythmic_style', 'acoustic_type', 'vocal_delivery',
];

test('termHref round-trips through readFilterState for every linkable key', () => {
  for (const key of KEYS) {
    const href = termHref(key, 'SOME_CODE');
    const { filters } = readFilterState(new URLSearchParams(href.split('?')[1]));
    assert.deepEqual(filters[key], ['SOME_CODE'], `${key} round-trips`);
  }
});

test('termHref escapes a code containing URL-significant characters', () => {
  const href = termHref('targets', 'a&b=c');
  const { filters } = readFilterState(new URLSearchParams(href.split('?')[1]));
  assert.deepEqual(filters.targets, ['a&b=c']);
});
