import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilterState, applyFilterState, termHref, AUDIO_KEYS, EMPTY_FILTERS, hasBrowseParams } from './browseUrlState.js';

// Every key the Reference page can link on: the four thematic dimensions, the six scalar
// components and the eight audio ones.
const KEYS = [
  'themes', 'targets', 'actions', 'moral_frames',
  'perspective', 'lyrical_tone', 'clarity', 'focus_amount',
  'target_audience', 'emotions',
  'musical_mood', 'sonic_intensity', 'production_texture', 'vocal_style',
  'rhythmic_feel', 'instrumentation', 'dynamic_arc', 'audio_samples',
];

test('AUDIO_KEYS is the eight audio dimensions, each an empty array by default', () => {
  assert.deepEqual(AUDIO_KEYS, [
    'musical_mood', 'sonic_intensity', 'production_texture', 'vocal_style',
    'rhythmic_feel', 'instrumentation', 'dynamic_arc', 'audio_samples',
  ]);
  for (const k of AUDIO_KEYS) assert.deepEqual(EMPTY_FILTERS[k], [], k);
});

test('audio filters survive a state -> URL -> state round trip, several values per key', () => {
  const filters = { ...structuredClone(EMPTY_FILTERS), musical_mood: ['DARK_OMINOUS', 'URGENT_TENSE'], dynamic_arc: ['STEADY_GROOVE'], tempo_from: '90', tempo_to: '140' };
  const params = applyFilterState(new URLSearchParams(), { searchQuery: '', filters });
  const back = readFilterState(params).filters;
  assert.deepEqual(back.musical_mood, ['DARK_OMINOUS', 'URGENT_TENSE']);
  assert.deepEqual(back.dynamic_arc, ['STEADY_GROOVE']);
  assert.equal(back.tempo_from, '90');
  assert.equal(back.tempo_to, '140');
});

test('the retired Sound params are ignored: a stale shared link opens the default browse', () => {
  const stale = new URLSearchParams('sonic_energy=EXPLOSIVE&emotional_mood=DARK&vocal_delivery=SPOKEN');
  const { filters } = readFilterState(stale);
  assert.equal('sonic_energy' in filters, false);
  assert.equal('emotional_mood' in filters, false);
  assert.equal('vocal_delivery' in filters, false);
  assert.equal(hasBrowseParams(stale), false, 'they do not count as browse params either');
});

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
