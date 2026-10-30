const { test } = require('node:test');
const assert = require('node:assert');
const { parseFacts } = require('../services/bandCheck/musicbrainzFacts');
const { createMusicBrainzAdapter } = require('../services/bandCheck/musicbrainz');

const MBID = '11111111-2222-3333-4444-555555555555';
const rg = (type, date, secondary = []) => ({ 'primary-type': type, 'secondary-types': secondary, 'first-release-date': date });
const member = (name, { ended = false, end = null, attributes = [], direction = 'backward', type = 'member of band' } = {}) =>
  ({ type, direction, ended, end, attributes, artist: { name } });

test('parseFacts: country name, formed year, no disbanded year while active', () => {
  const f = parseFacts({ name: 'Band', country: 'DE', 'life-span': { begin: '2009-03', ended: false }, relations: [] }, []);
  assert.deepEqual([f.name, f.country, f.formed_year, f.disbanded_year, f.last_release_year, f.members], ['Band', 'Germany', 2009, null, null, []]);
});
test('parseFacts: disbanded year only when ended is true', () => {
  assert.equal(parseFacts({ 'life-span': { begin: '2001', end: '2016-05-01', ended: true } }, []).disbanded_year, 2016);
  assert.equal(parseFacts({ 'life-span': { begin: '2001', end: '2016-05-01', ended: false } }, []).disbanded_year, null);
});
test('parseFacts: missing or unknown country and missing dates give nulls, never undefined', () => {
  for (const a of [{}, { country: 'XW' }, { country: 'ZZ' }, { country: 'not a code' }]) {
    const f = parseFacts(a, []);
    assert.deepEqual([f.country, f.formed_year, f.disbanded_year, f.last_release_year], [null, null, null, null]);
  }
});
test('parseFacts: last release counts studio Album/EP/Single only', () => {
  const groups = [rg('Album', '2019-01-01'), rg('Album', '2024-05-05', ['Live']), rg('Single', '2021', ['Remix']), rg('EP', '2022-03'), rg('Album', '2025', ['Compilation']), rg('Album', '2026', ['Demo']), rg('Other', '2026')];
  assert.equal(parseFacts({}, groups).last_release_year, 2022);
  assert.equal(parseFacts({}, [rg('Album', '2024', ['Live']), rg('Album', '2023', ['Compilation'])]).last_release_year, null);
  assert.equal(parseFacts({}, [rg('Album', '')]).last_release_year, null);
});
test('parseFacts: members current/past, live and touring skipped, other relation types ignored, current beats past', () => {
  const f = parseFacts({ relations: [
    member('Ann'), member('Bob', { ended: true, end: '2015' }), member('Cal', { attributes: ['live'] }), member('Dee', { attributes: ['touring'] }),
    member('Eve', { direction: 'forward' }), member('Fay', { type: 'producer' }),
    member('Gus', { ended: true, end: '2010' }), member('Gus'),
  ] }, []);
  assert.deepEqual(f.members, [{ name: 'Ann', is_current: true }, { name: 'Bob', is_current: false }, { name: 'Gus', is_current: true }]);
});

function adapterWith(handler) {
  const urls = [];
  const fetch = async (url) => { urls.push(url); return handler(url); };
  const a = createMusicBrainzAdapter({ fetch, sleep: async () => {}, gapMs: 0 });
  return { a, urls };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('fetchFacts reads the artist then pages release groups, and parses', async () => {
  const { a, urls } = adapterWith((url) => {
    if (url.includes(`/artist/${MBID}`)) return ok({ name: 'Band', country: 'SE', 'life-span': { begin: '1999' }, relations: [member('Ann')] });
    return ok({ 'release-groups': [rg('Album', '2020')] });
  });
  const f = await a.fetchFacts(MBID);
  assert.deepEqual([f.country, f.formed_year, f.last_release_year, f.members.length], ['Sweden', 1999, 2020, 1]);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('inc=artist-rels') && urls[1].includes('/release-group?artist='));
});
test('fetchFacts pages until a short page', async () => {
  let page = 0;
  const { a, urls } = adapterWith((url) => {
    if (url.includes('/artist/')) return ok({});
    page++;
    return ok({ 'release-groups': page === 1 ? Array.from({ length: 100 }, () => rg('Album', '2001')) : [rg('Album', '2018')] });
  });
  assert.equal((await a.fetchFacts(MBID)).last_release_year, 2018);
  assert.equal(urls.length, 3);
});
test('fetchFacts: bad id is NOT_FOUND without a request; a 503 gives a fixed message with no URL', async () => {
  const { a, urls } = adapterWith(() => ({ ok: false, status: 503 }));
  await assert.rejects(a.fetchFacts('nope'), (e) => e.code === 'NOT_FOUND');
  assert.equal(urls.length, 0);
  await assert.rejects(a.fetchFacts(MBID), (e) => e.code === 'RATE_LIMITED' && !/http|musicbrainz\.org/i.test(e.message));
});
