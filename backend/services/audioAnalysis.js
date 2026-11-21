// Reads over song_audio_analysis — the analysis project's description of how each song sounds (eight coded
// dimensions, a one-sentence sound summary, measured tempo / key / loudness, embedded-sample details).
// READ-ONLY: the web app never writes song_audio_analysis. The one thing the curator decides lives on songs:
// songs.show_audio_samples (NULL = not reviewed = hidden, TRUE = show, FALSE = hidden after review).
// Functions take `db` (pool or client) first, mirroring services/analysis.js.
const acoustic = require('./acousticCodebook');
const { unpackConstraint, countByCode } = require('./facetSql');

// A song's audio = its OK row with the latest analyzed_at. A newer non-OK row (an ERROR retry, say) never hides
// an older OK one because the status filter comes first. Drop-in for `song_audio_analysis` in any JOIN.
const LATEST_AUDIO = `(SELECT DISTINCT ON (song_id) *
   FROM song_audio_analysis
   WHERE audio_status = 'OK'
   ORDER BY song_id, analyzed_at DESC NULLS LAST, model_used DESC)`;

const COLUMNS = new Set([...acoustic.FILTER_KEYS, 'tempo_bpm', 'musical_key']);

// One column of the song's latest OK row as a scalar subquery. `column` is whitelisted (never user input);
// `songExpr` is a SQL expression for the song id in the caller's query.
function audioColumnSql(column, songExpr = 's.id') {
  if (!COLUMNS.has(column)) throw new Error(`audioColumnSql: unknown column ${column}`);
  return `(SELECT x.${column} FROM song_audio_analysis x
            WHERE x.song_id = ${songExpr} AND x.audio_status = 'OK'
            ORDER BY x.analyzed_at DESC NULLS LAST, x.model_used DESC LIMIT 1)`;
}

// The card mood badge: the first-listed mood code of the song's audio row.
const MOOD_SUBQUERY = (songExpr = 's.id') => `(${audioColumnSql('musical_mood', songExpr)})[1]`;

// Turn each row's `mood_code` into `mood` (the codebook label, or null) for the public card payloads.
function attachMood(rows) {
  return rows.map((r) => {
    const { mood_code: code, ...rest } = r;
    return { ...rest, mood: acoustic.codeLabel('musical_mood', code) };
  });
}

// Songs with at least one real (non-NONE) sample whose approval is still undecided: the admin queue.
const SAMPLES_PENDING_SQL = (alias = 's') =>
  `${alias}.show_audio_samples IS NULL AND EXISTS (
     SELECT 1 FROM unnest(${audioColumnSql('audio_samples', `${alias}.id`)}) AS t(c) WHERE t.c <> 'NONE')`;

const asArray = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).filter(Boolean);

function buildSamples(row) {
  const codes = asArray(row.audio_samples).filter((c) => c !== 'NONE');
  if (codes.length === 0) return null;
  const details = Array.isArray(row.sample_details) ? row.sample_details : [];
  return {
    types: codes.map((code) => ({ code, label: acoustic.codeLabel('audio_samples', code) })),
    items: details
      .filter((d) => d && d.type && d.type !== 'NONE')
      .map((d) => ({
        type: d.type,
        label: acoustic.codeLabel('audio_samples', d.type),
        timestamp: d.timestamp || null,
        description: d.description || null,
        transcript: d.transcript_excerpt || null,
        source: d.speaker_or_source || null,
      })),
  };
}

function buildBlock(row, { withSamples }) {
  const rows = [];
  for (const d of acoustic.DIMENSIONS) {
    const values = asArray(row[d.key]).map((code) => ({
      code, label: acoustic.codeLabel(d.key, code), definition: acoustic.codeDefinition(d.key, code),
    }));
    if (values.length) rows.push({ key: d.key, label: d.heading, description: d.description, values });
  }
  return {
    summary: (row.sonic_summary || '').trim() || null,
    rows,
    // The tempo of a beatless track is a median of noise: hide it rather than state it.
    tempo_bpm: row.tempo_bpm != null && row.tempo_stability !== 'UNMETERED' ? row.tempo_bpm : null,
    key: row.musical_key || null,
    samples: withSamples ? buildSamples(row) : null,
  };
}

// The public block for the song page. Sample details are included only when the curator approved them
// (show_audio_samples IS TRUE): the server withholds them, the page never hides them. null = no usable audio.
async function getSongAudio(db, songId) {
  const r = await db.query(
    `SELECT x.*, s.show_audio_samples
       FROM song_audio_analysis x JOIN songs s ON s.id = x.song_id
      WHERE x.song_id = $1 AND x.audio_status = 'OK'
      ORDER BY x.analyzed_at DESC NULLS LAST, x.model_used DESC LIMIT 1`, [songId]);
  const row = r.rows[0];
  if (!row) return null;
  return buildBlock(row, { withSamples: row.show_audio_samples === true });
}

