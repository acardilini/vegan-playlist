// MusicBrainz source for the Band check: keyless JSON API, 1 request/second, descriptive User-Agent (no personal data).
const { coded, fromStatus } = require('./errors');

const BASE = 'https://musicbrainz.org/ws/2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;
const MAX_PAGES = 10; // 1,000 recordings is far past any band here

function createMusicBrainzAdapter({
  fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), now = Date.now,
  userAgent = 'VeganPlaylist/0.1 (personal curation tool)', gapMs = 1100,
}) {
  let last = 0;

  // The adapter is shared by overlapping admin requests: serialise everything through one chain so the pacing holds.
  let chain = Promise.resolve();
  function get(path) {
    const run = chain.then(() => doGet(path));
    chain = run.catch(() => {}); // a rejected request must not block the queue
    return run;
  }

  async function doGet(path) {
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    let res;
    try { res = await fetch(BASE + path, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } }); }
    catch { throw coded('UPSTREAM'); }
    if (!res.ok) throw fromStatus(res.status);
    try { return await res.json(); } catch { throw coded('UNREADABLE'); }
  }

  async function identify(query) {
    const q = String(query || '').replace(/["\\]/g, ' ').trim();
    if (!q) return [];
    const j = await get(`/artist?query=${encodeURIComponent(`artist:"${q}"`)}&fmt=json&limit=6`);
    return (j.artists || []).map(a => ({
      value: a.id,
      label: a.name,
      detail: [a.country || '?', a.disambiguation].filter(Boolean).join(' · '),
      url: `https://musicbrainz.org/artist/${a.id}`,
    }));
  }

  async function fetchCatalogue(mbid) {
    if (!UUID.test(String(mbid))) throw coded('NOT_FOUND');
    const tracks = [];
    let total = 0;
    let truncated = true; // stays true only if the loop exhausts MAX_PAGES without breaking out
    for (let page = 0; page < MAX_PAGES; page++) {
      const j = await get(`/recording?artist=${mbid}&fmt=json&limit=${PAGE}&offset=${page * PAGE}`);
      const items = j.recordings || [];
      for (const r of items) tracks.push({ title: r.title, id: r.id, url: `https://musicbrainz.org/recording/${r.id}` });
      total = j['recording-count'] || 0;
      if (items.length < PAGE || tracks.length >= total) { truncated = false; break; }
    }
    return { source: 'musicbrainz', truncated, releases: [{ id: 'mb', name: 'MusicBrainz recordings', album_type: null, release_date: null, url: null, tracks }] };
  }

  // The band's Bandcamp page, if MusicBrainz knows it (a candidate for the Bandcamp identity).
  async function bandcampLink(mbid) {
    if (!UUID.test(String(mbid))) return null;
    const j = await get(`/artist/${mbid}?inc=url-rels&fmt=json`);
    const rel = (j.relations || []).find(r => r.type === 'bandcamp' && r.url && r.url.resource);
    return rel ? rel.url.resource : null;
  }

  return { source: 'musicbrainz', identify, fetchCatalogue, bandcampLink };
}

module.exports = { createMusicBrainzAdapter };
