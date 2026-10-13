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
  async function getText(url) {
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA } }); }
    catch { throw coded('UPSTREAM'); }
    if (!res.ok) throw fromStatus(res.status);
    try { return await res.text(); } catch { throw coded('UNREADABLE'); }
  }

  async function fetchCatalogue(originInput) {
    const origin = normalizeBandcampOrigin(originInput);
    if (!origin) throw coded('NOT_FOUND');
    const host = new URL(origin).hostname;
    const music = await getText(origin + '/music');
    const paths = [...new Set([...music.matchAll(/href="(\/(?:album|track)\/[^"#?]+)/g)].map(m => m[1]))].slice(0, MAX_RELEASES);
    if (paths.length === 0) throw coded('UNREADABLE');

    const releases = [];
    for (const path of paths) {
      await sleep(gapMs);
      let ldObj = null;
      try { ldObj = readLd(await getText(origin + path)); } catch (e) { if (e.code === 'UPSTREAM' || e.code === 'RATE_LIMITED') throw e; }
      if (!ldObj || !ldObj.name) continue; // this release page could not be read; keep going
      const trackUrl = (u, fallback) => { try { return new URL(u).hostname === host ? u : fallback; } catch { return fallback; } };
      const items = ldObj.track && ldObj.track.itemListElement;
      const tracks = Array.isArray(items)
        ? items.filter(i => i && i.item && i.item.name).map(i => ({ title: i.item.name, id: null, url: trackUrl(i.item['@id'], origin + path) }))
        : [{ title: ldObj.name, id: null, url: trackUrl(ldObj['@id'], origin + path) }];
      if (tracks.length === 0) continue;
      releases.push({
        id: path, name: ldObj.name, album_type: path.startsWith('/track/') ? 'single' : 'album',
        release_date: ldObj.datePublished ? isoDate(ldObj.datePublished) : null, url: origin + path, tracks,
      });
    }
    if (releases.length === 0) throw coded('UNREADABLE');
    return { source: 'bandcamp', releases };
  }

  return { source: 'bandcamp', fetchCatalogue };
}

module.exports = { normalizeBandcampOrigin, createBandcampAdapter };
