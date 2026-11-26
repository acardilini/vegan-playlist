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

// Apple's artist field can be a collaboration ("A & B", "A feat. B"). Split it into whole names and compare each one,
// so "Rise" is never found inside "Sunrise Avenue".
const stripThe = (n) => n.replace(/^the /, '');
const creditNames = (credit) => String(credit == null ? '' : credit)
  .split(/\s*(?:&|,|;|\/|\+|\bfeat\.?(?=\s)|\bfeaturing\b|\bwith\b|\band\b|\bx\b)\s*/i)
  .map((n) => stripThe(normName(n))).filter(Boolean);

// Apple's free search cannot take an ISRC and its results carry none, so a hit is only "same base title, same first
// artist". A different version of the song can pass, which is why the curator confirms every Apple match.
async function appleSearch({ title, artist } = {}, { fetch: f = fetch } = {}) {
  const wantTitle = normTitle(title);
  const wantArtist = stripThe(normName(artist));
  if (!wantTitle || !wantArtist) return null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const r = await f(`https://itunes.apple.com/search?media=music&entity=song&limit=5&country=US&term=${term}`);
    if (!r.ok) return null;
    const j = await r.json();
    const hit = ((j && j.results) || []).find((x) => x && typeof x.trackViewUrl === 'string' && normTitle(x.trackName) === wantTitle
      && creditNames(x.artistName).includes(wantArtist));
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

// ---- the run, the stored rows and the curator's review ----

const PLATFORMS = Object.freeze(['deezer', 'apple_music', 'tidal']);
const PUBLIC_ORDER = `CASE platform WHEN 'apple_music' THEN 1 WHEN 'deezer' THEN 2 WHEN 'tidal' THEN 3 ELSE 4 END`;
const DEFAULT_GAPS = Object.freeze({ spotify: 100, deezer: 120, apple: 3200 }); // Apple's free search allows roughly 20 a minute
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const coded = (code, message) => { const e = new Error(message); e.code = code; return e; };

// Spotify client-credentials token, cached until shortly before it expires. Errors are fixed strings.
function makeSpotifyToken({ fetch: f = fetch, env = process.env } = {}) {
  let tok = null; let until = 0;
  return async () => {
    if (tok && Date.now() < until) return tok;
    let j;
    try {
      const r = await f('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64') },
        body: 'grant_type=client_credentials' });
      j = r.ok ? await r.json() : null;
    } catch { j = null; }
    if (!j || !j.access_token) throw upstream();
    tok = j.access_token; until = Date.now() + Math.max(0, (j.expires_in || 3600) - 60) * 1000;
    return tok;
  };
}
function defaultAdapters() {
  const getToken = makeSpotifyToken();
  return { spotifyIsrc: (id) => spotifyIsrc(id, { getToken }), deezerByIsrc: (isrc) => deezerByIsrc(isrc), appleSearch: (q) => appleSearch(q) };
}

const runs = new Map();   // runId -> { state, total, done, found, skipped, promise }
let activeRun = null;
let runSeq = 0;

// Songs the run looks at: included songs with a Spotify id that still lack a row for Deezer or Apple. `songIds` narrows it
// (tests always pass it). A song is looked at whether or not it is published yet, so its links are ready when it is.
async function candidateSongs(db, songIds) {
  const r = await db.query(
    `SELECT s.id, s.title, s.spotify_id, s.isrc,
            (SELECT a.name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id WHERE sa.song_id = s.id ORDER BY sa.id LIMIT 1) AS artist,
            EXISTS (SELECT 1 FROM song_platform_links l WHERE l.song_id = s.id AND l.platform = 'deezer') AS has_deezer,
            EXISTS (SELECT 1 FROM song_platform_links l WHERE l.song_id = s.id AND l.platform = 'apple_music') AS has_apple
       FROM songs s
      WHERE s.status = 'included' AND s.spotify_id IS NOT NULL
        AND ($1::int[] IS NULL OR s.id = ANY($1::int[]))
        AND (NOT EXISTS (SELECT 1 FROM song_platform_links l WHERE l.song_id = s.id AND l.platform = 'deezer')
          OR NOT EXISTS (SELECT 1 FROM song_platform_links l WHERE l.song_id = s.id AND l.platform = 'apple_music'))
      ORDER BY s.id`, [Array.isArray(songIds) ? songIds : null]);
  return r.rows;
}

const insertLink = (db, id, platform, url, status, source, m = {}) => db.query(
  `INSERT INTO song_platform_links (song_id, platform, url, status, source, match_title, match_artist)
   VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (song_id, platform) DO NOTHING`,
  [id, platform, url, status, source, m.title || null, m.artist || null]);

