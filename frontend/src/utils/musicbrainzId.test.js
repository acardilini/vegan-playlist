import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicBrainzId } from './musicbrainzId.js';

const ID = '5b11f4ce-a62d-471e-81fc-a69a8278c7da';

test('a bare id, any case, padded with spaces', () => {
  assert.equal(parseMusicBrainzId(ID), ID);
  assert.equal(parseMusicBrainzId(ID.toUpperCase()), ID);
  assert.equal(parseMusicBrainzId(`  ${ID}  `), ID);
});
test('an artist URL in its usual forms', () => {
  assert.equal(parseMusicBrainzId(`https://musicbrainz.org/artist/${ID}`), ID);
  assert.equal(parseMusicBrainzId(`http://musicbrainz.org/artist/${ID}/`), ID);
  assert.equal(parseMusicBrainzId(`https://musicbrainz.org/artist/${ID}/edit`), ID);
  assert.equal(parseMusicBrainzId(`https://musicbrainz.org/artist/${ID}?x=1`), ID);
  assert.equal(parseMusicBrainzId(`musicbrainz.org/artist/${ID}#top`), ID);
  assert.equal(parseMusicBrainzId(`HTTPS://MUSICBRAINZ.ORG/artist/${ID.toUpperCase()}`), ID);
  assert.equal(parseMusicBrainzId(`https://beta.musicbrainz.org/artist/${ID}`), ID);
});
test('anything else is null', () => {
  assert.equal(parseMusicBrainzId(''), null);
  assert.equal(parseMusicBrainzId('hello'), null);
  assert.equal(parseMusicBrainzId(null), null);
  assert.equal(parseMusicBrainzId(undefined), null);
  assert.equal(parseMusicBrainzId(`https://musicbrainz.org/release/${ID}`), null);
  assert.equal(parseMusicBrainzId(`https://example.com/artist/${ID}`), null);
  assert.equal(parseMusicBrainzId(ID.slice(0, -1)), null);
  assert.equal(parseMusicBrainzId(`${ID}0`), null);
});
