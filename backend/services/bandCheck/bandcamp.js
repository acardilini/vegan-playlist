// Bandcamp source for the Band check. Bandcamp has no API: this reads the public /music page and each release
// page's embedded JSON-LD tracklist. Markup changes fail as UNREADABLE for this source only.
const { coded, fromStatus } = require('./errors');

const HOST = /^[a-z0-9-]+\.bandcamp\.com$/i;
const MAX_RELEASES = 40;
const UA = 'VeganPlaylist/0.1 (personal curation tool)';

// Any https/http *.bandcamp.com URL -> its bare https origin; everything else (custom domains, lookalikes, non-http) -> null.
function normalizeBandcampOrigin(input) {
  if (typeof input !== 'string') return null;
  let u;
  try { u = new URL(input.trim()); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !HOST.test(u.hostname) || u.username || u.password) return null;
  return 'https://' + u.hostname.toLowerCase();
}

function isoDate(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function readLd(html) {
  const m = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// A credit/band name folded for comparison: case, diacritics, punctuation and a leading "The" ignored.
function nameKey(name) {
  const k = String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the(\s+|$)/, '').trim();
  return k;
}

// "A & B", "A / B", "A, B", "A + B", "A x B", "A and B", "A feat. B", "A with B" -> each credited name (a name is never cut mid-word).
function creditParts(credit) {
  return String(credit || '').split(/\s*(?:[&/,+]|\bx\b|\band\b|\bwith\b|\bw\/|\bfeat\.?|\bfeaturing\b|\bft\.?)\s*/i).map(nameKey).filter(Boolean);
}

function creditedTo(credit, key) {
  return nameKey(credit) === key || creditParts(credit).includes(key);
}

const decode = (t) => t.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const RELEASE_PATH = /^\/(?:album|track)\/[^"#?\s]+$/;

// Every release a /music page lists, as [{ path, artist }] (artist '' when the page does not say). The page splits its
// catalogue in two: the first screen is <li data-item-id> grid items (artist in .artist-override, only on pages that
// show other artists), the rest is the embedded data-client-items JSON; plain release links come last as a fallback.
function readItems(html) {
  const out = [], seen = new Set();
  const add = (path, artist) => { if (!seen.has(path)) { seen.add(path); out.push({ path, artist: artist.trim() }); } };
  for (const m of html.matchAll(/<li\b[^>]*\bdata-item-id="[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
    const href = /href="(\/(?:album|track)\/[^"#?\s]+)"/.exec(m[1]);
    const credit = /class="artist-override">\s*([^<]*?)\s*</.exec(m[1]);
    if (href) add(href[1], credit ? decode(credit[1]) : '');
  }
  const client = /data-client-items="([^"]*)"/.exec(html);
  if (client) {
    let list = null;
    try { list = JSON.parse(decode(client[1])); } catch { /* the plain links below still work */ }
    for (const i of Array.isArray(list) ? list : []) if (i && typeof i.page_url === 'string' && RELEASE_PATH.test(i.page_url)) add(i.page_url, typeof i.artist === 'string' ? i.artist : '');
  }
  for (const m of html.matchAll(/href="(\/(?:album|track)\/[^"#?]+)/g)) add(m[1], '');
  return out;
}

function createBandcampAdapter({ fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), gapMs = 250 }) {
  const REDIRECTS = new Set([301, 302, 303, 307, 308]);
  const MAX_HOPS = 3;

  // Redirects are followed by hand, and only to another https/http *.bandcamp.com URL, so a redirect can never
  // send this server to an arbitrary host. Resolves to { text, url } (the final URL).
  async function getPage(startUrl) {
    let url = startUrl;
    const startOrigin = normalizeBandcampOrigin(startUrl); // a redirect may never leave the band's own subdomain
    for (let hop = 0; ; hop++) {
      let res;
      try { res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' }); }
      catch { throw coded('UPSTREAM'); }
      if (REDIRECTS.has(res.status)) {
        try { res.body && res.body.cancel && res.body.cancel(); } catch { /* drain best-effort */ }
        const loc = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
        let resolved = null;
        try { resolved = loc ? new URL(loc, url) : null; } catch { resolved = null; }
        const nextOrigin = resolved && normalizeBandcampOrigin(resolved.href);
        if (hop >= MAX_HOPS || !nextOrigin || nextOrigin !== startOrigin) throw coded('UNREADABLE');
        url = nextOrigin + resolved.pathname + resolved.search; // http is upgraded to https by the normaliser
        continue;
      }
      if (!res.ok) throw fromStatus(res.status);
      try { return { text: await res.text(), url }; } catch { throw coded('UNREADABLE'); }
    }
  }

  // One release page's JSON-LD -> a release object (or null when it cannot be read / has no tracks).
  function parseRelease(ldObj, path, origin) {
    if (!ldObj || !ldObj.name) return null;
    const host = new URL(origin).hostname;
    const trackUrl = (u, fallback) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === host ? u : fallback; } catch { return fallback; } };
    const items = ldObj.track && ldObj.track.itemListElement;
    const tracks = Array.isArray(items)
      ? items.filter(i => i && i.item && i.item.name).map(i => ({ title: i.item.name, id: null, url: trackUrl(i.item['@id'], origin + path) }))
      : [{ title: ldObj.name, id: null, url: trackUrl(ldObj['@id'], origin + path) }];
    if (tracks.length === 0) return null;
    return {
      id: path, name: ldObj.name, album_type: path.startsWith('/track/') ? 'single' : 'album',
      release_date: ldObj.datePublished ? isoDate(ldObj.datePublished) : null, url: origin + path, tracks,
    };
  }

  async function fetchCatalogue(originInput, { artistName } = {}) {
    const origin = normalizeBandcampOrigin(originInput);
    if (!origin) throw coded('NOT_FOUND');
    const music = await getPage(origin + '/music');

    // A single-release band: /music lands straight on the release page.
    let final = null;
    try { final = new URL(music.url); } catch { /* keep null */ }
    if (final && /^\/(album|track)\//.test(final.pathname)) {
      const finalOrigin = normalizeBandcampOrigin(final.href);
      const release = finalOrigin && parseRelease(readLd(music.text), final.pathname, finalOrigin);
      if (!release) throw coded('UNREADABLE');
      return { source: 'bandcamp', releases: [release], truncated: false };
    }

    // A record label's page lists other bands' releases too: keep only those credited to this band, decided from the
    // page's own list so the other bands' release pages are never fetched (and never use up the cap). A release the page
    // gives no credit for is kept, never hidden.
    const items = readItems(music.text);
    const key = nameKey(artistName);
    const distinct = new Set(items.map(i => nameKey(i.artist)).filter(Boolean));
    const credited = (i) => !i.artist || creditedTo(i.artist, key);
    const isLabel = !!key && distinct.size > 1;
    const mine = isLabel ? items.filter(credited) : items;
    let label;
    if (isLabel) {
      const counts = new Map();
      for (const i of items) if (!credited(i)) counts.set(i.artist, (counts.get(i.artist) || 0) + 1);
      const credits = [...counts].map(([artist, count]) => ({ artist, count })).sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
      // noMatch: a label page with nothing credited to this band reads nothing (its other bands' songs must not land in New)
      label = { artist: artistName, hidden: items.length - mine.length, credits, noMatch: !items.some(i => i.artist && creditedTo(i.artist, key)) };
    }
    if (label && label.noMatch) return { source: 'bandcamp', releases: [], truncated: false, label };
    const allPaths = mine.map(i => i.path);
    const truncated = allPaths.length > MAX_RELEASES;
    const paths = allPaths.slice(0, MAX_RELEASES);
    if (paths.length === 0) throw coded('UNREADABLE');

    const releases = [];
    for (const path of paths) {
      await sleep(gapMs);
      let ldObj = null;
      try { ldObj = readLd((await getPage(origin + path)).text); } catch (e) { if (e.code === 'UPSTREAM' || e.code === 'RATE_LIMITED') throw e; }
      // the list gave no credit for this release: its own page does, so a label's other bands are still dropped
      const credit = label && !mine.find(i => i.path === path).artist && ldObj && ((ldObj.byArtist && ldObj.byArtist.name) || (ldObj.inAlbum && ldObj.inAlbum.byArtist && ldObj.inAlbum.byArtist.name));
      if (credit && !creditedTo(credit, key)) {
        label.hidden++;
        const row = label.credits.find(c => c.artist === credit);
        if (row) row.count++; else label.credits.push({ artist: credit, count: 1 });
        continue;
      }
      const release = parseRelease(ldObj, path, origin);
      if (release) releases.push(release);
    }
    if (label) label.credits.sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
    if (releases.length === 0 && !(label && label.hidden > 0)) throw coded('UNREADABLE');
    return label ? { source: 'bandcamp', releases, truncated, label } : { source: 'bandcamp', releases, truncated };
  }

  // One song page -> its title, credited artist and the artist's own lyrics (null when absent or blank).
  async function fetchTrack(url) {
    if (!normalizeBandcampOrigin(url)) throw coded('NOT_FOUND');
    const ldObj = readLd((await getPage(url)).text);
    if (!ldObj) throw coded('UNREADABLE');
    const text = ldObj.recordingOf && ldObj.recordingOf.lyrics && ldObj.recordingOf.lyrics.text;
    const lyrics = typeof text === 'string' && text.trim() ? text.trim() : null;
    const credit = (ldObj.byArtist && ldObj.byArtist.name) || (ldObj.inAlbum && ldObj.inAlbum.byArtist && ldObj.inAlbum.byArtist.name) || null;
    return { title: ldObj.name || null, artist: credit, lyrics };
  }

  return { source: 'bandcamp', fetchCatalogue, fetchTrack };
}

module.exports = { normalizeBandcampOrigin, createBandcampAdapter };
