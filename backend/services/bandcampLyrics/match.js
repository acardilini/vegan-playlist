// Pure (no DB, no network): matching a band's songs to its Bandcamp tracks, and the credited-artist check.
const { keyOf } = require('../bandCheck/merge');

// keyOf splits on apostrophes ("Don't" -> "don t"); Bandcamp and Spotify disagree on them, so drop them first.
const titleKey = (t) => keyOf(String(t || '').replace(/['’`]/g, ''));

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A page that names no artist gives no evidence against the match; otherwise either name must contain the other.
function creditMatches(credited, names) {
  const c = fold(credited);
  if (!c) return true;
  return (names || []).some((n) => { const f = fold(n); return !!f && (f.includes(c) || c.includes(f)); });
}

// songs: [{ id, title }], tracks: [{ title, url }]. A song matches only when exactly one track has its title key.
function matchSongs(songs, tracks) {
  const byKey = new Map();
  for (const t of tracks) {
    const k = titleKey(t.title);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const matched = [], ambiguous = [], unmatched = [];
  for (const s of songs) {
    const hits = byKey.get(titleKey(s.title)) || [];
    if (!titleKey(s.title) || hits.length === 0) unmatched.push(s.id);
    else if (hits.length > 1) ambiguous.push(s.id);
    else matched.push({ songId: s.id, url: hits[0].url });
  }
  return { matched, ambiguous, unmatched };
}

module.exports = { matchSongs, creditMatches };
