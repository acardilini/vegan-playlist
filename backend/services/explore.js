// Explore-service reads over song_coordinates / song_embeddings.
// Read-only: this service never writes. Functions take `db` (pool or client) first,
// mirroring services/analysis.js.
const analysis = require('./analysis');
const genres = require('./genres');
const acoustic = require('./acousticCodebook');
const codebook = require('./metadataCodebook');
const { getParentGenre } = require('../utils/genreMapping');

// Friendly names for the projected spaces. `audio` is shown as "Sound" — the site's word
// for the acoustic dimensions everywhere else. Unknown spaces title-case rather than
// vanish, so a space the pipeline adds appears without a code change.
const SPACE_LABELS = {
  thematic: 'Thematic',
  audio: 'Sound',
  holistic: 'Holistic',
};

// Discovery stays data-driven; this is the one named exception. The curator's smoke
// (2026-08-02) dropped `semantic` from the map — three spaces that mean something beat
// four where one is redundant. Un-hiding it is deleting a word from this set; the label
// needs no entry above because titleCase already yields "Semantic".
const HIDDEN_SPACES = new Set(['semantic']);

function titleCase(key) {
  return String(key).toLowerCase().split('_')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

function spaceLabel(key) {
  return SPACE_LABELS[key] || titleCase(key);
}

// Which 2D coordinate sets exist right now. Column names come from the catalogue, never
// from user input, and are re-checked against a strict pattern before being spliced into
// SQL as identifiers.
const SPACE_COLUMN = /^[a-z][a-z0-9_]*_2d$/;

async function discoverSpaces(db) {
  const r = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'song_coordinates'
      ORDER BY ordinal_position`);
  return r.rows
    .map(x => x.column_name)
    .filter(c => SPACE_COLUMN.test(c))
    .map(c => {
      const key = c.slice(0, -3);
      return { key, column: c, label: spaceLabel(key) };
    })
    .filter(s => !HIDDEN_SPACES.has(s.key));
}

// One row per live, mapped song. Artists come from a scalar subquery rather than an
// aggregate so the statement needs no GROUP BY. Coordinate columns are spliced from the
// discovered (catalogue-sourced, pattern-checked) list.
async function mapRows(db, spaces) {
  const coordCols = spaces.map(s => `sc.${s.column}`).join(',\n           ');
  const r = await db.query(
    `SELECT s.id,
            s.title,
            EXTRACT(YEAR FROM al.release_date)::int AS year,
            al.images->0->>'url' AS art,
            (SELECT ARRAY_AGG(a.name ORDER BY sa.id)
               FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
              WHERE sa.song_id = s.id) AS artists,
            ${genres.EFFECTIVE_GENRE_EXPR} AS genre,
            sla.sonic_energy, sla.emotional_mood, sla.rhythmic_style,
            sla.acoustic_type, sla.vocal_delivery, sla.focus_amount,
            ${coordCols}
       FROM songs s
       JOIN song_coordinates sc ON sc.song_id = s.id
       LEFT JOIN albums al ON al.id = s.album_id
       ${genres.EFFECTIVE_GENRE_JOIN}
       LEFT JOIN ${analysis.LATEST_ANALYSIS} sla ON sla.song_id = s.id
      WHERE s.status = 'included' AND s.published = true
      ORDER BY s.id`);
  return r.rows;
}

// One bucket for every "we have no finding here" case: a null, a missing analysis row, or
// one of the four absence codes. Drawn as neutral grey and always listed last, consistent
// with the 2026-07-22 decision to hide absence codes rather than give them a colour.
const NOT_CODED = 'NOT_CODED';
const NOT_CODED_LABEL = 'Not coded';

// Genre carries far more codes (13 parent genres, live-catalogue count) than the frontend's
// colour palette has slots for (5, one of which is the grey NOT_CODED). Folded to the top-N
// parent genres by count + one "Other genres" catch-all, that's N + 2 legend entries — so
// N=3 is exactly the palette budget (3 named + Other genres + Not coded = 5). Task 4b,
// 2026-07-27 curator decision.
const GENRE_TOP_N = 3;
const OTHER_GENRES = 'OTHER_GENRES';
const OTHER_GENRES_LABEL = 'Other genres';

// The curated, low-cardinality colour-by menu: five acoustic dimensions (3–4 codes each),
// one scalar component, and parent genre. Deliberately NOT all seven scalar components —
// `lyrical_tone` has 16 codes and a legend that long stops being a key.
const COLOUR_DIMENSIONS = [
  ...acoustic.COMPONENTS.map(c => ({ key: c.key, label: c.heading, source: 'acoustic' })),
  { key: 'focus_amount', label: 'Focus', source: 'scalar' },
  { key: 'genre', label: 'Genre', source: 'genre' },
];

const DIMENSION_BY_KEY = Object.fromEntries(COLOUR_DIMENSIONS.map(d => [d.key, d]));

// The colour bucket for one song under one dimension.
function codeFor(dimensionKey, row) {
  const dim = DIMENSION_BY_KEY[dimensionKey];
  if (!dim) return NOT_CODED;
  if (dim.source === 'genre') {
    return getParentGenre(row.genre) || NOT_CODED;
  }
  const v = row[dimensionKey];
  if (!v) return NOT_CODED;
  if (dim.source === 'scalar' && codebook.isSuppressed(v)) return NOT_CODED;
  return v;
}

function labelFor(dim, code) {
  if (code === NOT_CODED) return NOT_CODED_LABEL;
  if (code === OTHER_GENRES) return OTHER_GENRES_LABEL;
  if (dim.source === 'acoustic') return acoustic.codeLabel(dim.key, code);
  if (dim.source === 'scalar') return codebook.codeLabel(dim.key, code);
  return titleCase(code);
}

// Computes the top-N parent genres by count over `rows` (excluding NOT_CODED and the
// literal 'other' parent — rule 1: 'other' already means "unclassified", so it never
// competes for a named slot) and returns a fold function: identity for every dimension
// except genre; for genre, codes in the top N (and NOT_CODED) pass through unchanged, and
// everything else collapses to OTHER_GENRES.
//
// This is the ONE place the fold is computed. `legendFor` and mapPayload's per-song `codes`
// loop both call `genreFold(rows)` on the SAME `rows` array and apply the returned function
// to `codeFor`'s raw output — that is what keeps a song's folded bucket always present in
// its own legend (brief rule 4). Folding inside one consumer but not the other would strand
// some songs in a bucket the legend never lists.
function genreFold(rows) {
  const counts = new Map();
  for (const r of rows) {
    const code = codeFor('genre', r);
    if (code === NOT_CODED || code === 'other') continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const top = new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, GENRE_TOP_N)
      .map(([code]) => code));
  return (dimensionKey, code) => {
    if (dimensionKey !== 'genre') return code;
    if (code === NOT_CODED || top.has(code)) return code;
    return OTHER_GENRES;
  };
}

// Legend entries for one dimension, counted over the songs actually on the map. Codebook
// order first (so the legend reads the way the codebook does), then any observed
// off-codebook code by descending count, then "Not coded" last. Zero-count codes are
// omitted — the legend describes what is on screen.
function legendFor(dim, rows, fold) {
  const counts = new Map();
  for (const r of rows) {
    const code = fold(dim.key, codeFor(dim.key, r));
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const ordered = [];
  const seen = new Set([NOT_CODED, OTHER_GENRES]);
  const known = dim.source === 'acoustic' ? acoustic.optionsFor(dim.key)
    : dim.source === 'scalar' ? codebook.optionsFor(dim.key)
    : [];
  for (const o of known) {
    seen.add(o.code);
    if (counts.has(o.code)) ordered.push({ code: o.code, label: o.label, count: counts.get(o.code) });
  }
  const extras = [...counts.entries()]
    .filter(([code]) => !seen.has(code))
    .sort((a, b) => b[1] - a[1]);
  for (const [code, count] of extras) {
    ordered.push({ code, label: labelFor(dim, code), count });
  }
  // Other genres (genre-only) sorts immediately before Not coded, regardless of its count —
  // rule 3 pins the ordering, not the count, once the fold has already decided membership.
  if (counts.has(OTHER_GENRES)) {
    ordered.push({ code: OTHER_GENRES, label: OTHER_GENRES_LABEL, count: counts.get(OTHER_GENRES) });
  }
  if (counts.has(NOT_CODED)) {
    ordered.push({ code: NOT_CODED, label: NOT_CODED_LABEL, count: counts.get(NOT_CODED) });
  }
  return ordered;
}

// Everything the Explore page needs, in one response: switching space, switching colour-by,
// spotlighting and searching then need no further request, and the selected-song card needs
// no second fetch.
async function mapPayload(db) {
  const spaces = await discoverSpaces(db);
  const rows = await mapRows(db, spaces);
  const live = await db.query(
    `SELECT COUNT(*)::int AS n FROM songs WHERE status = 'included' AND published = true`);
  // Computed once from `rows` and passed to both consumers below — see genreFold's comment
  // for why that single shared computation is what keeps a song's bucket and the legend in
  // sync (brief rule 4).
  const fold = genreFold(rows);

  const songs = rows.map(r => {
    const coords = {};
    for (const s of spaces) coords[s.key] = r[s.column];
    const codes = {};
    for (const d of COLOUR_DIMENSIONS) codes[d.key] = fold(d.key, codeFor(d.key, r));
    return {
      id: r.id,
      title: r.title,
      artist: (r.artists || []).join(', '),
      year: r.year,
      art: r.art,
      coords,
      codes,
    };
  });

  return {
    spaces: spaces.map(s => ({ key: s.key, label: s.label })),
    colourBy: COLOUR_DIMENSIONS.map(d => ({ key: d.key, label: d.label, codes: legendFor(d, rows, fold) })),
    coverage: { mapped: songs.length, live: live.rows[0].n },
    songs,
  };
}

// Similarity metrics are a REGISTRY, not discovery. Coordinates are interchangeable — every
// one is an (x, y) to plot — but each embedding needs a metric and a normalisation
// judgement that code must not guess. Adding a third tab is one entry plus a test.
const SIMILARITY = [
  { key: 'message', label: 'Similar message', column: 'lyric_embedding',
    dims: null, metric: 'cosine' },
  { key: 'sound', label: 'Similar sound', column: 'audio_embedding',
    dims: 6, metric: 'zeuclidean' },
];

// The card fields the song page already renders. LEFT JOIN albums: non-Spotify songs have
// no album row.
const SIMILAR_SELECT = `
  s.id, s.title, s.spotify_url,
  al.name AS album_name, al.images AS album_images,
  (SELECT ARRAY_AGG(a.name ORDER BY sa.id)
     FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
    WHERE sa.song_id = s.id) AS artists`;

// Cosine over the full embedding. Candidates are matched on the TARGET's dimensionality, so
// a mixed-width column can never compare vectors of different lengths.
function cosineSql(entry) {
  return `
    WITH target AS (
      SELECT ${entry.column} AS v FROM song_embeddings WHERE song_id = $1
    ),
    t AS (
      SELECT u.ord, u.val FROM target, unnest(target.v) WITH ORDINALITY AS u(val, ord)
    ),
    cand AS (
      SELECT se.song_id, u.ord, u.val
        FROM song_embeddings se
        JOIN songs s2 ON s2.id = se.song_id
        CROSS JOIN LATERAL unnest(se.${entry.column}) WITH ORDINALITY AS u(val, ord)
       WHERE se.song_id <> $1
         AND s2.status = 'included' AND s2.published = true
         AND array_length(se.${entry.column}, 1)
             = (SELECT array_length(v, 1) FROM target)
    ),
    sim AS (
      SELECT c.song_id,
             SUM(c.val * t.val)
               / NULLIF(sqrt(SUM(c.val * c.val)) * sqrt(SUM(t.val * t.val)), 0) AS score
        FROM cand c JOIN t ON t.ord = c.ord
       GROUP BY c.song_id
    )
    SELECT ${SIMILAR_SELECT}
      FROM sim
      JOIN songs s ON s.id = sim.song_id
      LEFT JOIN albums al ON al.id = s.album_id
     WHERE sim.score IS NOT NULL
     ORDER BY sim.score DESC, s.id
     LIMIT $2`;
}

// Euclidean distance AFTER per-dimension z-scoring over the live set. Without this the
// result is a danceability ranking wearing a disguise: danceability's sd is 0.67 where
// acousticness's is 0.02, a 30x spread (these are Librosa proxies, not Spotify's 0-1
// features). The array_length constraint is not optional — the column still holds 1,041
// rows of the old 1024-dim vectors.
function zEuclideanSql(entry) {
  return `
    WITH live AS (
      SELECT se.song_id, se.${entry.column} AS v
        FROM song_embeddings se
        JOIN songs s2 ON s2.id = se.song_id
       WHERE s2.status = 'included' AND s2.published = true
         AND array_length(se.${entry.column}, 1) = ${entry.dims}
    ),
    stats AS (
      SELECT u.ord, avg(u.val) AS mu, stddev_pop(u.val) AS sd
        FROM live, unnest(live.v) WITH ORDINALITY AS u(val, ord)
       GROUP BY u.ord
    ),
    z AS (
      SELECT l.song_id, u.ord,
             (u.val - st.mu) / NULLIF(st.sd, 0) AS zv
        FROM live l
        CROSS JOIN LATERAL unnest(l.v) WITH ORDINALITY AS u(val, ord)
        JOIN stats st ON st.ord = u.ord
    ),
    tgt AS (SELECT ord, zv FROM z WHERE song_id = $1),
    d AS (
      SELECT z.song_id,
             sqrt(SUM(power(COALESCE(z.zv, 0) - COALESCE(tgt.zv, 0), 2))) AS dist
        FROM z JOIN tgt ON tgt.ord = z.ord
       WHERE z.song_id <> $1
       GROUP BY z.song_id
    )
    SELECT ${SIMILAR_SELECT}
      FROM d
      JOIN songs s ON s.id = d.song_id
      LEFT JOIN albums al ON al.id = s.album_id
     ORDER BY d.dist ASC, s.id
     LIMIT $2`;
}

async function similarByEmbedding(db, songId, entry, limit = 6) {
  if (!entry) return [];
  const sql = entry.metric === 'cosine' ? cosineSql(entry) : zEuclideanSql(entry);
  const r = await db.query(sql, [songId, limit]);
  return r.rows;
}

// The honest fallback for the 692 of 1,333 live songs (52%) with no embeddings. This is the
// old /songs/:id/similar query with its dead audio-feature clause removed (songs.energy is
// NULL catalogue-wide, so that half never matched) and its RANDOM() removed. It uses the
// EFFECTIVE genre — the artist's genre when the song has none — the same expression browse
// uses, which is why its coverage is ~1,003 songs rather than 492.
async function genreFallback(db, songId, limit = 6) {
  const r = await db.query(
    `WITH cs AS (
       SELECT ${genres.EFFECTIVE_GENRE_EXPR} AS g
         FROM songs s ${genres.EFFECTIVE_GENRE_JOIN}
        WHERE s.id = $1
     )
     SELECT ${SIMILAR_SELECT}
       FROM songs s
       ${genres.EFFECTIVE_GENRE_JOIN}
       LEFT JOIN albums al ON al.id = s.album_id
       CROSS JOIN cs
      WHERE s.id <> $1
        AND s.status = 'included' AND s.published = true
        AND cs.g IS NOT NULL
        AND ${genres.EFFECTIVE_GENRE_EXPR} = cs.g
      ORDER BY s.popularity DESC NULLS LAST, s.id
      LIMIT $2`, [songId, limit]);
  return r.rows;
}

// Both tabs and the fallback in one response, so switching tabs needs no request. A tab is
// omitted when its embedding is missing; the fallback fires only when no tab has anything.
async function similarFor(db, songId, limit = 6) {
  const tabs = [];
  for (const entry of SIMILARITY) {
    const songs = await similarByEmbedding(db, songId, entry, limit);
    if (songs.length > 0) tabs.push({ key: entry.key, label: entry.label, songs });
  }
  if (tabs.length > 0) return { tabs, fallback: null };
  const songs = await genreFallback(db, songId, limit);
  return {
    tabs: [],
    fallback: songs.length ? { label: 'More in this genre', songs } : null,
  };
}

module.exports = {
  SPACE_LABELS, spaceLabel, discoverSpaces, mapRows,
  NOT_CODED, COLOUR_DIMENSIONS, codeFor, mapPayload,
  GENRE_TOP_N, OTHER_GENRES, OTHER_GENRES_LABEL, genreFold,
  SIMILARITY, similarByEmbedding, genreFallback, similarFor,
};
