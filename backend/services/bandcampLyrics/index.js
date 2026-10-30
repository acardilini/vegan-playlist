// Bandcamp lyrics fetch: reads a band's own Bandcamp pages for lyrics of songs that have none, holds the results in
// memory for the curator to review, and saves one only on an explicit call. See the 2026-10-30 design spec.
// Lyrics live only in the in-memory run and (after Save) song_lyrics: never log them, a URL or a fetch error's message.
const crypto = require('crypto');
const { createBandcampAdapter, normalizeBandcampOrigin } = require('../bandCheck/bandcamp');
const { defaultFetch } = require('../bandCheck/http');
const { coded, sourceError, MESSAGES } = require('../bandCheck/errors');
const curation = require('../curation');
const bandCheck = require('../bandCheck');
const { matchSongs, creditMatches } = require('./match');

const RUN_TTL_MS = 30 * 60 * 1000;
const GAP_MS = 300;
const NOTE = {
  other: 'Bandcamp credits a different artist',
  ambiguous: 'more than one match',
  cut: 'not found (catalogue was cut short)',
  missing: 'not found on Bandcamp',
  unreadable: 'the song page could not be read',
};

const runs = new Map(); // runId -> run
let active = null;
function _resetForTests() { runs.clear(); active = null; savingSongs.clear(); }

function purge(now = Date.now()) {
  for (const [id, r] of runs) if (r.finishedAt && now - r.finishedAt > RUN_TTL_MS) runs.delete(id);
}

const defaultAdapter = () => createBandcampAdapter({ fetch: defaultFetch });

// Songs with no real lyrics (same test as curation.HAS_LYRICS_SQL: a junk-flagged song counts as having none).
async function eligibleSongs(db, { artistId, songId }) {
  const where = songId ? 's.id = $1' : 'EXISTS (SELECT 1 FROM song_artists x WHERE x.song_id = s.id AND x.artist_id = $1)';
  const r = await db.query(
    `SELECT s.id, s.title, s.bandcamp_url,
            ARRAY(SELECT a.name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id WHERE sa.song_id = s.id ORDER BY sa.id) AS artists
       FROM songs s
      WHERE ${where} AND s.status <> 'rejected' AND NOT ${curation.HAS_LYRICS_SQL}
      ORDER BY s.title, s.id`, [songId || artistId]);
  return r.rows;
}

function newRun(total) {
  const id = crypto.randomUUID();
  const run = { id, status: 'running', done: 0, total, results: [], truncated: false, error: null, finishedAt: null };
  runs.set(id, run);
  active = id;
  return run;
}
function finishRun(run, patch) {
  Object.assign(run, patch, { finishedAt: Date.now() });
  if (active === run.id) active = null;
}

function classify(song, page, extraNames) {
  const base = { songId: song.id, title: song.title };
  if (!creditMatches(page.artist, [...song.artists, ...extraNames])) return { ...base, status: 'other-artist', note: NOTE.other };
  if (!page.lyrics) return { ...base, status: 'no-lyrics', note: 'no lyrics on the Bandcamp page' };
  return { ...base, status: 'found', lyrics: page.lyrics };
}

async function readTrack(adapter, song, url, extraNames) {
  try {
    const result = classify(song, await adapter.fetchTrack(url), extraNames);
    return result.status === 'found' ? { ...result, url } : result;
  } catch (e) {
    const err = sourceError(e);
    if (err.code === 'UPSTREAM' || err.code === 'RATE_LIMITED') throw err; // the source is struggling: stop, don't hammer
    return { songId: song.id, title: song.title, status: 'no-lyrics', note: NOTE.unreadable };
  }
}

// Runs in the background after start*; never throws (failures land on the run).
async function execute(run, { adapter, songs, origin, directUrl, artistName, sleep, gapMs }) {
  try {
    const byId = new Map();
    const extra = artistName ? [artistName] : [];
    if (directUrl) {
      run.total = 1;
      byId.set(songs[0].id, await readTrack(adapter, songs[0], directUrl, extra));
      run.done = 1;
    } else {
      const cat = await adapter.fetchCatalogue(origin);
      run.truncated = !!cat.truncated;
      const tracks = cat.releases.flatMap((rel) => rel.tracks.map((t) => ({ title: t.title, url: t.url })));
      const { matched, ambiguous, unmatched } = matchSongs(songs, tracks);
      run.total = matched.length;
      const missing = run.truncated ? NOTE.cut : NOTE.missing;
      for (const id of unmatched) byId.set(id, { songId: id, title: songs.find((s) => s.id === id).title, status: 'not-found', note: missing });
      for (const id of ambiguous) byId.set(id, { songId: id, title: songs.find((s) => s.id === id).title, status: 'ambiguous', note: NOTE.ambiguous });
      for (const m of matched) {
        if (run.done > 0) await sleep(gapMs);
        byId.set(m.songId, await readTrack(adapter, songs.find((s) => s.id === m.songId), m.url, extra));
        run.done += 1;
      }
    }
    finishRun(run, { status: 'done', results: songs.map((s) => byId.get(s.id)) });
  } catch (e) {
    const err = sourceError(e);
    finishRun(run, { status: 'failed', results: undefined, error: { code: err.code || 'UPSTREAM', message: MESSAGES[err.code] || MESSAGES.UPSTREAM } }); // fixed strings only: a source error's own message may hold a URL
  }
}

