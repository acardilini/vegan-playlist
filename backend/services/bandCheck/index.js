// Band check service: orchestrates the three source adapters, the curator-confirmed band identity, and the
// add path. Takes `db` and (injected) adapters so tests never touch the network. See the sub-project H spec.
const { createSpotifyAdapter } = require('./spotify');
const { createMusicBrainzAdapter } = require('./musicbrainz');
const { createBandcampAdapter, normalizeBandcampOrigin } = require('./bandcamp');
const { defaultFetch } = require('./http');
const { coded, sourceError } = require('./errors');
const staging = require('../staging');
const { mergeCatalogues, buildIndex, classify } = require('./merge');

const SOURCES = ['spotify', 'bandcamp', 'musicbrainz'];
const SOURCE_LABELS = { spotify: 'Spotify', bandcamp: 'Bandcamp', musicbrainz: 'MusicBrainz' };
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultAdapters() {
  return {
    spotify: createSpotifyAdapter(),
    bandcamp: createBandcampAdapter({ fetch: defaultFetch }),
    musicbrainz: createMusicBrainzAdapter({ fetch: defaultFetch }),
  };
}

const like = (s) => String(s).replace(/[\\%_]/g, c => '\\' + c);

async function listBands(db, { q = '', limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200), off = Math.max(parseInt(offset) || 0, 0);
  const pat = q ? `%${like(q)}%` : null;
  const where = `WHERE ($1::text IS NULL OR a.name ILIKE $1)`;
  const total = (await db.query(`SELECT count(*)::int AS n FROM artists a ${where}`, [pat])).rows[0].n;
  const rows = (await db.query(`
    SELECT a.id, a.name, a.spotify_id, a.bandcamp_url, a.musicbrainz_id,
           COUNT(DISTINCT sa.song_id)::int AS songs,
           (COUNT(DISTINCT sa.song_id) FILTER (WHERE s.status='included' AND s.published))::int AS live_songs
    FROM artists a
    LEFT JOIN song_artists sa ON sa.artist_id = a.id
    LEFT JOIN songs s ON s.id = sa.song_id
    ${where}
    GROUP BY a.id
    ORDER BY LOWER(a.name), a.id
    LIMIT $2 OFFSET $3`, [pat, lim, off])).rows;
  return {
    total,
    rows: rows.map(r => ({
      id: r.id, name: r.name, songs: r.songs, live_songs: r.live_songs,
      identity: { spotify: !!r.spotify_id, bandcamp: !!r.bandcamp_url, musicbrainz: !!r.musicbrainz_id },
    })),
  };
}

async function loadArtist(db, artistId) {
  const a = (await db.query(`SELECT id, name, spotify_id, bandcamp_url, musicbrainz_id FROM artists WHERE id=$1`, [artistId])).rows[0];
  if (!a) throw coded('NOT_FOUND', 'Band not found');
  return a;
}

function identityOf(a) { return { spotify: a.spotify_id || null, bandcamp: a.bandcamp_url || null, musicbrainz: a.musicbrainz_id || null }; }

async function identifyCandidates(db, artistId, source, { query, adapters } = {}) {
  if (!SOURCES.includes(source)) throw coded('BAD_INPUT', 'Unknown source');
  const artist = await loadArtist(db, artistId);
  adapters = adapters || defaultAdapters();
  const q = (query && String(query).trim()) || artist.name;
  if (source !== 'bandcamp') return adapters[source].identify(q);

  const out = new Map();
  const rows = (await db.query(
    `SELECT DISTINCT s.bandcamp_url FROM songs s JOIN song_artists sa ON sa.song_id=s.id
     WHERE sa.artist_id=$1 AND s.bandcamp_url IS NOT NULL`, [artistId])).rows;
  for (const r of rows) {
    const o = normalizeBandcampOrigin(r.bandcamp_url);
    if (o && !out.has(o)) out.set(o, { value: o, label: o, detail: "from this band's song links", url: o });
  }
  if (artist.musicbrainz_id) {
    try {
      const o = normalizeBandcampOrigin(await adapters.musicbrainz.bandcampLink(artist.musicbrainz_id));
      if (o && !out.has(o)) out.set(o, { value: o, label: o, detail: 'from MusicBrainz', url: o });
    } catch { /* MusicBrainz being down must not hide the other candidates */ }
  }
  return [...out.values()];
}

