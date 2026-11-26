// Links to a song on other listening platforms. The adapters here take an injected `fetch` so tests never touch the
// network. Only public data leaves this server (an ISRC, or a public title + artist), and NOTHING here may log or
// rethrow a URL or a fetch error's message: failures are a null (a miss) or a fixed-string Error with `.code`.

// Case, diacritics and punctuation folded; parentheticals and a trailing " - ..." (a version suffix) dropped.
function normTitle(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/ - .*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
const normName = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const ISRC_RE = /^[A-Za-z0-9]{12}$/;

// Deezer finds a track by ISRC, which is exact. A body with `error` (or no link) is a miss.
async function deezerByIsrc(isrc, { fetch: f = fetch } = {}) {
  if (typeof isrc !== 'string' || !ISRC_RE.test(isrc)) return null;
  try {
    const r = await f(`https://api.deezer.com/track/isrc:${isrc}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j && !j.error && typeof j.link === 'string' && /^https?:\/\//i.test(j.link) ? { url: j.link } : null;
  } catch { return null; }
}

// Apple's free search cannot take an ISRC and its results carry none, so a hit is only "same base title, same first
// artist". A different version of the song can pass, which is why the curator confirms every Apple match.
async function appleSearch({ title, artist } = {}, { fetch: f = fetch } = {}) {
  const wantTitle = normTitle(title);
  const wantArtist = normName(artist).slice(0, 8);
  if (!wantTitle || !wantArtist) return null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const r = await f(`https://itunes.apple.com/search?media=music&entity=song&limit=5&country=US&term=${term}`);
    if (!r.ok) return null;
    const j = await r.json();
    const hit = ((j && j.results) || []).find((x) => x && typeof x.trackViewUrl === 'string' && normTitle(x.trackName) === wantTitle
      && normName(x.artistName).includes(wantArtist));
    if (!hit) return null;
    const u = new URL(hit.trackViewUrl); u.searchParams.delete('uo');
    return { url: u.toString(), title: hit.trackName, artist: hit.artistName };
  } catch { return null; }
}

const upstream = () => { const e = new Error('Spotify did not answer'); e.code = 'UPSTREAM'; return e; };

// The ISRC of a Spotify track (client credentials). 429, 5xx and network failure throw UPSTREAM so a run can skip the
// song; anything else that is not a usable answer is null.
async function spotifyIsrc(spotifyId, { fetch: f = fetch, getToken } = {}) {
  let r;
  try {
    r = await f(`https://api.spotify.com/v1/tracks/${encodeURIComponent(spotifyId)}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
  } catch { throw upstream(); }
  if (r.status === 429 || r.status >= 500) throw upstream();
  if (!r.ok) return null;
  try {
    const j = await r.json();
    const isrc = j && j.external_ids && j.external_ids.isrc;
    return typeof isrc === 'string' && ISRC_RE.test(isrc) ? isrc : null;
  } catch { return null; }
}

module.exports = { normTitle, deezerByIsrc, appleSearch, spotifyIsrc };
