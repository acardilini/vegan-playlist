// Spotify sync (sub-project F): compare the catalogue with the playlist, and ADD live songs that
// are missing from it. Add-only and idempotent; never writes the database.
// SECURITY: errors carry fixed strings + `.code`; never the access token, a request body or a fetch
// error's message/cause.
const { fetchPlaylistTracksLite, getSpotifyClient, DEFAULT_PLAYLIST_ID } = require('../utils/playlistSync');
const { normalizeName } = require('./staging'); // the same title/artist normaliser the intake dedupe uses

const API = 'https://api.spotify.com/v1';
const CHUNK = 100;
const TIMEOUT_MS = 10000;
const MAX_429_RETRIES = 3;
const CACHE_MS = 60 * 1000; // compare's playlist read only; push always reads live
const MAX_WAIT_S = 30; // longer Retry-After than this: fail fast rather than hang the admin request
const cache = new Map(); // playlistId -> { at, tracks }
let cacheGen = 0; // bumped by clearCache so a read that started before a push can't re-cache the pre-push playlist
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

const defaultFetchTracks = async (playlistId) => fetchPlaylistTracksLite(await getSpotifyClient(), playlistId);

function clearCache() { cache.clear(); cacheGen++; }

// Only compare may pass useCache: a push must read the live playlist (that read is what keeps it idempotent).
// `fresh` skips the cached read but still writes the result, so the next cached call sees it.
async function readTracks(fetchTracks, playlistId, { useCache = false, fresh = false, now = Date.now } = {}) {
  if (useCache && !fresh) {
    const hit = cache.get(playlistId);
    if (hit && now() - hit.at < CACHE_MS) return hit.tracks;
  }
  const gen = cacheGen;
  const tracks = await fetchTracks(playlistId);
  if (useCache && gen === cacheGen) cache.set(playlistId, { at: now(), tracks });
  return tracks;
}

async function loadSongs(pool) {
  return (await pool.query(`
    SELECT s.id, s.title, s.spotify_id, s.spotify_dormant, s.status, s.published,
           COALESCE(string_agg(a.name, ', ' ORDER BY sa.id), '') AS artists,
           (array_agg(a.name ORDER BY sa.id))[1] AS first_artist
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    GROUP BY s.id`)).rows;
}

const isLive = (s) => s.status === 'included' && s.published === true;
const brief = (s) => ({ id: s.id, title: s.title, artists: s.artists });

const artistsOf = (t) => (t.artists || []).map((a) => a.name).join(', ');
// title+first artist, normalised; null when the title normalises to nothing (never match on that)
const keyOf = (title, artist) => { const t = normalizeName(title); return t ? `${t}|${normalizeName(artist)}` : null; };

function classify(songs, tracks) {
  const onPlaylist = new Set(tracks.map((t) => t.spotify_id));
  const known = new Set(songs.filter((s) => s.spotify_id).map((s) => s.spotify_id));
  // A playlist track that is itself a distinct LIVE catalogue song (Vox 2 vs Vox 3, "X" vs "X - Metal Version")
  // is never the "other version" of a look-alike. A track owned by a pending/rejected row (e.g. one just pulled) is.
  const liveIds = new Set(songs.filter((s) => isLive(s) && s.spotify_id).map((s) => s.spotify_id));
  const byKey = new Map();
  for (const t of tracks) {
    if (liveIds.has(t.spotify_id)) continue;
    const k = keyOf(t.title, t.artists && t.artists[0] && t.artists[0].name);
    if (k && !byKey.has(k)) byKey.set(k, t);
  }
  // Same song, different Spotify track id (album vs single, remaster...): not pushable, shown for review.
  const dupMatch = new Map(); // song id -> matching playlist track
  // A dormant link (curator-marked unplayable) is never offered for push.
  const notOnPlaylist = songs.filter((s) => isLive(s) && s.spotify_id && !s.spotify_dormant && !onPlaylist.has(s.spotify_id));
  for (const s of notOnPlaylist) {
    const k = keyOf(s.title, s.first_artist);
    if (k && byKey.has(k)) dupMatch.set(s.id, byKey.get(k));
  }
  return {
    onPlaylist,
    dupMatch,
    possibleDuplicates: notOnPlaylist.filter((s) => dupMatch.has(s.id)),
    pullable: tracks.filter((t) => !known.has(t.spotify_id)),
    pushable: notOnPlaylist.filter((s) => !dupMatch.has(s.id)),
    noSpotifyId: songs.filter((s) => isLive(s) && !s.spotify_id),
    onPlaylistNotLive: songs.filter((s) => s.spotify_id && onPlaylist.has(s.spotify_id) && !isLive(s)),
  };
}

const matchOf = (t) => ({ spotify_id: t.spotify_id, title: t.title, artists: artistsOf(t) });

async function compare(pool, { playlistId = DEFAULT_PLAYLIST_ID, fetchTracks = defaultFetchTracks, useCache = false, fresh = false, now } = {}) {
  const [songs, tracks] = [await loadSongs(pool), await readTracks(fetchTracks, playlistId, { useCache, fresh, now })];
  const c = classify(songs, tracks);
  return {
    playlistTrackCount: tracks.length,
    pullable: c.pullable.map(matchOf),
    pushable: c.pushable.map(brief),
    possibleDuplicates: c.possibleDuplicates.map((s) => ({ ...brief(s), match: matchOf(c.dupMatch.get(s.id)) })),
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

async function pushSongsUnguarded(pool, { songIds, allowDuplicates = false, accessToken, playlistId = DEFAULT_PLAYLIST_ID, fetchTracks = defaultFetchTracks, fetchImpl, sleep } = {}) {
  const ids = songIds === undefined ? undefined : parseSongIds(songIds);
  const songs = await loadSongs(pool);
  const tracks = await fetchTracks(playlistId);
  const { onPlaylist, dupMatch } = classify(songs, tracks);

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
      else if (s.spotify_dormant) notEligible.push({ id, reason: 'spotify_dormant' });
      else if (dupMatch.has(id) && allowDuplicates !== true) notEligible.push({ id, reason: 'possible_duplicate', match: matchOf(dupMatch.get(id)) });
      else pool_.push(s);
    }
  }
  // A bulk push skips possible duplicates too; only an explicit push may override (allowDuplicates), after screening above.
  const eligible = pool_.filter((s) => isLive(s) && s.spotify_id && !s.spotify_dormant && (!dupMatch.has(s.id) || (ids && allowDuplicates === true)));
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
  try { return await pushSongsUnguarded(pool, opts); } finally { pushing = false; clearCache(); } // the playlist changed (or may have)
}

module.exports = { parseSongIds, chunk, compare, pushSongs, clearCache, _addUris: addUris };
