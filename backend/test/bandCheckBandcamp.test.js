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

const trackLd = (extra = {}) => ld({ '@type': 'MusicRecording', name: 'Prism Warden', '@id': ORIGIN + '/track/prism', byArtist: { name: 'Bloodmouth' }, ...extra });

test('fetchTrack returns title, credited artist and lyrics from the track page JSON-LD', async () => {
  const { a } = adapterFor({ [ORIGIN + '/track/prism']: page(trackLd({ recordingOf: { lyrics: { text: '  line one\nline two  ' } } })) });
  assert.deepEqual(await a.fetchTrack(ORIGIN + '/track/prism'), { title: 'Prism Warden', artist: 'Bloodmouth', lyrics: 'line one\nline two' });
});

test('fetchTrack gives lyrics null when the page has none or only whitespace', async () => {
  const none = adapterFor({ [ORIGIN + '/track/prism']: page(trackLd()) });
  assert.equal((await none.a.fetchTrack(ORIGIN + '/track/prism')).lyrics, null);
  const blank = adapterFor({ [ORIGIN + '/track/prism']: page(trackLd({ recordingOf: { lyrics: { text: '  \n ' } } })) });
  assert.equal((await blank.a.fetchTrack(ORIGIN + '/track/prism')).lyrics, null);
});

test('fetchTrack falls back to the album credit and refuses a non-bandcamp URL without a request', async () => {
  const album2 = adapterFor({ [ORIGIN + '/track/prism']: page(ld({ '@type': 'MusicRecording', name: 'P', inAlbum: { byArtist: { name: 'Album Band' } } })) });
  assert.equal((await album2.a.fetchTrack(ORIGIN + '/track/prism')).artist, 'Album Band');
  const bad = adapterFor({});
  await assert.rejects(bad.a.fetchTrack('https://evil.com/track/x'), (e) => e.code === 'NOT_FOUND');
  assert.equal(bad.urls.length, 0);
});

test('fetchTrack fails UNREADABLE when the page has no JSON-LD', async () => {
  const { a } = adapterFor({ [ORIGIN + '/track/prism']: page('<html>nothing</html>') });
  await assert.rejects(a.fetchTrack(ORIGIN + '/track/prism'), (e) => e.code === 'UNREADABLE');
});

// ---- record-label pages: keep only releases credited to the band being reviewed ----
const items = (list) => list.map(([artist, slug, type = 'album']) => ({ artist, page_url: `/${type}/${slug}`, title: slug, type }));
const musicWith = (list) => `<ol id="music-grid" data-client-items="${JSON.stringify(items(list)).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></ol>`;
const labelFor = (list, extra = {}) => {
  const map = { [ORIGIN + '/music']: page(musicWith(list)), ...extra };
  for (const [, slug, type = 'album'] of list) if (!map[`${ORIGIN}/${type}/${slug}`]) map[`${ORIGIN}/${type}/${slug}`] = page(album(slug, ['T ' + slug]));
  return adapterFor(map);
};
const LABEL = [['Other Band', 'o1'], ['Wolves Of Dusk', 'w1'], ['Third Act', 't1'], ['Wolves Of Dusk', 'w2', 'track'], ['Other Band', 'o2']];

test('a label page keeps only releases credited to the band and never fetches the rest', async () => {
  const { a, urls } = labelFor(LABEL);
  const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Wolves of Dusk' });
  assert.deepEqual(cat.releases.map(r => r.name), ['w1', 'w2']);
  assert.ok(!urls.some(u => /\/(o1|o2|t1)$/.test(u)));
  assert.deepEqual(cat.label, { artist: 'Wolves of Dusk', hidden: 3, credits: [{ artist: 'Other Band', count: 2 }, { artist: 'Third Act', count: 1 }], noMatch: false });
  assert.equal(cat.truncated, false);
});

test('the filter works on the whole client list, so the 40-release cap applies to the band\'s own releases', async () => {
  const list = [...Array.from({ length: 60 }, (_, i) => ['Filler ' + (i % 7), 'f' + i]), ['Wolves Of Dusk', 'w1'], ['Wolves Of Dusk', 'w2']];
  const { a, urls } = labelFor(list);
  const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Wolves Of Dusk' });
  assert.equal(cat.releases.length, 2);
  assert.equal(cat.truncated, false);
  assert.equal(urls.length, 3); // /music + the two matches
  assert.equal(cat.label.hidden, 60);
});

