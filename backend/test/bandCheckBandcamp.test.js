const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeBandcampOrigin, createBandcampAdapter } = require('../services/bandCheck/bandcamp');

const ORIGIN = 'https://bloodmouth.bandcamp.com';
const page = (body) => ({ ok: true, status: 200, text: async () => body });
const ld = (obj) => `<html><script type="application/ld+json">${JSON.stringify(obj)}</script></html>`;
const album = (name, tracks, date = '13 Jun 2019 12:32:59 GMT') => ld({
  '@type': 'MusicAlbum', name, datePublished: date,
  track: { itemListElement: tracks.map((t, i) => ({ position: i + 1, item: { name: t, '@id': `${ORIGIN}/track/${t.replace(/ /g, '-')}` } })) },
});
const MUSIC = '<a href="/album/one">x</a><a href="/album/one">dup</a><a href="/track/lone">y</a><a href="/album/two?label=1">z</a>';

function adapterFor(map) {
  const urls = [];
  const a = createBandcampAdapter({
    fetch: async (url) => { urls.push(url); const v = map[url]; return v === undefined ? { ok: false, status: 404, text: async () => '' } : v; },
    sleep: async () => {},
  });
  return { a, urls };
}

test('normalizeBandcampOrigin accepts only https *.bandcamp.com and returns the bare origin', () => {
  assert.equal(normalizeBandcampOrigin('https://Bloodmouth.bandcamp.com/album/x?y=1'), ORIGIN);
  assert.equal(normalizeBandcampOrigin('http://bloodmouth.bandcamp.com/'), ORIGIN);
  assert.equal(normalizeBandcampOrigin('bloodmouth.bandcamp.com'), null); // needs a scheme
  for (const bad of ['https://bandcamp.com/', 'https://bloodmouth.bandcamp.com.evil.com/', 'https://evil.com/bloodmouth.bandcamp.com', 'javascript:alert(1)', 'https://music.example.org/', '', null, undefined]) {
    assert.equal(normalizeBandcampOrigin(bad), null, String(bad));
  }
});

test('fetchCatalogue reads releases from /music and tracks from each page JSON-LD', async () => {
  const { a } = adapterFor({
    [ORIGIN + '/music']: page(MUSIC),
    [ORIGIN + '/album/one']: page(album('One', ['Prism Warden', 'Paleo Christ'])),
    [ORIGIN + '/track/lone']: page(ld({ '@type': 'MusicRecording', name: 'Lone Song', '@id': ORIGIN + '/track/lone', datePublished: '01 Jan 2020 00:00:00 GMT' })),
    [ORIGIN + '/album/two']: page(album('Two', ['Third'])),
  });
  const cat = await a.fetchCatalogue(ORIGIN);
  assert.equal(cat.source, 'bandcamp');
  assert.deepEqual(cat.releases.map(r => r.name), ['One', 'Lone Song', 'Two']);
  assert.deepEqual(cat.releases[0].tracks.map(t => t.title), ['Prism Warden', 'Paleo Christ']);
  assert.equal(cat.releases[0].tracks[0].url, ORIGIN + '/track/Prism-Warden');
  assert.equal(cat.releases[0].release_date, '2019-06-13');
  assert.equal(cat.releases[1].album_type, 'single');
  assert.equal(cat.releases[1].tracks[0].url, ORIGIN + '/track/lone');
});

