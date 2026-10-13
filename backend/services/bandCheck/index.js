// Band check service: orchestrates the three source adapters, the curator-confirmed band identity, and the
// add path. Takes `db` and (injected) adapters so tests never touch the network. See the sub-project H spec.
const { createSpotifyAdapter } = require('./spotify');
const { createMusicBrainzAdapter } = require('./musicbrainz');
const { createBandcampAdapter, normalizeBandcampOrigin } = require('./bandcamp');
const { defaultFetch } = require('./http');
const { coded } = require('./errors');

const SOURCES = ['spotify', 'bandcamp', 'musicbrainz'];
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

module.exports = { SOURCES, defaultAdapters, listBands, identifyCandidates, saveIdentity, loadArtist, identityOf };
