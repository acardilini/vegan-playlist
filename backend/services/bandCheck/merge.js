// Pure (no DB, no network): the cross-source merge and the catalogue classification behind the Band check.
const { normalizeName } = require('../staging'); // same key the Spotify-push duplicate check uses

const TYPE_RANK = { album: 0, compilation: 1, single: 2 };
const SOURCE_RANK = { spotify: 0, bandcamp: 0, musicbrainz: 1 }; // MusicBrainz is one pseudo-release: never the representative if another source has the song
const STATUS_RANK = { included: 0, pending: 1, rejected: 2 };

// normalizeName() drops every non-ASCII letter, so a title with any other script gets a Unicode-aware key
// (same parenthetical / " - ..." stripping); pure-ASCII-after-folding titles keep the Spotify-push duplicate key.
function keyOf(title) {
  const t = String(title || '').trim();
  if (!t) return '';
  const folded = t.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  if (/[^\x00-\x7F]/.test(folded)) {
    const k = folded.replace(/\(.*?\)|\[.*?\]/g, '').replace(/ - .*/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return k || folded.trim();
  }
  return normalizeName(t) || t.toLowerCase();
}

// host + path, no query/hash/trailing slash, lowercase host — for comparing Bandcamp URLs.
function normUrl(u) {
  try {
    const x = new URL(u);
    return x.hostname.toLowerCase() + x.pathname.replace(/\/+$/, '');
  } catch { return null; }
}

function creditsArtist(track, spotifyArtistId) {
  return !!spotifyArtistId && (track.artists || []).some(a => a.id === spotifyArtistId);
}

// Negative when `a` is the better representative of a song.
function preferRelease(a, b) {
  const s = (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
  if (s) return s;
  const t = (TYPE_RANK[a.album_type] ?? 3) - (TYPE_RANK[b.album_type] ?? 3);
  if (t) return t;
  const da = a.release_date || '9999', db = b.release_date || '9999';
  if (da !== db) return da < db ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

function mergeCatalogues(catalogues) {
  const byKey = new Map();
  for (const cat of catalogues) {
    for (const rel of cat.releases) {
      const info = { source: cat.source, id: rel.id, name: rel.name, album_type: rel.album_type || null, release_date: rel.release_date || null };
      for (const t of rel.tracks) {
        const key = keyOf(t.title);
        if (!key) continue;
        let s = byKey.get(key);
        if (!s) { s = { key, title: String(t.title).trim(), sources: {}, _rels: [] }; byKey.set(key, s); }
        s._rels.push({ ...info, title: String(t.title).trim() });
        if (cat.source === 'spotify') {
          const cur = s.sources.spotify;
          if (!cur) s.sources.spotify = { ids: t.id ? [t.id] : [], url: t.url || null, mapped: t.mapped || null, _rel: info };
          else {
            if (t.id && !cur.ids.includes(t.id)) cur.ids.push(t.id);
            if (preferRelease(info, cur._rel) < 0) Object.assign(cur, { url: t.url || null, mapped: t.mapped || null, _rel: info });
          }
        } else if (cat.source === 'bandcamp') {
          const cur = s.sources.bandcamp;
          if (!cur) s.sources.bandcamp = { url: t.url || null, _rel: info };
          else if (preferRelease(info, cur._rel) < 0) Object.assign(cur, { url: t.url || null, _rel: info });
        } else {
          s.sources.musicbrainz = { count: (s.sources.musicbrainz ? s.sources.musicbrainz.count : 0) + 1 };
        }
      }
    }
  }
  return [...byKey.values()].map(s => {
    s._rels.sort(preferRelease);
    const best = s._rels[0];
    const also = [...new Set(s._rels.filter(r => r.source !== 'musicbrainz' && r.name !== best.name).map(r => r.name))];
    for (const k of ['spotify', 'bandcamp']) if (s.sources[k]) delete s.sources[k]._rel;
    const { _rels, ...song } = s;
    return { ...song, title: best.title, release: { source: best.source, id: best.id, name: best.name, album_type: best.album_type, release_date: best.release_date }, also_on: also };
  });
}

// rows: songs relevant to ONE band — { id, title, status, published, spotify_id, bandcamp_url, by_artist }.
// Spotify-id and Bandcamp-url matches may be any catalogue song; title matches only songs credited to this band.
function buildIndex(rows) {
  const idx = { bySpotify: new Map(), byBandcamp: new Map(), byTitle: new Map() };
  const put = (map, k, row) => {
    if (!k) return;
    const cur = map.get(k);
    if (!cur || (STATUS_RANK[row.status] ?? 3) < (STATUS_RANK[cur.status] ?? 3)) map.set(k, row);
  };
  for (const r of rows) {
    put(idx.bySpotify, r.spotify_id, r);
    put(idx.byBandcamp, normUrl(r.bandcamp_url), r);
    if (r.by_artist) put(idx.byTitle, keyOf(r.title), r);
  }
  return idx;
}

function classify(songs, index) {
  return songs.map(s => {
    let hit = null, by = null;
    for (const id of (s.sources.spotify && s.sources.spotify.ids) || []) {
      if (index.bySpotify.has(id)) { hit = index.bySpotify.get(id); by = 'spotify_id'; break; }
    }
    if (!hit && s.sources.bandcamp && s.sources.bandcamp.url) {
      const h = index.byBandcamp.get(normUrl(s.sources.bandcamp.url));
      if (h) { hit = h; by = 'bandcamp_url'; }
    }
    if (!hit && index.byTitle.has(s.key)) { hit = index.byTitle.get(s.key); by = 'title'; }
    return hit
      ? { ...s, state: 'in_catalogue', match: { song_id: hit.id, status: hit.status, published: hit.published, matched_by: by } }
      : { ...s, state: 'new', match: null };
  });
}

module.exports = { keyOf, normUrl, creditsArtist, preferRelease, mergeCatalogues, buildIndex, classify };
