import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLink } from './factSources.js';

const MB = '5b11f4ce-a62d-471e-81fc-a69a8278c7da';

test('MusicBrainz links to the artist page from a valid id', () => {
  assert.equal(sourceLink('MusicBrainz', { musicbrainz_id: MB }), `https://musicbrainz.org/artist/${MB}`);
  assert.equal(sourceLink('MusicBrainz', { musicbrainz_id: MB.toUpperCase() }), `https://musicbrainz.org/artist/${MB.toUpperCase()}`);
});
test('MusicBrainz gives no link without a valid id', () => {
  for (const a of [{}, null, undefined, { musicbrainz_id: null }, { musicbrainz_id: 'not-a-uuid' }, { musicbrainz_id: `${MB}/../x` }]) assert.equal(sourceLink('MusicBrainz', a), null);
});
test('Bandcamp links to the stored http(s) url only', () => {
  assert.equal(sourceLink('Bandcamp', { bandcamp_url: 'https://band.bandcamp.com' }), 'https://band.bandcamp.com');
  assert.equal(sourceLink('Bandcamp', { bandcamp_url: 'http://band.bandcamp.com/music' }), 'http://band.bandcamp.com/music');
  for (const u of ['javascript:alert(1)', 'band.bandcamp.com', '', null, undefined]) assert.equal(sourceLink('Bandcamp', { bandcamp_url: u }), null);
});
test('other sources have no link', () => {
  const a = { musicbrainz_id: MB, bandcamp_url: 'https://band.bandcamp.com' };
  for (const s of ['Wikidata', 'Catalogue Albums', 'Gemini Web Search', 'Added by curator', '', undefined, null]) assert.equal(sourceLink(s, a), null);
});
