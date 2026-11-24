import test from 'node:test';
import assert from 'node:assert/strict';
import { methodLabel, confidenceLabel, fieldLabel, stateLabel, spotifyArtistLink, albumLine } from './enrichmentText.js';

test('spotifyArtistLink only for a valid id', () => {
  assert.equal(spotifyArtistLink('4Z8W4fKeB5YxbusRsdQVPb'), 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb');
  assert.equal(spotifyArtistLink('javascript:alert(1)'), null);
  assert.equal(spotifyArtistLink('short'), null);
  assert.equal(spotifyArtistLink(null), null);
});
test('albumLine', () => {
  assert.equal(albumLine([{ name: 'A', year: 1999 }, { name: 'B', year: null }]), 'A (1999), B');
  assert.equal(albumLine([]), '');
  assert.equal(albumLine(undefined), '');
});

test('methodLabel names each match method', () => {
  assert.equal(methodLabel('MB_SPOTIFY_URL'), 'Matched by your Spotify link');
  assert.equal(methodLabel('WIKIDATA_P1902'), 'Matched through Wikidata');
  assert.equal(methodLabel('MB_TITLE_VERIFIED'), 'Matched by title, needs your check');
  assert.equal(methodLabel('EXISTING'), 'Already saved');
});
test('methodLabel: unknown, null and undefined do not throw', () => {
  assert.equal(methodLabel('SOMETHING_NEW'), 'Unknown method');
  assert.equal(methodLabel(null), 'Unknown method');
  assert.equal(methodLabel(undefined), 'Unknown method');
  assert.equal(methodLabel('constructor'), 'Unknown method', 'an inherited property is not a label');
});
test('confidenceLabel', () => {
  assert.equal(confidenceLabel('EXACT_ID'), 'Exact');
  assert.equal(confidenceLabel('HIGH'), 'High');
  assert.equal(confidenceLabel('MEDIUM'), 'MEDIUM');
  assert.equal(confidenceLabel(null), '');
  assert.equal(confidenceLabel(undefined), '');
});
test('fieldLabel', () => {
  assert.equal(fieldLabel('country'), 'Country');
  assert.equal(fieldLabel('formed_year'), 'Formed (year)');
  assert.equal(fieldLabel('disbanded_year'), 'Disbanded (year)');
  assert.equal(fieldLabel('last_release_year'), 'Last release (year)');
  assert.equal(fieldLabel('bandcamp_url'), 'Bandcamp link');
  assert.equal(fieldLabel('mystery'), 'mystery');
  assert.equal(fieldLabel(undefined), '');
  assert.equal(fieldLabel('constructor'), 'constructor');
});
test('stateLabel covers the five match states', () => {
  assert.equal(stateLabel('none'), 'No match proposed');
  assert.equal(stateLabel('pretrusted'), 'Exact match, ready to accept');
  assert.equal(stateLabel('needs-approval'), 'Match needs your approval');
  assert.equal(stateLabel('approved'), 'Match approved');
  assert.equal(stateLabel('rejected'), 'Match rejected');
  assert.equal(stateLabel('weird'), 'weird');
  assert.equal(stateLabel(undefined), '');
});