async function saveIdentity(db, artistId, source, value) {
  if (!SOURCES.includes(source)) throw coded('BAD_INPUT', 'Unknown source');
  await loadArtist(db, artistId); // NOT_FOUND first
  if (source === 'spotify') {
    if (typeof value !== 'string' || !SPOTIFY_ID.test(value)) throw coded('BAD_INPUT', 'Spotify artist ids are 22 letters and digits (a Spotify identity can be replaced, not cleared)');
    const taken = (await db.query(`SELECT id FROM artists WHERE spotify_id=$1 AND id<>$2`, [value, artistId])).rows[0];
    if (taken) throw coded('CONFLICT', 'Another artist in the catalogue already has that Spotify id');
    // artists_source_check ties spotify_id to data_source='spotify'
    try {
      await db.query(`UPDATE artists SET spotify_id=$2, spotify_url=$3, data_source='spotify', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [artistId, value, `https://open.spotify.com/artist/${value}`]);
    } catch (e) {
      if (e && e.code === '23505') throw coded('CONFLICT', 'Another artist in the catalogue already has that Spotify id');
      throw e;
    }
  } else if (source === 'musicbrainz') {
    if (value !== null && !(typeof value === 'string' && UUID.test(value))) throw coded('BAD_INPUT', 'That is not a MusicBrainz id');
    await db.query(`UPDATE artists SET musicbrainz_id=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [artistId, value === null ? null : value.toLowerCase()]);
  } else {
    const origin = value === null ? null : normalizeBandcampOrigin(value);
    if (value !== null && !origin) throw coded('BAD_INPUT', 'Paste a https://<name>.bandcamp.com address');
    await db.query(`UPDATE artists SET bandcamp_url=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [artistId, origin]);
  }
  return identityOf(await loadArtist(db, artistId));
}

const CACHE_MS = 5 * 60 * 1000;
const MAX_ADD = 100;
const cache = new Map(); // `${artistId}:${source}:${value}` -> { at, catalogue }
let adding = false;
function _resetForTests() { cache.clear(); adding = false; }

async function readSource(adapter, artistId, source, value, { fresh, now }) {
  const key = `${artistId}:${source}:${value}`;
  const hit = cache.get(key);
  if (!fresh && hit && now() - hit.at < CACHE_MS) return hit.catalogue;
  if (hit) cache.delete(key);
  const catalogue = await adapter.fetchCatalogue(value);
  cache.set(key, { at: now(), catalogue });
  return catalogue;
}

// Internal: the merged + classified songs for a band (full internal shape, incl. Spotify `mapped` tracks).
async function loadMerged(db, artist, { adapters, fresh, now }) {
  const identity = identityOf(artist);
  const active = SOURCES.filter(s => identity[s] && adapters[s]);
  if (active.length === 0) {
    // carries the band so the admin view can open its Identify step with the right name
    throw Object.assign(coded('NO_IDENTITY', 'Identify this band on at least one source first'), { artist: { id: artist.id, name: artist.name, identity } });
  }

  const settled = await Promise.all(active.map(async (source) => {
    try { return { source, catalogue: await readSource(adapters[source], artist.id, source, identity[source], { fresh, now }) }; }
    catch (e) { const err = sourceError(e); return { source, error: { code: err.code, message: err.message } }; }
  }));
  const sources = {};
  for (const r of settled) sources[r.source] = r.error ? { status: 'error', ...r.error } : { status: 'ok', truncated: !!r.catalogue.truncated };

  const songs = mergeCatalogues(settled.filter(r => r.catalogue).map(r => r.catalogue));
  const spotifyIds = songs.flatMap(s => (s.sources.spotify ? s.sources.spotify.ids : []));
  const bandcampOrigin = identity.bandcamp;
  const rows = (await db.query(`
    SELECT s.id, s.title, s.status, s.published, s.spotify_id, s.bandcamp_url,
           EXISTS (SELECT 1 FROM song_artists x WHERE x.song_id = s.id AND x.artist_id = $1) AS by_artist
    FROM songs s
    WHERE s.id IN (SELECT song_id FROM song_artists WHERE artist_id = $1)
       OR s.spotify_id = ANY($2::text[])
       OR ($3::text IS NOT NULL AND s.bandcamp_url ILIKE $3 || '%')`, [artist.id, spotifyIds, bandcampOrigin])).rows;
  return { sources, songs: classify(songs, buildIndex(rows)), artistSongs: rows.filter(r => r.by_artist).length };
}

function toClient(s) {
  const sources = {};
  if (s.sources.spotify) sources.spotify = { url: s.sources.spotify.url };
  if (s.sources.bandcamp) sources.bandcamp = { url: s.sources.bandcamp.url };
  if (s.sources.musicbrainz) sources.musicbrainz = { count: s.sources.musicbrainz.count };
  return { key: s.key, title: s.title, state: s.state, match: s.match, sources, also_on: s.also_on };
}

async function checkBand(db, artistId, { adapters, fresh = false, now = Date.now } = {}) {
  const artist = await loadArtist(db, artistId);
  adapters = adapters || defaultAdapters();
  const { sources, songs, artistSongs } = await loadMerged(db, artist, { adapters, fresh, now });

  // per ok source: how many songs list it, and how many of those are corroborated (on another source, or already held)
  for (const [name, info] of Object.entries(sources)) {
    if (info.status !== 'ok') continue;
    const mine = songs.filter(s => s.sources[name]);
    info.songs = mine.length;
    info.overlap = mine.filter(s => s.state === 'in_catalogue' || Object.keys(s.sources).some(k => k !== name)).length;
  }

  const byRelease = new Map();
  for (const s of songs) {
    const k = `${s.release.source}:${s.release.id}`;
    if (!byRelease.has(k)) byRelease.set(k, { name: s.release.name, album_type: s.release.album_type, release_date: s.release.release_date, source: s.release.source, songs: [] });
    byRelease.get(k).songs.push(toClient(s));
  }
  const releases = [...byRelease.values()].sort((a, b) => (b.release_date || '').localeCompare(a.release_date || '') || a.name.localeCompare(b.name));
  const counts = { new: 0, in_catalogue: 0, rejected: 0, single_source: 0 };
  for (const s of songs) {
    if (s.state === 'new') { counts.new++; if (Object.keys(s.sources).length === 1) counts.single_source++; }
    else if (s.match.status === 'rejected') counts.rejected++;
    else counts.in_catalogue++;
  }
  return { artist: { id: artist.id, name: artist.name, identity: identityOf(artist), songs: artistSongs }, sources, releases, counts };
}

// Adds the songs the curator ticked (keys) and/or saves the ones they rejected (rejectKeys) as `rejected` rows.
// Never trusts client data: only song keys come in, and the catalogue is re-read live.
async function addSelected(db, artistId, keys, { adapters, rejectKeys } = {}) {
  const proc = keys === undefined ? [] : keys;
  const rej = rejectKeys === undefined ? [] : rejectKeys;
  const okList = (l) => Array.isArray(l) && l.every(k => typeof k === 'string' && k);
  if (!okList(proc) || !okList(rej) || proc.length + rej.length < 1 || proc.length + rej.length > MAX_ADD) {
    throw coded('BAD_INPUT', `keys and rejectKeys must hold 1-${MAX_ADD} song keys in total`);
  }
  const procSet = new Set(proc);
  if (rej.some(k => procSet.has(k))) throw coded('BAD_INPUT', 'A song cannot be both processed and rejected');
  if (adding) throw coded('BUSY', 'Another add is in progress');
  adding = true;
  try {
    const artist = await loadArtist(db, artistId);
    adapters = adapters || defaultAdapters();
    const { sources, songs } = await loadMerged(db, artist, { adapters, fresh: true, now: Date.now });
    // a half-read catalogue would send Spotify songs down the manual path: fail before writing anything, so the curator can retry
    const failed = Object.values(sources).find(s => s.status === 'error');
    if (failed) {
      const label = SOURCE_LABELS[Object.keys(sources).find(k => sources[k] === failed)];
      throw coded(failed.code, `${label} could not be read, so nothing was added - retry, or clear that source under Identify sources`);
    }
    const byKey = new Map(songs.map(s => [s.key, s]));
    let skippedExisting = 0, notFound = 0;
    const pick = (list) => {
      const picked = [];
      for (const key of [...new Set(list)]) {
        const s = byKey.get(key);
        if (!s) notFound++;
        else if (s.state !== 'new') skippedExisting++;
        else picked.push(s);
      }
      return picked;
    };
    const toProcess = pick(proc), toReject = pick(rej);

    // Inserts picked songs as pending under `note`; reports the ids it created so a caller can act on exactly those rows.
    const insertPicked = async (picked, note) => {
      let added = 0;
      const spotifyIds = [], songIds = [];
      const withSpotify = picked.filter(s => s.sources.spotify && s.sources.spotify.mapped);
      if (withSpotify.length) {
        const r = await staging.insertCandidates(db, withSpotify.map(s => s.sources.spotify.mapped), { note });
        added += r.added; skippedExisting += r.skippedExisting;
        for (const s of withSpotify) {
          spotifyIds.push(s.sources.spotify.mapped.spotify_id);
          if (s.sources.bandcamp && s.sources.bandcamp.url) {
            // only a song THIS add just created (its note proves it): never touch an existing catalogue song
            await db.query(`UPDATE songs SET bandcamp_url = COALESCE(bandcamp_url, $1) WHERE spotify_id = $2 AND status_notes = $3`,
              [s.sources.bandcamp.url, s.sources.spotify.mapped.spotify_id, note]);
          }
        }
      }
      for (const s of picked.filter(p => !(p.sources.spotify && p.sources.spotify.mapped))) {
        const r = await staging.insertManualCandidate(db, {
          title: s.title, artistId: artist.id, bandcamp_url: (s.sources.bandcamp && s.sources.bandcamp.url) || null, note,
        });
        added += r.added; skippedExisting += r.skippedExisting;
        if (r.song_id) songIds.push(r.song_id);
      }
      return { added, spotifyIds, songIds };
    };

    const processed = await insertPicked(toProcess, `added via band check (${artist.name})`);
    let rejected = 0;
    if (toReject.length) {
      const rejectNote = `rejected via band check (${artist.name})`;
      const made = await insertPicked(toReject, rejectNote);
      // flip ONLY the rows this call just created: still pending, carrying this call's note, and one of the ids it reported
      const upd = await db.query(
        `UPDATE songs SET status='rejected', published=false, published_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE status='pending' AND status_notes=$1 AND (spotify_id = ANY($2::text[]) OR id = ANY($3::int[]))`,
        [rejectNote, made.spotifyIds, made.songIds]);
      rejected = upd.rowCount;
    }
    return { added: processed.added, rejected, skippedExisting, notFound };
  } finally { adding = false; }
}

module.exports = {
  SOURCES, defaultAdapters, listBands, identifyCandidates, saveIdentity, loadArtist, identityOf,
  checkBand, addSelected, _resetForTests,
};