test('one unreadable release is skipped; all unreadable is UNREADABLE', async () => {
  const some = adapterFor({ [ORIGIN + '/music']: page('<a href="/album/one">x</a><a href="/album/two">y</a>'), [ORIGIN + '/album/one']: page('<html>no json</html>'), [ORIGIN + '/album/two']: page(album('Two', ['T'])) });
  assert.deepEqual((await some.a.fetchCatalogue(ORIGIN)).releases.map(r => r.name), ['Two']);
  const none = adapterFor({ [ORIGIN + '/music']: page('<a href="/album/one">x</a>'), [ORIGIN + '/album/one']: page('<script type="application/ld+json">{not json</script>') });
  await assert.rejects(none.a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
  const empty = adapterFor({ [ORIGIN + '/music']: page('<html>nothing</html>') });
  await assert.rejects(empty.a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
});

test('caps at 40 releases and refuses a non-bandcamp origin without fetching', async () => {
  const links = Array.from({ length: 60 }, (_, i) => `<a href="/album/a${i}">x</a>`).join('');
  const map = { [ORIGIN + '/music']: page(links) };
  for (let i = 0; i < 60; i++) map[ORIGIN + '/album/a' + i] = page(album('A' + i, ['T' + i]));
  const { a, urls } = adapterFor(map);
  assert.equal((await a.fetchCatalogue(ORIGIN)).releases.length, 40);
  assert.equal(urls.length, 41);
  const bad = adapterFor({});
  await assert.rejects(bad.a.fetchCatalogue('https://evil.com'), (e) => e.code === 'NOT_FOUND');
  assert.equal(bad.urls.length, 0);
});

test('a 404 on /music is NOT_FOUND and a thrown fetch is UPSTREAM without its message', async () => {
  await assert.rejects(adapterFor({}).a.fetchCatalogue(ORIGIN), (e) => e.code === 'NOT_FOUND');
  const a = createBandcampAdapter({ fetch: async () => { throw new Error('ECONNRESET secret'); }, sleep: async () => {} });
  await assert.rejects(a.fetchCatalogue(ORIGIN), (e) => e.code === 'UPSTREAM' && !/secret/.test(e.message));
});

test('a scraped track @id with a non-https scheme falls back to the release url', async () => {
  const mk = (id) => ld({ '@type': 'MusicRecording', name: 'Sneaky', '@id': id });
  for (const id of ['javascript://bloodmouth.bandcamp.com/%0aalert(1)', 'http://bloodmouth.bandcamp.com/track/sneaky']) {
    const { a } = adapterFor({ [ORIGIN + '/music']: page('<a href="/track/sneaky">x</a>'), [ORIGIN + '/track/sneaky']: page(mk(id)) });
    assert.equal((await a.fetchCatalogue(ORIGIN)).releases[0].tracks[0].url, ORIGIN + '/track/sneaky', id);
  }
});

test('truncated is true only when /music lists more than 40 releases', async () => {
  const build = (n) => {
    const map = { [ORIGIN + '/music']: page(Array.from({ length: n }, (_, i) => `<a href="/album/a${i}">x</a>`).join('')) };
    for (let i = 0; i < n; i++) map[ORIGIN + '/album/a' + i] = page(album('A' + i, ['T' + i]));
    return adapterFor(map).a;
  };
  assert.equal((await build(60).fetchCatalogue(ORIGIN)).truncated, true);
  assert.equal((await build(40).fetchCatalogue(ORIGIN)).truncated, false);
  assert.equal((await build(3).fetchCatalogue(ORIGIN)).truncated, false);
});

const redirect = (to, status = 301) => ({ ok: false, status, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? to : null) }, text: async () => '' });

test('requests do not auto-follow redirects', async () => {
  const seen = [];
  const a = createBandcampAdapter({ fetch: async (url, opts) => { seen.push(opts); return page(MUSIC); }, sleep: async () => {} });
  await a.fetchCatalogue(ORIGIN).catch(() => {});
  assert.ok(seen.length > 0 && seen.every(o => o.redirect === 'manual'));
});

test('a same-site redirect is followed', async () => {
  const { a, urls } = adapterFor({
    [ORIGIN + '/music']: redirect('/music2'),
    [ORIGIN + '/music2']: page('<a href="/album/one">x</a>'),
    [ORIGIN + '/album/one']: redirect('http://bloodmouth.bandcamp.com/album/one-v2', 302),
    [ORIGIN + '/album/one-v2']: page(album('One', ['T'])),
  });
  const cat = await a.fetchCatalogue(ORIGIN);
  assert.deepEqual(cat.releases.map(r => r.name), ['One']);
  assert.ok(urls.includes(ORIGIN + '/album/one-v2'));
});

