// Pure lyric-search link builders (sub-project E). No network, no DOM. The site list is the one
// place to edit when the curator names another site. `search` is that site's own search URL
// (given the already-encoded query) or null when we don't know a reliable one - those fall back
// to a Google query restricted to the site.
export const LYRIC_SITES = [
  { key: 'genius', name: 'Genius', host: 'genius.com', avenue: 'genius', search: (q) => `https://genius.com/search?q=${q}` },
  { key: 'bandcamp', name: 'Bandcamp', host: 'bandcamp.com', avenue: 'bandcamp', search: (q) => `https://bandcamp.com/search?q=${q}` },
  { key: 'musixmatch', name: 'Musixmatch', host: 'musixmatch.com', avenue: 'genre_site', search: (q) => `https://www.musixmatch.com/search/${q}` },
  { key: 'lyricscom', name: 'Lyrics.com', host: 'lyrics.com', avenue: 'genre_site', search: (q) => `https://www.lyrics.com/serp.php?st=${q}` },
  { key: 'azlyrics', name: 'AZLyrics', host: 'azlyrics.com', avenue: 'genre_site', search: null },
  { key: 'letras', name: 'Letras', host: 'letras.com', avenue: 'genre_site', search: null },
  { key: 'lyricstranslate', name: 'Lyrics Translate', host: 'lyricstranslate.com', avenue: 'genre_site', search: null },
  { key: 'darklyrics', name: 'DarkLyrics', host: 'darklyrics.com', avenue: 'genre_site', search: null },
  { key: 'lyricsfreak', name: 'LyricsFreak', host: 'lyricsfreak.com', avenue: 'genre_site', search: null },
];

const clean = (s) => String(s ?? '').replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

// The title is quoted (it is the distinctive part); the artist is NOT, because a quoted artist
// that doesn't appear verbatim on the page (punctuation, "feat.", spelling) returns zero results
// for obscure songs.
export function buildQuery({ title, artist } = {}) {
  const t = clean(title), a = clean(artist);
  return [t && `"${t}"`, a, 'lyrics'].filter(Boolean).join(' ');
}

// Unrestricted web search: the primary action, because obscure songs are often only on sites we
// haven't listed (band pages, small forums, booklets scans).
export function anywhereUrl(song) {
  return google(buildQuery(song));
}

// Narrower: only the listed lyric sites. Can legitimately return nothing for an obscure song.
export function allSitesUrl(song) {
  const sites = LYRIC_SITES.map((s) => `site:${s.host}`).join(' OR ');
  return google(`${buildQuery(song)} (${sites})`);
}

export function youtubeSearchUrl(song) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${clean(song?.title)} ${clean(song?.artist)}`.trim())}`;
}

export function siteUrl(site, song) {
  if (site.search) return site.search(encodeURIComponent(`${clean(song?.title)} ${clean(song?.artist)}`.trim()));
  return google(`${buildQuery(song)} site:${site.host}`);
}

export function sourceNameFromUrl(url) {
  let host;
  try {
    const u = new URL(String(url ?? '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    host = u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
  const hit = LYRIC_SITES.find((s) => host === s.host || host.endsWith(`.${s.host}`));
  return hit ? hit.name : host;
}
