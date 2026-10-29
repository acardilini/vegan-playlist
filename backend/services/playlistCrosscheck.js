// Playlist cross-check: compare someone else's public Spotify playlist with the whole catalogue, then
// import / reject the tracks the curator chooses. Spec: docs/superpowers/specs/2026-10-29-playlist-crosscheck-design.md
// SECURITY: errors carry fixed strings + `.code`; never a Spotify error's message, URL or token.
const { getSpotifyClient, fetchPlaylistTracks } = require('../utils/playlistSync');
const staging = require('./staging');
const curation = require('./curation');
const { normalizeName } = staging;

const CACHE_MS = 60 * 1000;
const MAX_APPLY = 100;
const MAX_LYRICS_CHARS = 100000;
const cache = new Map(); // playlistId -> { at, result }
let applying = false; // one apply at a time

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
// null when the title OR the artist normalises to nothing (non-Latin or punctuation-only): such a key would match unrelated songs
const keyOf = (title, artist) => { const t = normalizeName(title), a = normalizeName(artist); return t && a ? `${t}|${a}` : null; };

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

function idList(v, name) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x)) throw coded('BAD_INPUT', `${name} must be a list of Spotify ids`);
  return [...new Set(v)];
}

// Imports the chosen tracks as pending, saves the rejected ones as `rejected` rows, then saves any pasted lyrics.
// Never trusts client data: only ids (and lyrics keyed by id) come in; titles and artists come from the server's own read.
// Never touches an existing song: the reject flip only hits rows this call just created.
async function apply(db, { input, importIds, rejectIds, lyrics, fetchPlaylist = defaultFetchPlaylist, saveLyricsFn = curation.saveLyrics } = {}) {
  const imp = idList(importIds, 'importIds'), rej = idList(rejectIds, 'rejectIds');
  if (imp.length + rej.length < 1 || imp.length + rej.length > MAX_APPLY) throw coded('BAD_INPUT', `Choose 1-${MAX_APPLY} songs at a time`);
  const impSet = new Set(imp);
  if (rej.some((id) => impSet.has(id))) throw coded('BAD_INPUT', 'A song cannot be both imported and rejected');
  if (lyrics !== undefined && (lyrics === null || typeof lyrics !== 'object' || Array.isArray(lyrics)
      || Object.values(lyrics).some((v) => typeof v !== 'string' || v.length > MAX_LYRICS_CHARS))) {
    throw coded('BAD_INPUT', `lyrics must be text of at most ${MAX_LYRICS_CHARS} characters per song`);
  }
  const playlistId = parsePlaylistId(input);
  if (applying) throw coded('BUSY', 'Another apply is in progress');
  applying = true;
  try {
    const [songs, pl] = [await loadCatalogue(db), await readPlaylist(fetchPlaylist, playlistId)];
    const byId = new Map(classifyTracks(songs, pl.tracks).map((c) => [c.track.spotify_id, c]));
    const skipped = [];
    const pick = (ids) => ids.flatMap((id) => {
      const c = byId.get(id);
      if (!c) { skipped.push({ spotify_id: id, reason: 'not_on_playlist' }); return []; }
      if (c.state === 'have') { skipped.push({ spotify_id: id, reason: 'already_have' }); return []; }
      return [c.track];
    });
    // a stranger's added_at must not become the song's 'date added'; their artists must never be name-merged into ours
    const clean = (t) => ({ ...t, added_at: null });
    const toImport = pick(imp).map(clean), toReject = pick(rej).map(clean);
    const importNote = `added via playlist cross-check (${pl.name})`, rejectNote = `rejected via playlist cross-check (${pl.name})`;

    let imported = 0, rejected = 0;
    if (toImport.length) imported = (await staging.insertCandidates(db, toImport, { note: importNote, allowTitleDuplicates: true, noNameBackfill: true })).added;
    if (toReject.length) {
      await staging.insertCandidates(db, toReject, { note: rejectNote, allowTitleDuplicates: true, noNameBackfill: true });
      // flip ONLY the rows this call just created: still pending, carrying this call's note, one of the ids it chose
      rejected = (await db.query(
        `UPDATE songs SET status='rejected', published=false, published_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE status='pending' AND status_notes=$1 AND spotify_id = ANY($2::text[])`,
        [rejectNote, toReject.map((t) => t.spotify_id)])).rowCount;
    }

    let lyricsSaved = 0;
    const lyricsFailed = [];
    const chosen = [...toImport, ...toReject].map((t) => t.spotify_id).filter((id) => lyrics && typeof lyrics[id] === 'string' && lyrics[id].trim());
    if (chosen.length) {
      const made = (await db.query(`SELECT id, spotify_id FROM songs WHERE spotify_id = ANY($1::text[]) AND status_notes = ANY($2::text[])`,
        [chosen, [importNote, rejectNote]])).rows;
      for (const m of made) {
        try { await saveLyricsFn(db, m.id, { lyrics: lyrics[m.spotify_id] }); lyricsSaved++; }
        catch (e) { console.error('crosscheck lyrics error:', e.code || 'error'); lyricsFailed.push(m.spotify_id); }
      }
    }
    return { imported, rejected, lyricsSaved, skipped, lyricsFailed };
  } finally { applying = false; }
}

function _resetForTests() { cache.clear(); applying = false; }

module.exports = { parsePlaylistId, classifyTracks, compare, apply, defaultFetchPlaylist, _resetForTests };
