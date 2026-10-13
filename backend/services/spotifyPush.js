// Spotify sync (sub-project F): compare the catalogue with the playlist, and ADD live songs that
// are missing from it. Add-only and idempotent; never writes the database.
// SECURITY: errors carry fixed strings + `.code`; never the access token, a request body or a fetch
// error's message/cause.
const { fetchPlaylistTracks, getSpotifyClient, DEFAULT_PLAYLIST_ID } = require('../utils/playlistSync');

const API = 'https://api.spotify.com/v1';
const CHUNK = 100;
const TIMEOUT_MS = 10000;
const MAX_429_RETRIES = 3;
const MAX_WAIT_S = 30; // longer Retry-After than this: fail fast rather than hang the admin request
let pushing = false; // one push at a time, so overlapping requests cannot both POST the same tracks

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

function parseSongIds(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0) throw coded('BAD_INPUT', 'songIds must be a non-empty array of song ids');
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x <= 0) throw coded('BAD_INPUT', 'songIds must be positive integers');
  }
  return [...new Set(v)];
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const defaultFetchTracks = async (playlistId) => fetchPlaylistTracks(await getSpotifyClient(), playlistId);

async function loadSongs(pool) {
  return (await pool.query(`
    SELECT s.id, s.title, s.spotify_id, s.status, s.published,
           COALESCE(string_agg(a.name, ', ' ORDER BY sa.id), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    GROUP BY s.id`)).rows;
}

const isLive = (s) => s.status === 'included' && s.published === true;
const brief = (s) => ({ id: s.id, title: s.title, artists: s.artists });

function classify(songs, tracks) {
  const onPlaylist = new Set(tracks.map((t) => t.spotify_id));
  const known = new Set(songs.filter((s) => s.spotify_id).map((s) => s.spotify_id));
  return {
    onPlaylist,
    pullable: tracks.filter((t) => !known.has(t.spotify_id)),
    pushable: songs.filter((s) => isLive(s) && s.spotify_id && !onPlaylist.has(s.spotify_id)),
    noSpotifyId: songs.filter((s) => isLive(s) && !s.spotify_id),
    onPlaylistNotLive: songs.filter((s) => s.spotify_id && onPlaylist.has(s.spotify_id) && !isLive(s)),
  };
}

async function compare(pool, { playlistId = DEFAULT_PLAYLIST_ID, fetchTracks = defaultFetchTracks } = {}) {
  const [songs, tracks] = [await loadSongs(pool), await fetchTracks(playlistId)];
  const c = classify(songs, tracks);
  return {
    playlistTrackCount: tracks.length,
    pullable: c.pullable.map((t) => ({ spotify_id: t.spotify_id, title: t.title, artists: (t.artists || []).map((a) => a.name).join(', ') })),
    pushable: c.pushable.map(brief),
    noSpotifyId: c.noSpotifyId.map(brief),
    onPlaylistNotLive: c.onPlaylistNotLive.map((s) => ({ ...brief(s), status: s.status, published: s.published })),
  };
}

// POST the URIs in chunks of 100. Throws coded errors; `.addedCount` = URIs added before the failure.
async function addUris(uris, { accessToken, playlistId = DEFAULT_PLAYLIST_ID, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let addedCount = 0;
  for (const part of chunk(uris, CHUNK)) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${API}/playlists/${playlistId}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: part }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        const e = coded('UPSTREAM', 'could not reach Spotify'); e.addedCount = addedCount; throw e;
      }
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const wait = (parseInt(res.headers && res.headers.get && res.headers.get('retry-after')) || 1) + 1;
        if (wait > MAX_WAIT_S) {
          const e = coded('UPSTREAM', 'Spotify is rate-limiting requests — try again in a few minutes'); e.addedCount = addedCount; throw e;
        }
        await sleep(wait * 1000);
        continue;
      }
      if (res.ok) { addedCount += part.length; break; }
      const e = res.status === 401 ? coded('REAUTH', 'Spotify authorisation expired — connect again')
        : res.status === 403 ? coded('FORBIDDEN', "This Spotify account can't edit this playlist — it must own it or be a collaborator")
        : coded('UPSTREAM', `Spotify rejected the request (HTTP ${res.status})`);
      e.addedCount = addedCount;
      throw e;
    }
  }
  return addedCount;
}

async function pushSongsUnguarded(pool, { songIds, accessToken, playlistId = DEFAULT_PLAYLIST_ID, fetchTracks = defaultFetchTracks, fetchImpl, sleep } = {}) {
  const ids = songIds === undefined ? undefined : parseSongIds(songIds);
  const songs = await loadSongs(pool);
  const tracks = await fetchTracks(playlistId);
  const onPlaylist = new Set(tracks.map((t) => t.spotify_id));

  let pool_ = songs;
  const notEligible = [];
  if (ids) {
    const byId = new Map(songs.map((s) => [s.id, s]));
    pool_ = [];
    for (const id of ids) {
      const s = byId.get(id);
      if (!s) notEligible.push({ id, reason: 'not_found' });
      else if (!isLive(s)) notEligible.push({ id, reason: 'not_live' });
      else if (!s.spotify_id) notEligible.push({ id, reason: 'no_spotify_id' });
      else pool_.push(s);
    }
  }
  const eligible = pool_.filter((s) => isLive(s) && s.spotify_id);
  const alreadyThere = eligible.filter((s) => onPlaylist.has(s.spotify_id)).length;
  const bySpotify = new Map();
  for (const s of eligible) if (!onPlaylist.has(s.spotify_id) && !bySpotify.has(s.spotify_id)) bySpotify.set(s.spotify_id, s);
  const toAdd = [...bySpotify.entries()];

  const added = [];
  try {
    for (const part of chunk(toAdd, CHUNK)) {
      await addUris(part.map(([sid]) => `spotify:track:${sid}`), { accessToken, playlistId, fetchImpl, sleep });
      for (const [, s] of part) added.push(brief(s));
    }
  } catch (e) {
    // addUris chunks internally, but each call here is already <=100, so a failure means nothing in this part landed
    e.added = added;
    throw e;
  }
  return { added, alreadyThere, notEligible };
}

async function pushSongs(pool, opts) {
  if (pushing) throw coded('BUSY', 'A push is already running');
  pushing = true;
  try { return await pushSongsUnguarded(pool, opts); } finally { pushing = false; }
}

module.exports = { parseSongIds, chunk, compare, pushSongs, _addUris: addUris };