async function execute(db, run, songs, adapters, gaps) {
  for (const s of songs) {
    try {
      let isrc = s.isrc;
      if (!s.has_deezer) {
        if (!isrc) {
          try {
            isrc = await adapters.spotifyIsrc(s.spotify_id);
            if (isrc) await db.query('UPDATE songs SET isrc = $2 WHERE id = $1 AND isrc IS NULL', [s.id, isrc]);
          } catch { run.skipped++; }
          await sleep(gaps.spotify);
        }
        if (isrc) {
          const d = await adapters.deezerByIsrc(isrc);
          if (d && d.url) { await insertLink(db, s.id, 'deezer', d.url, 'confirmed', 'isrc'); run.found.deezer++; }
          await sleep(gaps.deezer);
        }
      }
      if (!s.has_apple) {
        const a = await adapters.appleSearch({ title: s.title, artist: s.artist });
        if (a && a.url) { await insertLink(db, s.id, 'apple_music', a.url, 'proposed', 'search', a); run.found.apple_proposed++; }
        await sleep(gaps.apple);
      }
    } catch { run.skipped++; }   // one song's failure never stops the run; no message is kept
    run.done++;
  }
}

// Start the in-memory job. One run at a time (BUSY). Results are written as they are found, so a restart loses only the
// unfinished tail. Returns at once; poll getRun.
async function startRun(db, { adapters = defaultAdapters(), gaps = DEFAULT_GAPS, songIds = null } = {}) {
  if (activeRun) throw coded('BUSY', 'a run is already in progress');
  const id = String(++runSeq);
  const run = { state: 'running', total: 0, done: 0, found: { deezer: 0, apple_proposed: 0 }, skipped: 0 };
  runs.set(id, run);
  if (runs.size > 10) runs.delete(runs.keys().next().value);
  activeRun = id;
  run.promise = (async () => {
    try {
      const songs = await candidateSongs(db, songIds);
      run.total = songs.length;
      await execute(db, run, songs, adapters, { ...DEFAULT_GAPS, ...gaps });
      run.state = 'done';
    } catch (e) {
      run.state = 'failed';
      console.error('platform links run failed:', (e && e.code) || 'error');
    } finally { activeRun = null; }
  })();
  return { runId: id };
}
const getRun = (runId) => {
  const r = runs.get(String(runId));
  return r ? { state: r.state, total: r.total, done: r.done, found: { ...r.found }, skipped: r.skipped } : null;
};
const waitForRun = (runId) => { const r = runs.get(String(runId)); return r ? r.promise : Promise.resolve(); };

// The curator's decision on a proposed link. Only a proposed row can be reviewed.
async function reviewLink(db, songId, platform, { action } = {}) {
  if (!PLATFORMS.includes(platform)) throw coded('BAD_INPUT', 'unknown platform');
  if (action !== 'confirm' && action !== 'reject') throw coded('BAD_INPUT', 'action must be confirm or reject');
  const r = await db.query(
    `UPDATE song_platform_links SET status = $3 WHERE song_id = $1 AND platform = $2 AND status = 'proposed'
     RETURNING song_id, platform, url, status, source, match_title, match_artist`, [songId, platform, action === 'confirm' ? 'confirmed' : 'rejected']);
  if (r.rows[0]) return r.rows[0];
  const ex = await db.query('SELECT 1 FROM song_platform_links WHERE song_id = $1 AND platform = $2', [songId, platform]);
  throw ex.rows.length ? coded('BAD_INPUT', 'only a proposed link can be reviewed') : coded('NOT_FOUND', 'no such link');
}

const linksForSong = async (db, songId) => (await db.query(
  `SELECT platform, url, status, source, match_title, match_artist FROM song_platform_links WHERE song_id = $1 ORDER BY ${PUBLIC_ORDER}`, [songId])).rows;

// What the public song page may show: confirmed links only, in a fixed order.
const publicLinks = async (db, songId) => (await db.query(
  `SELECT platform, url FROM song_platform_links WHERE song_id = $1 AND status = 'confirmed' ORDER BY ${PUBLIC_ORDER}`, [songId])).rows;

async function counts(db) {
  const r = await db.query(`SELECT platform, status, COUNT(*)::int AS n FROM song_platform_links GROUP BY 1, 2`);
  const out = { proposed: 0, confirmed: Object.fromEntries(PLATFORMS.map((p) => [p, 0])) };
  for (const x of r.rows) {
    if (x.status === 'proposed') out.proposed += x.n;
    if (x.status === 'confirmed' && x.platform in out.confirmed) out.confirmed[x.platform] += x.n;
  }
  return out;
}

module.exports = { normTitle, deezerByIsrc, appleSearch, spotifyIsrc, makeSpotifyToken, startRun, getRun, waitForRun, reviewLink, linksForSong, publicLinks, counts, PLATFORMS };
