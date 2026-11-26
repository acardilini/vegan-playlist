import test from 'node:test';
import assert from 'node:assert/strict';
import { listenLinks } from './platformLinks.js';

const SP = 'https://open.spotify.com/track/abc';

test('the row is Spotify, Apple Music, Deezer, Tidal in that order, whatever order the server sends', () => {
  const out = listenLinks({
    spotify_url: SP,
    platform_links: [
      { platform: 'tidal', url: 'https://tidal.com/track/1' },
      { platform: 'deezer', url: 'https://www.deezer.com/track/1' },
      { platform: 'apple_music', url: 'https://music.apple.com/us/album/x/1' },
    ],
  });
  assert.deepEqual(out.map((x) => x.key), ['spotify', 'apple_music', 'deezer', 'tidal']);
  assert.deepEqual(out.map((x) => x.label), ['Spotify', 'Apple Music', 'Deezer', 'Tidal']);
  assert.equal(out[0].url, SP);
});

test('Spotify drops out when the curator marked it dormant or there is no URL, and the others stay', () => {
  const pl = [{ platform: 'deezer', url: 'https://www.deezer.com/track/1' }];
  assert.deepEqual(listenLinks({ spotify_url: SP, spotify_dormant: true, platform_links: pl }).map((x) => x.key), ['deezer']);
  assert.deepEqual(listenLinks({ spotify_url: null, platform_links: pl }).map((x) => x.key), ['deezer']);
});

test('only Spotify, or nothing, are both fine', () => {
  assert.deepEqual(listenLinks({ spotify_url: SP }).map((x) => x.key), ['spotify']);
  assert.deepEqual(listenLinks({}), []);
  assert.deepEqual(listenLinks(), []);
  assert.deepEqual(listenLinks({ platform_links: null }), []);
});

test('unknown platforms, non-http(s) URLs and duplicates are dropped', () => {
  const out = listenLinks({
    platform_links: [
      { platform: 'napster', url: 'https://napster.com/x' },
      { platform: 'constructor', url: 'https://example.com/x' },
      { platform: 'deezer', url: 'javascript:alert(1)' },
      { platform: 'apple_music', url: 'https://music.apple.com/us/album/x/1' },
      { platform: 'apple_music', url: 'https://music.apple.com/us/album/x/2' },
      null,
    ],
  });
  assert.deepEqual(out.map((x) => x.key), ['apple_music']);
  assert.match(out[0].url, /\/1$/, 'the first of a duplicate wins');
});
