const { test } = require('node:test');
const assert = require('node:assert');
const { createSpotifyAdapter } = require('../services/bandCheck/spotify');

const BAND = 'bandid0000000000000000';
const album = (id, name, type, date) => ({ id, name, album_type: type, release_date: date, images: [], total_tracks: 2, external_urls: { spotify: `https://open.spotify.com/album/${id}` } });
const track = (id, name, artistIds) => ({ id, name, track_number: 1, disc_number: 1, duration_ms: 1000, explicit: false, external_urls: { spotify: `https://open.spotify.com/track/${id}` }, artists: artistIds.map(a => ({ id: a, name: a })) });

function fakeApi({ albums, tracksByAlbum, calls = [] }) {
  return {
    calls,
    searchArtists: async (q) => { calls.push(['search', q]); return { body: { artists: { items: [{ id: BAND, name: 'Bloodmouth', followers: { total: 1234 }, genres: ['grindcore'], external_urls: { spotify: 'https://open.spotify.com/artist/x' } }] } } }; },
    getArtistAlbums: async (id, o) => { calls.push(['albums', id, o.offset]); return { body: { items: albums.slice(o.offset, o.offset + o.limit) } }; },
    getAlbumTracks: async (id, o) => { calls.push(['tracks', id, o.offset]); return { body: { items: (tracksByAlbum[id] || []).slice(o.offset, o.offset + o.limit) } }; },
  };
}
const adapterFor = (api) => createSpotifyAdapter({ getApi: async () => api, retry: (fn) => fn() });

test('fetchCatalogue keeps only tracks crediting the band and maps them with the release as album', async () => {
  const api = fakeApi({
    albums: [album('r1', 'Own Album', 'album', '2020'), album('r2', 'Comp', 'compilation', '2021'), album('r3', 'Others', 'compilation', '2022')],
    tracksByAlbum: {
      r1: [track('t1', 'Song A', [BAND]), track('t2', 'Song B', [BAND, 'guest'])],
      r2: [track('t3', 'Other Band Song', ['other']), track('t4', 'Black Mass', ['other', BAND])],
      r3: [track('t5', 'Nope', ['other'])],
    },
  });
  const cat = await adapterFor(api).fetchCatalogue(BAND);
  assert.equal(cat.source, 'spotify');
  assert.deepEqual(cat.releases.map(r => r.name), ['Own Album', 'Comp']); // 'Others' credits nobody -> dropped
  assert.deepEqual(cat.releases[1].tracks.map(t => t.title), ['Black Mass']);
  const t = cat.releases[0].tracks[0];
  assert.equal(t.id, 't1');
  assert.equal(t.mapped.album.name, 'Own Album');
  assert.equal(t.mapped.spotify_id, 't1');
});

test('fetchCatalogue pages albums and tracks of exactly 50', async () => {
  const albums = Array.from({ length: 51 }, (_, i) => album('r' + i, 'A' + i, 'single', '2020'));
  const tracksByAlbum = Object.fromEntries(albums.map(a => [a.id, [track('t' + a.id, 'S' + a.id, [BAND])]]));
  const api = fakeApi({ albums, tracksByAlbum });
  const cat = await adapterFor(api).fetchCatalogue(BAND);
  assert.equal(cat.releases.length, 51);
  assert.deepEqual(api.calls.filter(c => c[0] === 'albums').map(c => c[2]), [0, 50]);
});

test('identify maps artist search results to candidates', async () => {
  const c = await adapterFor(fakeApi({ albums: [], tracksByAlbum: {} })).identify('Bloodmouth');
  assert.deepEqual(c, [{ value: BAND, label: 'Bloodmouth', detail: '1,234 followers · grindcore', url: 'https://open.spotify.com/artist/x' }]);
});

test('a 429 surfaces as RATE_LIMITED without the original message', async () => {
  const api = { getArtistAlbums: async () => { throw Object.assign(new Error('Bearer abc123'), { statusCode: 429 }); } };
  await assert.rejects(adapterFor(api).fetchCatalogue(BAND), (e) => e.code === 'RATE_LIMITED' && !/abc123/.test(e.message));
});

test('paging follows `next` even when a page is short, and stops without it', async () => {
  const pagesSeen = [];
  const api = {
    getArtistAlbums: async (id, o) => {
      pagesSeen.push(o.offset);
      if (o.offset === 0) return { body: { items: Array.from({ length: 20 }, (_, i) => album('p' + i, 'P' + i, 'single', '2020')), next: 'https://api.spotify.com/next' } };
      return { body: { items: [album('q0', 'Q0', 'single', '2020')], next: null } };
    },
    getAlbumTracks: async (id) => ({ body: { items: [track('t' + id, 'S' + id, [BAND])] } }),
  };
  const cat = await adapterFor(api).fetchCatalogue(BAND);
  assert.deepEqual(pagesSeen, [0, 50]);
  assert.equal(cat.releases.length, 21);
});
