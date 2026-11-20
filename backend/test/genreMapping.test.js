const { test } = require('node:test');
const assert = require('node:assert');
const gm = require('../utils/genreMapping');

// Pure tests: this file touches no DB (no sentinel needed).

test('every subgenre appears under exactly one parent', () => {
  const seen = new Map();
  const dupes = [];
  for (const [parent, subs] of Object.entries(gm.GENRE_HIERARCHY)) {
    for (const s of subs) {
      if (seen.has(s)) dupes.push(`${s} (${seen.get(s)} and ${parent})`);
      else seen.set(s, parent);
    }
  }
  assert.deepEqual(dupes, []);
});

test('every entry is lower-case and trimmed, so lookups after normalising always hit', () => {
  for (const [parent, subs] of Object.entries(gm.GENRE_HIERARCHY)) {
    assert.equal(parent, parent.toLowerCase().trim());
    for (const s of subs) assert.equal(s, s.toLowerCase().trim(), `${parent}: "${s}"`);
  }
});

test('a parent genre is its own parent (rock and metal were filed under other)', () => {
  for (const parent of Object.keys(gm.GENRE_HIERARCHY)) {
    assert.equal(gm.getParentGenre(parent), parent, parent);
  }
  assert.equal(gm.getParentGenre(' Rock '), 'rock');
  assert.equal(gm.getParentGenre('METAL'), 'metal');
});

test('the four former duplicates each resolve to the parent that matches the stored rows', () => {
  assert.equal(gm.getParentGenre('folk punk'), 'folk');
  assert.equal(gm.getParentGenre('folk rock'), 'folk');
  assert.equal(gm.getParentGenre('blues rock'), 'blues');
  assert.equal(gm.getParentGenre('pop soul'), 'soul');
});

test('genres that used to fall into other now have a home', () => {
  const expected = {
    'horror punk': 'punk', 'deathrock': 'punk', 'psychobilly': 'punk',
    'pop rock': 'rock', 'acoustic rock': 'rock', 'funk rock': 'rock', 'reggae rock': 'rock',
    'norsk rock': 'rock', 'german indie': 'rock', 'southern gothic': 'rock',
    'folk pop': 'folk', 'mincecore': 'metal', 'latin hip hop': 'hip-hop', 'french rap': 'hip-hop',
    'german hip hop': 'hip-hop', 'chicago drill': 'hip-hop', 'chicago house': 'electronic',
    'italo disco': 'electronic', 'ballroom vogue': 'electronic', 'jazz pop': 'jazz',
    'malay pop': 'pop', 'baroque': 'classical', 'country': 'country', 'alt-country': 'country',
    'zouk': 'world', 'kizomba': 'world', 'neoperreo': 'world', 'funkot': 'world',
    'spoken word': 'spoken-word', 'comedy': 'spoken-word',
    'crust punk': 'punk', 'd-beat': 'punk', 'powerviolence': 'hardcore', 'deathgrind': 'metal',
    'post-metal': 'metal', 'synthwave': 'electronic', 'r&b': 'soul', 'shoegaze': 'rock',
    'boom bap': 'hip-hop', 'trap': 'hip-hop', 'post-rock': 'rock',
  };
  for (const [genre, parent] of Object.entries(expected)) {
    assert.equal(gm.getParentGenre(genre), parent, genre);
  }
});

test('genres that stay deliberately unclassified still file under other', () => {
  for (const g of ['christian', 'worship', "children's music", 'musicals', 'soundtrack', 'experimental']) {
    assert.equal(gm.getParentGenre(g), 'other', g);
  }
  assert.equal(gm.getParentGenre('zz totally unknown genre'), 'other');
});

test('getParentGenre of nothing is null', () => {
  assert.equal(gm.getParentGenre(''), null);
  assert.equal(gm.getParentGenre(null), null);
});

test('the hierarchy is loaded from the shared JSON file', () => {
  const json = require('../data/genre_hierarchy.json');
  assert.deepEqual(gm.GENRE_HIERARCHY, json);
});
