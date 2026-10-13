const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../services/bandCheck/merge');
const { sourceError } = require('../services/bandCheck/errors');

const sp = (id, name, type, date, tracks) => ({ id, name, album_type: type, release_date: date, url: null, tracks });
const tr = (title, id, url) => ({ title, id, url: url || null, mapped: { spotify_id: id, title } });

test('creditsArtist matches on the Spotify artist id only', () => {
  assert.equal(m.creditsArtist({ artists: [{ id: 'A' }, { id: 'B' }] }, 'B'), true);
  assert.equal(m.creditsArtist({ artists: [{ id: 'A' }] }, 'B'), false);
  assert.equal(m.creditsArtist({ artists: [{ id: 'A' }] }, null), false);
  assert.equal(m.creditsArtist({}, 'A'), false);
});

test('preferRelease: album beats compilation beats single, then earliest date, then id; MusicBrainz last', () => {
  const rel = (o) => ({ source: 'spotify', id: 'x', album_type: 'album', release_date: '2020', ...o });
  assert.ok(m.preferRelease(rel({}), rel({ album_type: 'single' })) < 0);
  assert.ok(m.preferRelease(rel({ album_type: 'compilation' }), rel({ album_type: 'single' })) < 0);
  assert.ok(m.preferRelease(rel({ release_date: '2019' }), rel({ release_date: '2020' })) < 0);
  assert.ok(m.preferRelease(rel({ id: 'a' }), rel({ id: 'b' })) < 0);
  assert.ok(m.preferRelease(rel({ source: 'bandcamp', album_type: 'single' }), rel({ source: 'musicbrainz', album_type: 'album' })) < 0);
});

test('mergeCatalogues collapses a single and its album, keeping every alternate Spotify id', () => {
  const songs = m.mergeCatalogues([{ source: 'spotify', releases: [
    sp('r1', 'The Floor (single)', 'single', '2019-01-01', [tr('The Floor', 'id1')]),
    sp('r2', 'Album', 'album', '2020-05-05', [tr('The Floor', 'id2'), tr('Other', 'id3')]),
  ] }]);
  assert.equal(songs.length, 2);
  const floor = songs.find(s => s.key === 'the floor');
  assert.deepEqual(floor.sources.spotify.ids.sort(), ['id1', 'id2']);
  assert.equal(floor.release.name, 'Album');
  assert.deepEqual(floor.also_on, ['The Floor (single)']);
});

test('one song on three sources is one song with three source entries', () => {
  const songs = m.mergeCatalogues([
    { source: 'spotify', releases: [sp('r1', 'Alb', 'album', '2020', [tr('Rubble From Bone', 's1', 'https://open.spotify.com/track/s1')])] },
    { source: 'bandcamp', releases: [{ id: '/album/alb', name: 'Alb', album_type: 'album', release_date: '2020-01-01', url: null,
      tracks: [{ title: 'Rubble from Bone', id: null, url: 'https://x.bandcamp.com/track/rubble' }] }] },
    { source: 'musicbrainz', releases: [{ id: 'mb', name: 'MusicBrainz recordings', album_type: null, release_date: null, url: null,
      tracks: [{ title: 'rubble from bone', id: 'm1', url: null }, { title: 'rubble from bone', id: 'm2', url: null }] }] },
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(Object.keys(songs[0].sources).sort(), ['bandcamp', 'musicbrainz', 'spotify']);
  assert.equal(songs[0].sources.bandcamp.url, 'https://x.bandcamp.com/track/rubble');
  assert.equal(songs[0].sources.musicbrainz.count, 2);
  assert.notEqual(songs[0].release.source, 'musicbrainz');
  assert.ok(!songs[0].also_on.includes('MusicBrainz recordings'));
});

test('a Bandcamp-only song stays single-source', () => {
  const songs = m.mergeCatalogues([{ source: 'bandcamp', releases: [{ id: '/track/t', name: 'T', album_type: 'single', release_date: null, url: null,
    tracks: [{ title: 'Only Here', id: null, url: 'https://x.bandcamp.com/track/t' }] }] }]);
  assert.deepEqual(Object.keys(songs[0].sources), ['bandcamp']);
});

test('non-Latin and symbol-only titles neither vanish nor collapse together', () => {
  const songs = m.mergeCatalogues([{ source: 'bandcamp', releases: [{ id: '/album/a', name: 'A', album_type: 'album', release_date: null, url: null, tracks: [
    { title: 'Смерть', id: null, url: null }, { title: 'Жизнь', id: null, url: null }, { title: '???', id: null, url: null }, { title: '   ', id: null, url: null },
  ] }] }]);
  assert.deepEqual(songs.map(s => s.title).sort(), ['???', 'Жизнь', 'Смерть'].sort());
});

test('classify: spotify id, bandcamp url and title matches; rejected flagged; none is new', () => {
  const index = m.buildIndex([
    { id: 1, title: 'Held By Id', status: 'included', published: true, spotify_id: 'idA', bandcamp_url: null, by_artist: true },
    { id: 2, title: 'Zzz', status: 'pending', published: false, spotify_id: null, bandcamp_url: 'https://X.bandcamp.com/track/held/?utm=1', by_artist: true },
    { id: 3, title: 'Held By Title (Live)', status: 'rejected', published: false, spotify_id: null, bandcamp_url: null, by_artist: true },
    { id: 4, title: 'Not This Band', status: 'included', published: true, spotify_id: null, bandcamp_url: null, by_artist: false },
  ]);
  const songs = [
    { key: 'a', sources: { spotify: { ids: ['nope', 'idA'] } } },
    { key: 'b', sources: { bandcamp: { url: 'https://x.bandcamp.com/track/held' } } },
    { key: 'held by title', sources: { musicbrainz: { count: 1 } } },
    { key: 'not this band', sources: { musicbrainz: { count: 1 } } },
  ];
  const out = m.classify(songs, index);
  assert.deepEqual(out.map(s => s.state), ['in_catalogue', 'in_catalogue', 'in_catalogue', 'new']);
  assert.deepEqual(out.map(s => s.match && s.match.matched_by), ['spotify_id', 'bandcamp_url', 'title', null]);
  assert.equal(out[2].match.status, 'rejected');
});

test('sourceError drops the original message and maps statuses', () => {
  const e = sourceError(Object.assign(new Error('secret token in here'), { statusCode: 429 }));
  assert.equal(e.code, 'RATE_LIMITED');
  assert.ok(!/secret/.test(e.message));
  assert.equal(sourceError(new Error('boom')).code, 'UPSTREAM');
  assert.equal(sourceError(Object.assign(new Error('x'), { code: 'UNREADABLE' })).code, 'UNREADABLE');
});
