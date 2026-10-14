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

function createBandcampAdapter({ fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), gapMs = 250 }) {
  const REDIRECTS = new Set([301, 302, 303, 307, 308]);
  const MAX_HOPS = 3;

  // Redirects are followed by hand, and only to another https/http *.bandcamp.com URL, so a redirect can never
  // send this server to an arbitrary host. Resolves to { text, url } (the final URL).
  async function getPage(startUrl) {
    let url = startUrl;
    for (let hop = 0; ; hop++) {
      let res;
      try { res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' }); }
      catch { throw coded('UPSTREAM'); }
      if (REDIRECTS.has(res.status)) {
        const loc = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
        let resolved = null;
        try { resolved = loc ? new URL(loc, url) : null; } catch { resolved = null; }
        const nextOrigin = resolved && normalizeBandcampOrigin(resolved.href);
        if (hop >= MAX_HOPS || !nextOrigin) throw coded('UNREADABLE');
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

  async function fetchCatalogue(originInput) {
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

    const allPaths = [...new Set([...music.text.matchAll(/href="(\/(?:album|track)\/[^"#?]+)/g)].map(m => m[1]))];
    const truncated = allPaths.length > MAX_RELEASES;
    const paths = allPaths.slice(0, MAX_RELEASES);
    if (paths.length === 0) throw coded('UNREADABLE');

    const releases = [];
    for (const path of paths) {
      await sleep(gapMs);
      let ldObj = null;
      try { ldObj = readLd((await getPage(origin + path)).text); } catch (e) { if (e.code === 'UPSTREAM' || e.code === 'RATE_LIMITED') throw e; }
      const release = parseRelease(ldObj, path, origin);
      if (release) releases.push(release);
    }
    if (releases.length === 0) throw coded('UNREADABLE');
    return { source: 'bandcamp', releases, truncated };
  }

  return { source: 'bandcamp', fetchCatalogue };
}

module.exports = { normalizeBandcampOrigin, createBandcampAdapter };
