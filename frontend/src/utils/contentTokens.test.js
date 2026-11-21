import test from 'node:test';
import assert from 'node:assert/strict';
import { substituteTokens, tokenValues } from './contentTokens.js';

const COVERAGE = {
  live_songs: 1333,
  artists: 635,
  analysed_songs: 693,
  mapped_songs: 640,
  latest_pass_models: [
    { model: 'gemini-3.5-flash-lite', songs: 692 },
    { model: 'gemma4:deep_pipeline', songs: 1 },
  ],
  latest_pass_at: '2026-07-26T02:00:52.446Z',
  audio: { analysed: 640, models: [{ model: 'gemini-audio-x', songs: 640 }], latest: '2026-11-18T09:30:00.000Z' },
};

test('known tokens substitute', () => {
  assert.equal(substituteTokens('We hold {{songs}} songs.', { songs: '1,333' }),
    'We hold 1,333 songs.');
});

test('an unknown token is left exactly as written, so a typo is visible', () => {
  assert.equal(substituteTokens('{{sngs}} songs', { songs: '1,333' }), '{{sngs}} songs');
});

test('a token inside inline code or a fenced block is left alone', () => {
  assert.equal(substituteTokens('Write `{{songs}}` to get {{songs}}.', { songs: '1,333' }),
    'Write `{{songs}}` to get 1,333.');
  assert.equal(
    substituteTokens('```\n{{songs}}\n```\n{{songs}}', { songs: '1,333' }),
    '```\n{{songs}}\n```\n1,333');
});

test('empty or missing markdown yields an empty string', () => {
  assert.equal(substituteTokens('', { songs: '1' }), '');
  assert.equal(substituteTokens(null, { songs: '1' }), '');
  assert.equal(substituteTokens(undefined, {}), '');
});

test('tokenValues formats every documented token', () => {
  const v = tokenValues(COVERAGE);
  assert.equal(v.songs, '1,333');
  assert.equal(v.artists, '635');
  assert.equal(v.analysed, '693');
  assert.equal(v.analysedPct, '52%');
  assert.equal(v.mapped, '640');
  assert.equal(v.codingModels, 'gemini-3.5-flash-lite and gemma4:deep_pipeline');
  assert.equal(v.codingDate, 'July 2026');
});

test('one model reads as one name, three read as a list', () => {
  const one = tokenValues({ ...COVERAGE, latest_pass_models: [{ model: 'a', songs: 5 }] });
  assert.equal(one.codingModels, 'a');
  const three = tokenValues({
    ...COVERAGE,
    latest_pass_models: [{ model: 'a', songs: 5 }, { model: 'b', songs: 3 }, { model: 'c', songs: 1 }],
  });
  assert.equal(three.codingModels, 'a, b and c');
});

test('tokenValues formats the four audio tokens from coverage.audio', () => {
  const v = tokenValues(COVERAGE);
  assert.equal(v.audioAnalysed, '640');
  assert.equal(v.audioAnalysedPct, '48%');
  assert.equal(v.audioModels, 'gemini-audio-x');
  assert.equal(v.audioDate, 'November 2026');
});

test('the audio tokens read as a dash when there is no audio coverage', () => {
  for (const c of [null, {}, { ...COVERAGE, audio: undefined }, { ...COVERAGE, audio: { analysed: 0, models: [], latest: null } }]) {
    const v = tokenValues(c);
    if (c && c.audio) assert.equal(v.audioAnalysed, '0');
    else assert.equal(v.audioAnalysed, '—');
    assert.equal(v.audioModels, '—');
    assert.equal(v.audioDate, '—');
  }
  assert.equal(tokenValues({ live_songs: 0, audio: { analysed: 5, models: [], latest: null } }).audioAnalysedPct, '—',
    'no live songs: no percentage rather than a division by zero');
});

test('tokenValues survives a missing or empty coverage block', () => {
  const v = tokenValues(null);
  assert.equal(v.songs, '—');
  assert.equal(v.codingModels, '—');
  assert.equal(v.codingDate, '—');
});