test('names match ignoring case, accents, punctuation and a leading "The", and inside a collaboration credit', async () => {
  for (const credit of ['wolves of dusk', 'The Wolves of Dusk', 'Wölves Of Dusk!', 'Wolves Of Dusk & Friend', 'Friend / Wolves Of Dusk', 'Friend x Wolves Of Dusk', 'Friend feat. Wolves Of Dusk', 'A, Wolves Of Dusk']) {
    const { a } = labelFor([['Other Band', 'o1'], [credit, 'w1']]);
    const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Wolves Of Dusk' });
    assert.deepEqual(cat.releases.map(r => r.name), ['w1'], credit);
  }
  const { a } = labelFor([['Other Band', 'o1'], ['Wolves Of Dusk Tribute Band', 'w1'], ['Wolves', 'w2']]);
  await assert.doesNotReject(a.fetchCatalogue(ORIGIN, { artistName: 'Wolves Of Dusk' })); // a longer or partial name is not the band
  const r = await a.fetchCatalogue(ORIGIN, { artistName: 'Wolves Of Dusk' });
  assert.equal(r.label.noMatch, true);
});

test('when nothing on a label page is credited to the band, nothing is read and the note says so', async () => {
  const { a, urls } = labelFor(LABEL);
  const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Nobody At All' });
  assert.deepEqual(cat.releases, []);
  assert.deepEqual(urls, [ORIGIN + '/music']);
  assert.equal(cat.label.noMatch, true);
  assert.equal(cat.label.hidden, 5);
  assert.deepEqual(cat.label.credits, [{ artist: 'Other Band', count: 2 }, { artist: 'Wolves Of Dusk', count: 2 }, { artist: 'Third Act', count: 1 }]);
});

test('a page whose releases all carry one credit is not a label page: nothing is hidden, no note', async () => {
  const { a } = labelFor([['Bloodmouth', 'a1'], ['Bloodmouth', 'a2']]);
  const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Blood Mouth (the band)' });
  assert.equal(cat.releases.length, 2);
  assert.equal(cat.label, undefined);
});

test('no artist name, or no client list, leaves the old behaviour', async () => {
  const none = labelFor(LABEL);
  assert.equal((await none.a.fetchCatalogue(ORIGIN)).releases.length, 5);
  const { a } = adapterFor({ [ORIGIN + '/music']: page(MUSIC), [ORIGIN + '/album/one']: page(album('One', ['A'])), [ORIGIN + '/track/lone']: page(album('Lone', ['B'])), [ORIGIN + '/album/two']: page(album('Two', ['C'])) });
  const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Whoever' });
  assert.equal(cat.releases.length, 3);
  assert.equal(cat.label, undefined);
});

// Real label pages split the catalogue: the first screen is <li data-item-id> grid items (artist in .artist-override),
// the rest is in data-client-items. Both are read.
test('a label page\'s grid items and its client list are both read (grid artist from artist-override, entities decoded)', async () => {
  const grid = (slug, artist) => `<li data-item-id="album-1" class="music-grid-item"> <a href="/album/${slug}"> <p class="title"> T <br><span class="artist-override"> ${artist} </span> </p> </a> </li>`;
  const music = `<ol>${grid('g1', 'Wolves Of Dusk')}${grid('g2', 'Someone&#39;s Band')}</ol>` + musicWith([['Other Band', 'c1'], ['Wolves Of Dusk', 'c2']]);
  const { a, urls } = adapterFor({
    [ORIGIN + '/music']: page(music),
    [ORIGIN + '/album/g1']: page(album('g1', ['A'])), [ORIGIN + '/album/c2']: page(album('c2', ['B'])),
  });
  const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Wolves of Dusk' });
  assert.deepEqual(cat.releases.map(r => r.name).sort(), ['c2', 'g1']);
  assert.equal(urls.length, 3);
  assert.deepEqual(cat.label.credits, [{ artist: 'Other Band', count: 1 }, { artist: "Someone's Band", count: 1 }]);
});

test('a grid item with no artist-override is kept, never hidden', async () => {
  const music = '<li data-item-id="album-1"><a href="/album/solo"><p class="title">T</p></a></li>' + musicWith([['Other Band', 'c1'], ['Wolves Of Dusk', 'c2']]);
  const { a } = adapterFor({ [ORIGIN + '/music']: page(music), [ORIGIN + '/album/solo']: page(album('solo', ['A'])), [ORIGIN + '/album/c2']: page(album('c2', ['B'])) });
  const cat = await a.fetchCatalogue(ORIGIN, { artistName: 'Wolves Of Dusk' });
  assert.deepEqual(cat.releases.map(r => r.name).sort(), ['c2', 'solo']);
  assert.equal(cat.label.hidden, 1);
});
