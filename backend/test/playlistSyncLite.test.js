const { test } = require('node:test');
const assert = require('node:assert');
const { fetchPlaylistTracksLite } = require('../utils/playlistSync');

// No DB, no network: the Spotify client is a fake. Fixture prefix for this file: ZZZLITE.
function fakeApi(total, { nullAt = [], failAt = null } = {}) {
  const calls = [];
  const api = {
    calls,
    async getPlaylistTracks(playlistId, opts) {
      calls.push({ playlistId, ...opts });
      if (failAt === opts.offset) throw Object.assign(new Error('boom'), { statusCode: 500 });
      const items = [];
      for (let i = opts.offset; i < Math.min(total, opts.offset + opts.limit); i++) {
        items.push(nullAt.includes(i) ? { track: null }
          : { track: { id: `ZZZLITE_${i}`, name: `T${i}`, artists: [{ name: `A${i}` }] } });
      }
      return { body: { items, total } };
    },
  };
  return api;
}

test('reads every page, keeps playlist order, and asks only for the slim fields', async () => {
  const api = fakeApi(250);
  const tracks = await fetchPlaylistTracksLite(api, 'PL');
  assert.equal(tracks.length, 250);
  assert.deepEqual(tracks.map((t) => t.spotify_id), [...Array(250).keys()].map((i) => `ZZZLITE_${i}`));
  assert.deepEqual(tracks[7], { spotify_id: 'ZZZLITE_7', title: 'T7', artists: [{ name: 'A7' }] });
  assert.deepEqual(api.calls.map((c) => c.offset).sort((a, b) => a - b), [0, 100, 200]);
  for (const c of api.calls) {
    assert.equal(c.limit, 100);
    assert.match(c.fields, /total/);
    assert.ok(!/album|popularity|external_urls/.test(c.fields), 'slim fields only');
  }
});

test('a single short page needs exactly one request', async () => {
  const api = fakeApi(40);
  assert.equal((await fetchPlaylistTracksLite(api, 'PL')).length, 40);
  assert.equal(api.calls.length, 1);
});

test('an empty playlist returns []', async () => {
  assert.deepEqual(await fetchPlaylistTracksLite(fakeApi(0), 'PL'), []);
});

test('local files / unavailable tracks (no id) are skipped', async () => {
  const tracks = await fetchPlaylistTracksLite(fakeApi(5, { nullAt: [1, 3] }), 'PL');
  assert.deepEqual(tracks.map((t) => t.spotify_id), ['ZZZLITE_0', 'ZZZLITE_2', 'ZZZLITE_4']);
});

test('a failing page rejects (no silent partial playlist, which would make push add everything)', async () => {
  await assert.rejects(() => fetchPlaylistTracksLite(fakeApi(250, { failAt: 100 }), 'PL'), { statusCode: 500 });
});
