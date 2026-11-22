// The Explore > Data payload: every live song with only the fields the charts use, in ONE response
// (the pattern of explore.mapPayload), so filters and charts update client-side with no round trips.
// Read-only. Lyric fields come only through analysis.LATEST_ANALYSIS (junk/stale gates), sound fields only
// through audioAnalysis.LATEST_AUDIO, scalar codes are gated by the codebook. Nothing here may touch lyric
// or transcript text, audio samples, or say where a genre came from.
const analysis = require('./analysis');
const audioAnalysis = require('./audioAnalysis');
const codebook = require('./metadataCodebook');
const genres = require('./genres');
const { getParentGenre } = require('../utils/genreMapping');

const CACHE_MS = 60 * 1000;

function titleCase(s) {
  return String(s).replace(/(^|[ -])([a-z])/g, (m, sep, c) => sep + c.toUpperCase());
}

async function buildDataset(db) {
  const r = await db.query(
    `SELECT s.id,
            s.title,
            (SELECT ARRAY_AGG(a.name ORDER BY sa.id)
               FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
              WHERE sa.song_id = s.id) AS artists,
            EXTRACT(YEAR FROM al.release_date)::int AS year,
            ${genres.EFFECTIVE_GENRE_SUBQUERY} AS catalogue_genre,
            sau.song_id IS NOT NULL AS has_audio,
            sau.inferred_parent_genre AS audio_genre,
            sla.song_id IS NOT NULL AS has_lyric,
            sla.lyrical_tone
       FROM songs s
       LEFT JOIN albums al ON al.id = s.album_id
       LEFT JOIN ${analysis.LATEST_ANALYSIS} sla ON sla.song_id = s.id
       LEFT JOIN ${audioAnalysis.LATEST_AUDIO} sau ON sau.song_id = s.id
      WHERE s.status = 'included' AND s.published = true
      ORDER BY s.id`);

  const toneLabels = {};
  const genreLabels = {};
  const songs = r.rows.map(row => {
    const g = getParentGenre(row.catalogue_genre) || getParentGenre(row.audio_genre) || null;
    const [tone] = codebook.cleanSelection('lyrical_tone', row.lyrical_tone);
    if (g) genreLabels[g] = titleCase(g);
    if (tone) toneLabels[tone] = codebook.codeLabel('lyrical_tone', tone);
    return {
      id: row.id,
      t: row.title,
      a: (row.artists || []).join(', '),
      y: row.year,
      g,
      ha: row.has_audio,
      hl: row.has_lyric,
      tone: tone || null,
    };
  });

  return {
    songs,
    labels: { genres: genreLabels, tone: toneLabels },
    coverage: {
      live: songs.length,
      dated: songs.filter(s => s.y != null).length,
      genre: songs.filter(s => s.g).length,
      audio: songs.filter(s => s.ha).length,
      lyric: songs.filter(s => s.hl).length,
    },
  };
}

let cached = null;
let cachedAt = 0;

async function getDataset(db) {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  cached = await buildDataset(db);
  cachedAt = Date.now();
  return cached;
}

function _clearCache() { cached = null; cachedAt = 0; }

module.exports = { buildDataset, getDataset, _clearCache };
