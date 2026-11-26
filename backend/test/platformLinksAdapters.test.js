const { test } = require('node:test');
const assert = require('node:assert');
const pl = require('../services/platformLinks');

// Fake fetch: answers by a matcher on the URL. Records every URL it was asked for.
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push(String(url));
    const r = handler(String(url), opts);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  f.calls = calls;
  return f;
}

test('normTitle folds case, diacritics and punctuation and drops parentheticals and a trailing " - ..."', () => {
  assert.equal(pl.normTitle('Café  Déjà-Vu!'), 'cafe deja vu');
  assert.equal(pl.normTitle('I Love My Dog - Stereo Version'), 'i love my dog');
  assert.equal(pl.normTitle('I Love My Dog (Mono Single Version)'), 'i love my dog');
  assert.equal(pl.normTitle('Song [Live]'), 'song');
  assert.equal(pl.normTitle(null), '');
});

test('deezerByIsrc returns the track link, and null for a miss or a bad ISRC', async () => {
  const hit = fakeFetch(() => ({ status: 200, body: { id: 1, link: 'https://www.deezer.com/track/1154334' } }));
  assert.deepEqual(await pl.deezerByIsrc('GBF076620670', { fetch: hit }), { url: 'https://www.deezer.com/track/1154334' });
  assert.match(hit.calls[0], /api\.deezer\.com\/track\/isrc:GBF076620670$/);

  const miss = fakeFetch(() => ({ status: 200, body: { error: { type: 'DataException', code: 800 } } }));
  assert.equal(await pl.deezerByIsrc('GBF076620670', { fetch: miss }), null);

  const down = fakeFetch(() => ({ status: 503, body: {} }));
  assert.equal(await pl.deezerByIsrc('GBF076620670', { fetch: down }), null);

  const boom = fakeFetch(() => new Error('connect ECONNREFUSED https://api.deezer.com/track/isrc:X'));
  assert.equal(await pl.deezerByIsrc('GBF076620670', { fetch: boom }), null);

  const never = fakeFetch(() => ({ status: 200, body: {} }));
  assert.equal(await pl.deezerByIsrc('../../etc', { fetch: never }), null);
  assert.equal(never.calls.length, 0, 'a malformed ISRC is never sent');
});

const apple = (results) => fakeFetch(() => ({ status: 200, body: { results } }));
const hitRow = (trackName, artistName, id = 1) => ({ trackName, artistName, trackViewUrl: `https://music.apple.com/us/album/x/${id}?i=${id}&uo=4` });

test('appleSearch is strict about the base title and the artist, and strips uo=4', async () => {
  const r = await pl.appleSearch({ title: 'Carnist Cult Drones', artist: 'Stinkbrute' }, { fetch: apple([hitRow('Carnist Cult Drones', 'Stinkbrute')]) });
  assert.deepEqual(r, { url: 'https://music.apple.com/us/album/x/1?i=1', title: 'Carnist Cult Drones', artist: 'Stinkbrute' });

  // a version suffix shares the base title, so it can match: that is exactly why the curator confirms Apple matches
  const v = await pl.appleSearch({ title: 'I Love My Dog - Stereo Version', artist: 'Cat Stevens' }, { fetch: apple([hitRow('I Love My Dog (Mono Single Version)', 'Cat Stevens')]) });
  assert.equal(v.title, 'I Love My Dog (Mono Single Version)');

  assert.equal(await pl.appleSearch({ title: 'Carnist Cult Drones', artist: 'Stinkbrute' }, { fetch: apple([hitRow('Carnist Drones', 'Stinkbrute')]) }), null, 'a different base title never matches');
  assert.equal(await pl.appleSearch({ title: 'Carnist Cult Drones', artist: 'Stinkbrute' }, { fetch: apple([hitRow('Carnist Cult Drones', 'Someone Else')]) }), null, 'a different artist never matches');
  assert.equal(await pl.appleSearch({ title: 'Carnist Cult Drones', artist: '' }, { fetch: apple([hitRow('Carnist Cult Drones', 'Anyone')]) }), null, 'no artist, no match');
  assert.equal(await pl.appleSearch({ title: 'x', artist: 'y' }, { fetch: apple([]) }), null);
  assert.equal(await pl.appleSearch({ title: 'x', artist: 'y' }, { fetch: fakeFetch(() => ({ status: 500, body: {} })) }), null);
  assert.equal(await pl.appleSearch({ title: 'x', artist: 'y' }, { fetch: fakeFetch(() => new Error('boom')) }), null);
});

test('appleSearch takes the first qualifying hit among several', async () => {
  const r = await pl.appleSearch({ title: 'Song', artist: 'Band Name' },
    { fetch: apple([hitRow('Other', 'Band Name', 1), hitRow('Song', 'Band Name', 2), hitRow('Song', 'Band Name', 3)]) });
  assert.match(r.url, /\/2\?i=2$/);
});

test('spotifyIsrc returns the ISRC, null when absent or missing, and throws UPSTREAM on 429 / 5xx / network without leaking the URL', async () => {
  const getToken = async () => 'tok';
  const ok = fakeFetch(() => ({ status: 200, body: { external_ids: { isrc: 'GBF076620670' } } }));
  assert.equal(await pl.spotifyIsrc('abc123', { fetch: ok, getToken }), 'GBF076620670');
  assert.match(ok.calls[0], /api\.spotify\.com\/v1\/tracks\/abc123$/);

  assert.equal(await pl.spotifyIsrc('abc123', { fetch: fakeFetch(() => ({ status: 200, body: { external_ids: {} } })), getToken }), null);
  assert.equal(await pl.spotifyIsrc('abc123', { fetch: fakeFetch(() => ({ status: 200, body: {} })), getToken }), null);
  assert.equal(await pl.spotifyIsrc('abc123', { fetch: fakeFetch(() => ({ status: 404, body: {} })), getToken }), null);

  for (const h of [() => ({ status: 429, body: {} }), () => ({ status: 503, body: {} }), () => new Error('connect ECONNREFUSED https://api.spotify.com/v1/tracks/abc123')]) {
    await assert.rejects(pl.spotifyIsrc('abc123', { fetch: fakeFetch(h), getToken }), (e) => {
      assert.equal(e.code, 'UPSTREAM');
      assert.ok(!/spotify\.com|abc123/.test(e.message), 'the error message carries no URL');
      return true;
    });
  }
});

test('appleSearch matches the first artist as a whole name, not a substring', async () => {
  const want = (title, artist, row) => pl.appleSearch({ title, artist }, { fetch: apple([row]) });
  assert.equal(await want('Home', 'Rise', hitRow('Home', 'Sunrise Avenue')), null, 'a name inside another name is not a match');
  assert.equal(await want('Home', 'The Smiths', hitRow('Home', 'The Smithereens')), null, 'a shared prefix is not a match');
  assert.equal(await want('Home', 'X', hitRow('Home', 'Alex Max')), null, 'a one-letter name never matches inside others');
  assert.ok(await want('Home', 'Stinkbrute', hitRow('Home', 'Stinkbrute & Friends')), 'a collaboration credit still matches');
  assert.ok(await want('Home', 'Stinkbrute', hitRow('Home', 'Stinkbrute feat. Someone')), 'a featuring credit still matches');
  assert.ok(await want('Home', 'Beyoncé', hitRow('Home', 'Beyonce')), 'case and diacritics are folded');
});