test('a redirect to a custom domain is UNREADABLE and the off-host URL is never fetched', async () => {
  const { a, urls } = adapterFor({ [ORIGIN + '/music']: redirect('https://bloodmouth-band.example.org/music') });
  await assert.rejects(a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
  assert.ok(!urls.some(u => /example\.org/.test(u)));
  const missing = adapterFor({ [ORIGIN + '/music']: { ok: false, status: 302, text: async () => '' } });
  await assert.rejects(missing.a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
});

test('a redirect loop is UNREADABLE after 3 hops', async () => {
  const { a, urls } = adapterFor({ [ORIGIN + '/music']: redirect(ORIGIN + '/music') });
  await assert.rejects(a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE' && !/bandcamp/.test(e.message));
  assert.equal(urls.length, 4); // the request plus 3 followed hops
});

test('/music redirecting to /album/<slug> reads that release as the only one', async () => {
  const { a } = adapterFor({
    [ORIGIN + '/music']: redirect(ORIGIN + '/album/solo'),
    [ORIGIN + '/album/solo']: page(album('Solo', ['A', 'B'])),
  });
  const cat = await a.fetchCatalogue(ORIGIN);
  assert.equal(cat.releases.length, 1);
  assert.equal(cat.releases[0].name, 'Solo');
  assert.deepEqual(cat.releases[0].tracks.map(t => t.title), ['A', 'B']);
  assert.equal(cat.releases[0].release_date, '2019-06-13');
  assert.equal(cat.releases[0].album_type, 'album');
  assert.equal(cat.truncated, false);
});

test('/music redirecting to /track/<slug> yields one single; unparseable is UNREADABLE', async () => {
  const { a } = adapterFor({
    [ORIGIN + '/music']: redirect(ORIGIN + '/track/lone'),
    [ORIGIN + '/track/lone']: page(ld({ '@type': 'MusicRecording', name: 'Lone Song', '@id': ORIGIN + '/track/lone' })),
  });
  const cat = await a.fetchCatalogue(ORIGIN);
  assert.equal(cat.releases.length, 1);
  assert.equal(cat.releases[0].album_type, 'single');
  const bad = adapterFor({ [ORIGIN + '/music']: redirect(ORIGIN + '/album/solo'), [ORIGIN + '/album/solo']: page('<html>no json</html>') });
  await assert.rejects(bad.a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
});

test('a redirect to a different bandcamp subdomain is UNREADABLE and never fetched', async () => {
  const { a, urls } = adapterFor({ [ORIGIN + '/music']: redirect('https://otherband.bandcamp.com/album/solo') });
  await assert.rejects(a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
  assert.ok(!urls.some(u => /otherband/.test(u)));
});

test('hostile Location headers are UNREADABLE and never fetched; a relative path stays on-origin', async () => {
  for (const loc of ['//evil.com/x', 'https://u@evil.com/', 'https://u@x.bandcamp.com/', 'https://bandcamp.com/', 'javascript:alert(1)', '', null]) {
    const { a, urls } = adapterFor({ [ORIGIN + '/music']: redirect(loc) });
    await assert.rejects(a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE', String(loc));
    assert.deepEqual(urls, [ORIGIN + '/music'], String(loc));
  }
  const ok = adapterFor({ [ORIGIN + '/music']: redirect('/album/solo'), [ORIGIN + '/album/solo']: page(album('Solo', ['A'])) });
  assert.equal((await ok.a.fetchCatalogue(ORIGIN)).releases[0].name, 'Solo');
});

test('3xx response bodies are cancelled before following', async () => {
  let cancelled = 0;
  const r = { ...redirect(ORIGIN + '/album/solo'), body: { cancel: () => { cancelled++; } } };
  const { a } = adapterFor({ [ORIGIN + '/music']: r, [ORIGIN + '/album/solo']: page(album('Solo', ['A'])) });
  await a.fetchCatalogue(ORIGIN);
  assert.equal(cancelled, 1);
});
