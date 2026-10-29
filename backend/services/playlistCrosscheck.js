// Playlist cross-check: compare someone else's public Spotify playlist with the whole catalogue, then
// import / reject the tracks the curator chooses. Spec: docs/superpowers/specs/2026-10-29-playlist-crosscheck-design.md
// SECURITY: errors carry fixed strings + `.code`; never a Spotify error's message, URL or token.
const { getSpotifyClient, fetchPlaylistTracks } = require('../utils/playlistSync');
const { normalizeName } = require('./staging');

const CACHE_MS = 60 * 1000;
const cache = new Map(); // playlistId -> { at, result }

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

function parsePlaylistId(input) {
  const s = String(input == null ? '' : input).trim();
  const m = s.match(/playlist[/:]([A-Za-z0-9]{22})/) || s.match(/^([A-Za-z0-9]{22})$/);
  if (!m) throw coded('BAD_INPUT', 'Not a Spotify playlist link');
  return m[1];
}

async function defaultFetchPlaylist(playlistId) {
  try {
    const api = await getSpotifyClient();
    const meta = await api.getPlaylist(playlistId, { fields: 'name,tracks(total)' });
    const tracks = await fetchPlaylistTracks(api, playlistId, { maxWaitS: 30, maxRetries: 3 });
    const total = (meta.body.tracks && meta.body.tracks.total) || tracks.length;
    return { name: meta.body.name || 'Spotify playlist', tracks, ignored: Math.max(0, total - tracks.length) };
  } catch (err) {
    if (err && err.code === 'RATE_LIMITED') throw err;
    if (err && (err.statusCode === 404 || err.statusCode === 403 || err.statusCode === 400)) throw coded('NOT_READABLE', "Couldn't read that playlist - is it public?");
    if (err && err.statusCode === 429) throw coded('RATE_LIMITED', 'Spotify is rate-limiting requests - try again in a few minutes');
    throw coded('UPSTREAM', "Couldn't reach Spotify");
  }
}

async function readPlaylist(fetchPlaylist, playlistId, { fresh = false, now = Date.now } = {}) {
  const hit = cache.get(playlistId);
  if (!fresh && hit && now() - hit.at < CACHE_MS) return hit.result;
  const result = await fetchPlaylist(playlistId);
  cache.set(playlistId, { at: now(), result });
  return result;
}

// Every song in every status, so a rejected or pending twin is seen too.
async function loadCatalogue(db) {
  return (await db.query(`
    SELECT s.id, s.title, s.spotify_id, s.status, s.published,
           COALESCE(string_agg(a.name, ', ' ORDER BY sa.id), '') AS artists,
           (array_agg(a.name ORDER BY sa.id))[1] AS first_artist
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    GROUP BY s.id`)).rows;
}

const isLive = (s) => s.status === 'included' && s.published === true;
const matchOf = (s) => ({ id: s.id, title: s.title, artists: s.artists, status: s.status, live: isLive(s) });
// null when the title normalises to nothing (a non-Latin or punctuation-only title): never match on that
const keyOf = (title, artist) => { const t = normalizeName(title); return t ? `${t}|${normalizeName(artist)}` : null; };

function classifyTracks(songs, tracks) {
  const byId = new Map(songs.filter((s) => s.spotify_id).map((s) => [s.spotify_id, s]));
  const byKey = new Map();
  for (const s of songs) {
    const k = keyOf(s.title, s.first_artist);
    if (!k) continue;
    if (!byKey.has(k) || (isLive(s) && !isLive(byKey.get(k)))) byKey.set(k, s);
  }
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (seen.has(t.spotify_id)) continue;
    seen.add(t.spotify_id);
    const owned = byId.get(t.spotify_id);
    if (owned) { out.push({ track: t, state: 'have', match: matchOf(owned) }); continue; }
    const k = keyOf(t.title, t.artists && t.artists[0] && t.artists[0].name);
    const twin = k && byKey.get(k);
    out.push(twin ? { track: t, state: 'duplicate', match: matchOf(twin) } : { track: t, state: 'new', match: null });
  }
  return out;
}

async function compare(db, { input, fetchPlaylist = defaultFetchPlaylist, fresh = false, now } = {}) {
  const id = parsePlaylistId(input);
  const [songs, pl] = [await loadCatalogue(db), await readPlaylist(fetchPlaylist, id, { fresh, now })];
  const rows = classifyTracks(songs, pl.tracks);
  const counts = { new: 0, duplicate: 0, have: 0 };
  for (const r of rows) counts[r.state]++;
  return {
    playlist: { id, name: pl.name, url: `https://open.spotify.com/playlist/${id}` },
    ignored: pl.ignored || 0,
    counts,
    tracks: rows.map(({ track, state, match }) => ({
      spotify_id: track.spotify_id, title: track.title,
      artists: (track.artists || []).map((a) => a.name).join(', '),
      album: (track.album && track.album.name) || null,
      url: `https://open.spotify.com/track/${track.spotify_id}`,
      state, match,
    })),
  };
}

function _resetForTests() { cache.clear(); }

module.exports = { parsePlaylistId, classifyTracks, compare, defaultFetchPlaylist, _resetForTests,
  // used by apply (below)
  _internal: { coded, readPlaylist, loadCatalogue } };