function guardStart() {
  purge();
  if (active) throw coded('BUSY', 'Another Bandcamp lyrics run is in progress');
}
const noLink = () => coded('NO_IDENTITY', 'This artist has no Bandcamp link - add one in the Links panel first');

async function startArtistRun(db, artistId, { adapter = defaultAdapter(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = GAP_MS } = {}) {
  const a = (await db.query(`SELECT id, name, bandcamp_url FROM artists WHERE id = $1`, [artistId])).rows[0];
  if (!a) throw coded('NOT_FOUND', 'Artist not found');
  const origin = normalizeBandcampOrigin(a.bandcamp_url);
  if (!origin) throw noLink();
  const songs = await eligibleSongs(db, { artistId }); // before the guard: nothing may await between the BUSY check and the claim
  guardStart();
  const run = newRun(0);
  if (!songs.length) { finishRun(run, { status: 'done', results: [] }); return { runId: run.id }; } // nothing to fetch: don't read Bandcamp
  execute(run, { adapter, songs, origin, artistName: a.name, sleep, gapMs });
  return { runId: run.id };
}

async function startSongRun(db, songId, { adapter = defaultAdapter(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = GAP_MS } = {}) {
  if (!(await db.query(`SELECT 1 FROM songs WHERE id = $1`, [songId])).rows.length) throw coded('NOT_FOUND', 'Song not found');
  const songs = await eligibleSongs(db, { songId });
  if (!songs.length) throw coded('CONFLICT', 'This song already has lyrics (or is rejected) - nothing to fetch');
  const song = songs[0];
  let directUrl = null;
  const own = normalizeBandcampOrigin(song.bandcamp_url);
  if (own) { try { if (/^\/track\//.test(new URL(song.bandcamp_url).pathname)) directUrl = song.bandcamp_url; } catch { /* not a URL */ } }
  let origin = null, artistName = null;
  if (!directUrl) {
    const a = (await db.query(
      `SELECT a.name, a.bandcamp_url FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
        WHERE sa.song_id = $1 AND a.bandcamp_url IS NOT NULL ORDER BY sa.id`, [songId])).rows
      .find((x) => normalizeBandcampOrigin(x.bandcamp_url));
    if (!a) throw noLink();
    origin = normalizeBandcampOrigin(a.bandcamp_url);
    artistName = a.name;
  }
  guardStart();
  const run = newRun(0);
  execute(run, { adapter, songs: [song], origin, directUrl, artistName, sleep, gapMs });
  return { runId: run.id };
}

function getRun(runId) {
  purge();
  const run = runs.get(runId);
  if (!run) throw coded('NOT_FOUND', 'That run is no longer available - run the fetch again');
  const out = { status: run.status, done: run.done, total: run.total };
  if (run.status === 'done') { out.results = run.results; out.truncated = run.truncated; }
  if (run.status === 'failed') out.error = run.error;
  return out;
}

async function saveFetched(db, runId, songId) {
  purge();
  const run = runs.get(runId);
  if (!run) throw coded('NOT_FOUND', 'That run is no longer available - run the fetch again');
  if (run.status !== 'done') throw coded('CONFLICT', 'The run has not finished');
  const result = run.results.find((r) => r.songId === songId);
  if (!result) throw coded('NOT_FOUND', 'That song is not in this run');
  if (result.status !== 'found' || result.saved || result.saving) throw coded('CONFLICT', 'There are no fetched lyrics to save for this song');
  result.saving = true; // claimed before any await, so two parallel Saves of one row cannot both write
  try {
  const stillEmpty = (await db.query(`SELECT 1 FROM songs s WHERE s.id = $1 AND NOT ${curation.HAS_LYRICS_SQL}`, [songId])).rows.length;
  if (!stillEmpty) throw coded('CONFLICT', 'This song now has lyrics - nothing was changed');
  await curation.saveLyrics(db, songId, { lyrics: result.lyrics, source_url: result.url, lyrics_source: 'Bandcamp' });
  result.saved = true;
  delete result.lyrics;
  return { saved: true };
  } finally { delete result.saving; }
}


// ---- Catalogue run: lyrics for a band's new and held catalogue songs (Band check's merged read) ----
const PASTED = 'Added by curator';
const savingSongs = new Set(); // songs with a Save in flight: claimed before any await so two parallel Saves cannot both write

async function executeCatalogue(run, { adapter, targets, artistName, sleep, gapMs }) {
  try {
    const rows = [];
    let requested = 0;
    for (const t of targets) {
      const base = { key: t.key, title: t.title, state: t.heldSongId ? 'held' : 'new', ...(t.heldSongId ? { songId: t.heldSongId } : {}) };
      if (!t.bandcampUrl) { rows.push({ ...base, status: 'not-on-bandcamp', note: 'not listed on Bandcamp' }); continue; }
      if (requested > 0) await sleep(gapMs);
      requested += 1;
      const r = await readTrack(adapter, { id: 0, title: t.title, artists: [] }, t.bandcampUrl, [artistName]);
      rows.push({ ...base, status: r.status, ...(r.lyrics ? { lyrics: r.lyrics } : {}), ...(r.url ? { url: r.url } : {}), ...(r.note ? { note: r.note } : {}) });
      run.done = requested;
    }
    finishRun(run, { status: 'done', results: rows });
  } catch (e) {
    const err = sourceError(e);
    finishRun(run, { status: 'failed', results: undefined, error: { code: err.code || 'UPSTREAM', message: MESSAGES[err.code] || MESSAGES.UPSTREAM } });
  }
}

async function startCatalogueRun(db, artistId, { catalogue = (d, id) => bandCheck.catalogueForLyrics(d, id), adapter = defaultAdapter(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = GAP_MS } = {}) {
  const cat = await catalogue(db, artistId);
  const heldIds = cat.songs.filter((s) => s.state === 'in_catalogue' && s.match && s.match.status !== 'rejected').map((s) => s.match.song_id);
  const lacking = new Set(heldIds.length
    ? (await db.query(`SELECT s.id FROM songs s WHERE s.id = ANY($1::int[]) AND NOT ${curation.HAS_LYRICS_SQL}`, [heldIds])).rows.map((r) => r.id)
    : []);
  const targets = [];
  for (const s of cat.songs) {
    if (s.state === 'new') targets.push({ key: s.key, title: s.title, bandcampUrl: s.bandcampUrl });
    else if (s.match && lacking.has(s.match.song_id)) targets.push({ key: s.key, title: s.title, bandcampUrl: s.bandcampUrl, heldSongId: s.match.song_id });
  }
  guardStart();
  const run = newRun(targets.filter((t) => t.bandcampUrl).length);
  executeCatalogue(run, { adapter, targets, artistName: cat.artist.name, sleep, gapMs }); // background; it catches everything
  return { runId: run.id };
}

// The lyrics to attach to the songs Apply creates: pasted text wins, else the run's found lyrics. Never throws.
function resolveForApply(runId, keys, pasted = {}) {
  const run = runs.get(runId);
  const out = new Map();
  for (const key of keys) {
    const text = pasted && typeof pasted[key] === 'string' ? pasted[key].trim() : '';
    if (text) { out.set(key, { text, source: PASTED, url: null }); continue; }
    const row = run && run.status === 'done' ? run.results.find((r) => r.key === key && r.status === 'found' && r.lyrics) : null;
    if (row) out.set(key, { text: row.lyrics, source: 'Bandcamp', url: row.url || null });
  }
  return out;
}

// Save lyrics onto a held song (already in the database) of this artist: fetched (run row) or pasted (text).
async function saveHeldLyrics(db, artistId, songId, { runId, key, text } = {}) {
  purge();
  if (!(await db.query(`SELECT 1 FROM song_artists WHERE song_id = $1 AND artist_id = $2`, [songId, artistId])).rows.length) throw coded('NOT_FOUND', 'Song not found for this artist');
  const pastedText = typeof text === 'string' ? text.trim() : '';
  let row = null;
  if (!pastedText) {
    const run = runs.get(runId);
    if (!run || run.status !== 'done') throw coded('NOT_FOUND', 'That run is no longer available - run the fetch again');
    row = run.results.find((r) => r.key === key && r.songId === songId);
    if (!row) throw coded('NOT_FOUND', 'That song is not in this run');
    if (row.status !== 'found' || row.saved) throw coded('CONFLICT', 'There are no fetched lyrics to save for this song');
  }
  if (savingSongs.has(songId)) throw coded('CONFLICT', 'A save for this song is already in progress');
  savingSongs.add(songId);
  try {
    const stillEmpty = (await db.query(`SELECT 1 FROM songs s WHERE s.id = $1 AND NOT ${curation.HAS_LYRICS_SQL}`, [songId])).rows.length;
    if (!stillEmpty) throw coded('CONFLICT', 'This song now has lyrics - nothing was changed');
    await curation.saveLyrics(db, songId, pastedText
      ? { lyrics: pastedText, lyrics_source: PASTED }
      : { lyrics: row.lyrics, source_url: row.url, lyrics_source: 'Bandcamp' });
    if (row) { row.saved = true; delete row.lyrics; }
    return { saved: true };
  } finally { savingSongs.delete(songId); }
}

module.exports = { startArtistRun, startSongRun, startCatalogueRun, getRun, saveFetched, resolveForApply, saveHeldLyrics, _resetForTests };
