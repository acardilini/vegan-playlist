// Explore-service reads over song_coordinates / song_embeddings.
// Read-only: this service never writes. Functions take `db` (pool or client) first,
// mirroring services/analysis.js.
const analysis = require('./analysis');
const genres = require('./genres');

// Friendly names for the projected spaces. `audio` is shown as "Sound" — the site's word
// for the acoustic dimensions everywhere else. Unknown spaces title-case rather than
// vanish, so a space the pipeline adds appears without a code change.
const SPACE_LABELS = {
  semantic: 'Semantic',
  thematic: 'Thematic',
  audio: 'Sound',
  holistic: 'Holistic',
};

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
    });
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

module.exports = { SPACE_LABELS, spaceLabel, discoverSpaces, mapRows };
