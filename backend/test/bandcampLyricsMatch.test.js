const { test } = require('node:test');
const assert = require('node:assert');
const { matchSongs, creditMatches } = require('../services/bandcampLyrics/match');

const song = (id, title, artists = ['Band']) => ({ id, title, artists });
const track = (title) => ({ title, url: 'https://band.bandcamp.com/track/' + title.toLowerCase().replace(/\W+/g, '-') });

test('matchSongs matches by normalised title ignoring case, accents, punctuation and parentheticals', () => {
  const r = matchSongs(
    [song(1, 'Prism Warden'), song(2, 'Café Déjà Vu'), song(3, "Don't Look!")],
    [track('PRISM WARDEN (Remastered)'), track('Cafe Deja Vu'), track('Dont Look')]);
  assert.deepEqual(r.matched.map(m => m.songId).sort(), [1, 2, 3]);
  assert.deepEqual(r.ambiguous, []);
  assert.deepEqual(r.unmatched, []);
});

test('matchSongs puts a song with two same-title Bandcamp tracks in ambiguous and offers no match', () => {
  const r = matchSongs([song(1, 'Anthem')], [track('Anthem'), track('Anthem (Live)')]);
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.ambiguous, [1]);
});

test('matchSongs puts a song with no Bandcamp title in unmatched and ignores extra Bandcamp tracks', () => {
  const r = matchSongs([song(1, 'Alpha'), song(2, 'Beta')], [track('Alpha'), track('Gamma')]);
  assert.deepEqual(r.matched.map(m => m.songId), [1]);
  assert.equal(r.matched[0].url, 'https://band.bandcamp.com/track/alpha');
  assert.deepEqual(r.unmatched, [2]);
});

test('matchSongs never matches an empty-key title', () => {
  const r = matchSongs([song(1, '???')], [track('!!!')]);
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.unmatched, [1]);
});

test('creditMatches accepts equal, contained and containing names, and a missing credit', () => {
  assert.equal(creditMatches('Earth Crisis', ['Earth Crisis']), true);
  assert.equal(creditMatches('EARTH CRISIS (US)', ['Earth Crisis']), true);
  assert.equal(creditMatches('Crisis', ['Earth Crisis']), true);
  assert.equal(creditMatches('Béla', ['Bela']), true);
  assert.equal(creditMatches(null, ['Anyone']), true);
  assert.equal(creditMatches('   ', ['Anyone']), true);
});

test('creditMatches rejects an unrelated band', () => {
  assert.equal(creditMatches('Other Band', ['Bloodmouth']), false);
  assert.equal(creditMatches('Other Band', []), false);
});
