const { test } = require('node:test');
const assert = require('node:assert');
const { createMusicBrainzAdapter } = require('../services/bandCheck/musicbrainz');

const MBID = 'bd59cf43-e0b1-4e09-a912-4a35a78bb446';
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

function harness(handler) {
  const urls = [], sleeps = [];
  let t = 1_000_000;
  const adapter = createMusicBrainzAdapter({
    fetch: async (url, opts) => { urls.push({ url, opts }); return handler(url); },
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    now: () => t,
  });
  return { adapter, urls, sleeps };
}

test('identify lists same-named bands with country and disambiguation', async () => {
  const { adapter, urls } = harness(() => ok({ artists: [
    { id: MBID, name: 'Bloodmouth', country: 'US', score: 100 },
    { id: '6d9f3695-6647-4def-9780-7ec235fba0b8', name: 'Bloodmouth', country: 'AU', disambiguation: 'Vegan', score: 98 },
  ] }));
  const c = await adapter.identify('Bloodmouth');
  assert.deepEqual(c.map(x => x.detail), ['US', 'AU · Vegan']);
  assert.equal(c[0].url, `https://musicbrainz.org/artist/${MBID}`);
  assert.match(urls[0].url, /query=artist%3A%22Bloodmouth%22/);
  assert.match(urls[0].opts.headers['User-Agent'], /^VeganPlaylist\/0\.1 \(personal curation tool\)$/);
});

test('fetchCatalogue pages recordings into one pseudo-release and paces requests >= 1.1s apart', async () => {
  const page = (n, start) => ({ 'recording-count': 150, recordings: Array.from({ length: n }, (_, i) => ({ id: 'r' + (start + i), title: 'Rec ' + (start + i) })) });
  const { adapter, urls, sleeps } = harness((url) => ok(/offset=100/.test(url) ? page(50, 100) : page(100, 0)));
  const cat = await adapter.fetchCatalogue(MBID);
  assert.equal(cat.source, 'musicbrainz');
  assert.equal(cat.releases.length, 1);
  assert.equal(cat.releases[0].tracks.length, 150);
  assert.equal(urls.length, 2);
  assert.ok(sleeps.length >= 1 && sleeps.every(ms => ms >= 1000));
});

test('fetchCatalogue rejects a non-UUID id without calling the network', async () => {
  const { adapter, urls } = harness(() => ok({}));
  await assert.rejects(adapter.fetchCatalogue('../../x'), (e) => e.code === 'NOT_FOUND');
  assert.equal(urls.length, 0);
});

test('bandcampLink reads the bandcamp url-rel, or null', async () => {
  const withLink = harness(() => ok({ relations: [{ type: 'official homepage', url: { resource: 'https://x.org' } }, { type: 'bandcamp', url: { resource: 'https://bloodmouth.bandcamp.com/' } }] }));
  assert.equal(await withLink.adapter.bandcampLink(MBID), 'https://bloodmouth.bandcamp.com/');
  const none = harness(() => ok({ relations: [] }));
  assert.equal(await none.adapter.bandcampLink(MBID), null);
});

test('503 -> RATE_LIMITED, a thrown fetch -> UPSTREAM with no message leaked', async () => {
  const limited = harness(() => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(limited.adapter.identify('x'), (e) => e.code === 'RATE_LIMITED');
  const a = createMusicBrainzAdapter({ fetch: async () => { throw new Error('connect ECONNRESET https://secret'); }, sleep: async () => {}, now: () => 1 });
  await assert.rejects(a.identify('x'), (e) => e.code === 'UPSTREAM' && !/secret/.test(e.message));
});

test('truncated is true when the page cap is hit with recordings remaining, false otherwise', async () => {
  const full = (url) => { const off = Number(/offset=(\d+)/.exec(url)[1]); return ok({ 'recording-count': 5000, recordings: Array.from({ length: 100 }, (_, i) => ({ id: 'r' + (off + i), title: 'Rec ' + (off + i) })) }); };
  const big = harness(full);
  const cat = await big.adapter.fetchCatalogue(MBID);
  assert.equal(cat.truncated, true);
  assert.equal(cat.releases[0].tracks.length, 1000);
  const small = harness(() => ok({ 'recording-count': 2, recordings: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }));
  assert.equal((await small.adapter.fetchCatalogue(MBID)).truncated, false);
});

test('overlapping requests queue: fetch times stay >= 1100ms apart', async () => {
  let t = 1_000_000;
  const times = [];
  const adapter = createMusicBrainzAdapter({
    fetch: async () => { times.push(t); return ok({ artists: [] }); },
    sleep: async (ms) => { t += ms; },
    now: () => t,
  });
  await adapter.identify('prime'); // so both overlapping calls below see a wait to serve
  times.length = 0;
  await Promise.all([adapter.identify('a'), adapter.identify('b')]);
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 1100, `gap ${times[1] - times[0]}`);
});

test('a failing request does not block the queue', async () => {
  let n = 0, t = 1_000_000;
  const adapter = createMusicBrainzAdapter({
    fetch: async () => { n++; if (n === 1) throw new Error('boom'); return ok({ artists: [] }); },
    sleep: async (ms) => { t += ms; },
    now: () => t,
  });
  const [r1, r2] = await Promise.allSettled([adapter.identify('a'), adapter.identify('b')]);
  assert.equal(r1.status, 'rejected');
  assert.equal(r1.reason.code, 'UPSTREAM');
  assert.equal(r2.status, 'fulfilled');
});

test('truncated is false when exiting by a short page or by reaching recording-count', async () => {
  const recs = (n, off = 0) => Array.from({ length: n }, (_, i) => ({ id: 'r' + (off + i), title: 'T' + (off + i) }));
  // short page although the reported count is inconsistent (larger)
  const short = harness(() => ok({ 'recording-count': 500, recordings: recs(40) }));
  assert.equal((await short.adapter.fetchCatalogue(MBID)).truncated, false);
  // exactly MAX_PAGES * 100 recordings, count equal to that
  const exact = harness((url) => ok({ 'recording-count': 1000, recordings: recs(100, Number(/offset=(\d+)/.exec(url)[1])) }));
  const cat = await exact.adapter.fetchCatalogue(MBID);
  assert.equal(cat.releases[0].tracks.length, 1000);
  assert.equal(cat.truncated, false);
});

test('a missing recording-count pages until a short page, not ending after page 1', async () => {
  const recs = (n, off) => Array.from({ length: n }, (_, i) => ({ id: 'r' + (off + i), title: 'T' + (off + i) }));
  const h = harness((url) => { const off = Number(/offset=(\d+)/.exec(url)[1]); return ok({ recordings: recs(off >= 200 ? 30 : 100, off) }); });
  const cat = await h.adapter.fetchCatalogue(MBID);
  assert.equal(cat.releases[0].tracks.length, 230);
  assert.equal(cat.truncated, false);
});