// The curator's view: the same block with samples whatever the gate says, plus the row's status and the decision.
// A song whose only rows failed (UNAVAILABLE / TOO_LONG / ERROR) returns its status and an empty block.
async function getAdminAudio(db, songId) {
  const r = await db.query(
    `SELECT x.*, s.show_audio_samples
       FROM song_audio_analysis x JOIN songs s ON s.id = x.song_id
      WHERE x.song_id = $1
      ORDER BY (x.audio_status = 'OK') DESC, x.analyzed_at DESC NULLS LAST, x.model_used DESC LIMIT 1`, [songId]);
  const row = r.rows[0];
  if (!row) return null;
  const ok = row.audio_status === 'OK';
  const block = ok
    ? buildBlock(row, { withSamples: true })
    : { summary: null, rows: [], tempo_bpm: null, key: null, samples: null };
  return {
    ...block,
    status: row.audio_status,
    model: row.model_used,
    analyzed_at: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
    loudness_lufs: ok ? row.loudness_lufs : null,
    tempo_stability: ok ? row.tempo_stability : null,
    show_audio_samples: row.show_audio_samples,
  };
}

const LIVE = `s.status = 'included' AND s.published = true`;

// Per-dimension option counts for the sidebar's Sound group. Each key's constraint is built with that key
// excluded ({joinSql, where, params}, startIndex 1), so an open group's own selection never shrinks its own
// options. audio_samples counts only songs the curator approved. Codes the codebook hides are never listed.
async function audioFacets(db, constraints = {}) {
  const out = {};
  for (const key of acoustic.FILTER_KEYS) {
    const meta = key === acoustic.SAMPLES.key ? acoustic.SAMPLES : acoustic.DIMENSIONS.find((d) => d.key === key);
    const { joinSql, whereSql, params } = unpackConstraint(constraints[key]);
    const gate = key === acoustic.SAMPLES.key ? ' AND s.show_audio_samples IS TRUE' : '';
    // `key` comes from the codebook's fixed list, never user input.
    const inner = meta.multi
      ? `SELECT DISTINCT s.id AS song_id, e.code AS code
           FROM songs s${joinSql}
           JOIN ${LATEST_AUDIO} acf ON acf.song_id = s.id
           CROSS JOIN LATERAL unnest(acf.${key}) AS e(code)
          WHERE ${LIVE}${gate}${whereSql}`
      : `SELECT DISTINCT s.id AS song_id, acf.${key} AS code
           FROM songs s${joinSql}
           JOIN ${LATEST_AUDIO} acf ON acf.song_id = s.id
          WHERE ${LIVE}${gate}${whereSql}`;
    const counts = await countByCode(db, inner, [...params]);
    out[key] = {
      key,
      heading: meta.heading,
      multi: meta.multi,
      description: meta.description,
      options: acoustic.optionsFor(key).map((o) => ({ ...o, count: counts.get(o.code) || 0 })),
    };
  }
  return out;
}

// Min/max BPM over live songs with audio: feeds the Tempo input placeholders.
async function tempoRange(db) {
  const r = await db.query(
    `SELECT MIN(la.tempo_bpm)::int AS min_bpm, MAX(la.tempo_bpm)::int AS max_bpm
       FROM songs s JOIN ${LATEST_AUDIO} la ON la.song_id = s.id
      WHERE ${LIVE}`);
  return r.rows[0] || { min_bpm: null, max_bpm: null };
}

// How many live songs have a usable audio analysis, and which model(s) produced the rows shown.
async function coverage(db) {
  const models = (await db.query(
    `SELECT la.model_used AS model, COUNT(*)::int AS songs, MAX(la.analyzed_at) AS latest
       FROM songs s JOIN ${LATEST_AUDIO} la ON la.song_id = s.id
      WHERE ${LIVE}
      GROUP BY la.model_used ORDER BY songs DESC, model ASC`)).rows;
  const latest = models.reduce((max, m) => (m.latest && (!max || m.latest > max) ? m.latest : max), null);
  return {
    analysed: models.reduce((n, m) => n + m.songs, 0),
    models: models.map((m) => ({ model: m.model, songs: m.songs })),
    latest: latest ? new Date(latest).toISOString() : null,
  };
}

module.exports = {
  LATEST_AUDIO, audioColumnSql, MOOD_SUBQUERY, attachMood, SAMPLES_PENDING_SQL,
  getSongAudio, getAdminAudio, audioFacets, tempoRange, coverage,
};
