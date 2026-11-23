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

// Songs whose video the audio analysis could not reach: an UNAVAILABLE row, no OK row from any model, a video still on the
// song, and none added after the failed analysis (adding a replacement link is what clears the song; the analysis project
// owns the UNAVAILABLE row and we never write it). A song with no video left belongs to Needs video instead.
const BROKEN_VIDEO_SQL = (alias = 's') =>
  `EXISTS (SELECT 1 FROM song_audio_analysis bv WHERE bv.song_id = ${alias}.id AND bv.audio_status = 'UNAVAILABLE')
   AND NOT EXISTS (SELECT 1 FROM song_audio_analysis ok WHERE ok.song_id = ${alias}.id AND ok.audio_status = 'OK')
   AND EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = ${alias}.id)
   AND NOT EXISTS (
     SELECT 1 FROM youtube_videos nv
     WHERE nv.song_id = ${alias}.id
       AND nv.created_at > (SELECT max(f.analyzed_at) FROM song_audio_analysis f
                            WHERE f.song_id = ${alias}.id AND f.audio_status = 'UNAVAILABLE'))`;

const asArray = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).filter(Boolean);

// ---- the song page's timeline ----

const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;
const toSeconds = (m, s) => parseInt(m, 10) * 60 + parseInt(s, 10);
const NUM_CURVES = ['loudness', 'grit', 'pulse'];

// The analysis' 80-bin timeline, or null. Only version 'v1' is understood; anything malformed (a curve of the wrong
// length or a non-number) is dropped whole rather than half-drawn. Values are clamped to 0..1.
function cleanTimeline(t) {
  if (!t || typeof t !== 'object' || t.version !== 'v1') return null;
  const bins = t.bins;
  const duration = Number(t.duration_sec);
  if (!Number.isInteger(bins) || bins < 2 || !(duration > 0)) return null;
  const out = { version: 'v1', bins, duration_sec: duration, bin_sec: Number.isFinite(Number(t.bin_sec)) && Number(t.bin_sec) > 0 ? Number(t.bin_sec) : duration / bins };
  for (const k of NUM_CURVES) {
    const c = t[k];
    if (!Array.isArray(c) || c.length !== bins || !c.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    out[k] = c.map((v) => Math.min(1, Math.max(0, v)));
  }
  return out;
}

// "M:SS-M:SS: text", "M:SS–M:SS text" or "M:SS text" lines of sonic_evidence -> timed sections. A lone time ends where the
// next section starts (the duration for the last one, open-ended without it). A line with no timestamp stays as an untimed
// note so nothing the analysis said is lost; non-strings and blanks are dropped.
const SECTION_RE = /^(\d+):(\d{2})(?:\s*[-–]\s*(\d+):(\d{2}))?(?::\s*|\s+)(.+)$/;
function parseSections(evidence, durationSec) {
  if (!Array.isArray(evidence)) return [];
  const rows = [];
  for (const line of evidence) {
    if (typeof line !== 'string' || !line.trim()) continue;
    const m = SECTION_RE.exec(line.trim());
    if (!m) { rows.push({ startSec: null, endSec: null, label: null, text: line.trim() }); continue; }
    const startSec = toSeconds(m[1], m[2]);
    rows.push({ startSec, endSec: m[3] != null ? Math.max(startSec, toSeconds(m[3], m[4])) : undefined, text: m[5].trim() });
  }
  const dur = Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : null;
  return rows.map((r, i) => {
    if (r.startSec == null) return r;
    let endSec = r.endSec;
    if (endSec === undefined) {
      const next = rows.slice(i + 1).find((n) => n.startSec != null);
      endSec = next ? Math.max(r.startSec, next.startSec) : (dur != null ? Math.max(r.startSec, dur) : null);
    }
    return { startSec: r.startSec, endSec, label: endSec != null ? `${fmtClock(r.startSec)}–${fmtClock(endSec)}` : fmtClock(r.startSec), text: r.text };
  });
}

// A sample's timestamp ("0:44-1:19", or a lone "2:00") in seconds. A backwards range collapses to its start.
const RANGE_RE = /^\s*(\d+):(\d{2})(?:\s*[-–]\s*(\d+):(\d{2}))?\s*$/;
function parseRange(ts) {
  const m = typeof ts === 'string' ? RANGE_RE.exec(ts) : null;
  if (!m) return { startSec: null, endSec: null };
  const startSec = toSeconds(m[1], m[2]);
  return { startSec, endSec: m[3] != null ? Math.max(startSec, toSeconds(m[3], m[4])) : startSec };
}

// The curator's own source names for a song's samples (web-owned table, migration 023), keyed `${type}|${timestamp}`.
async function loadSampleSources(db, songId) {
  const r = await db.query('SELECT sample_type, timestamp, source FROM song_sample_sources WHERE song_id = $1', [songId]);
  return new Map(r.rows.map((x) => [`${x.sample_type}|${x.timestamp}`, x.source]));
}

// `sources` is the curator's saved map; `admin` adds what only the curator may see (the analysis' guess, orphans).
function buildSamples(row, { sources = new Map(), admin = false } = {}) {
  const codes = asArray(row.audio_samples).filter((c) => c !== 'NONE');
  if (codes.length === 0) return null;
  const details = Array.isArray(row.sample_details) ? row.sample_details : [];
  const matched = new Set();
  const items = details
    .filter((d) => d && d.type && d.type !== 'NONE')
    .map((d) => {
      const key = `${d.type}|${d.timestamp}`;
      const saved = sources.has(key) ? sources.get(key) : null;
      if (saved !== null) matched.add(key);
      // A person or source is named only when the curator saved one, or the analysis was HIGHLY confident who it was;
      // otherwise the name is not in the payload at all (the page says "Unidentified source").
      const source = saved !== null ? saved : (d.identification_confidence === 'HIGH' ? (d.speaker_or_source || null) : null);
      return {
        type: d.type,
        label: acoustic.codeLabel('audio_samples', d.type),
        timestamp: d.timestamp || null,
        ...parseRange(d.timestamp),
        // The analysis' own `description` is served ONLY for a sample with no quote (a sound effect or soundscape, where
        // it is the only thing to show). A quoted sample shows the quote and who said it, never the AI's words about it
        // (curator decision 2026-11-22), so the description is not in the payload at all.
        ...(d.transcript_excerpt ? {} : { description: d.description || null }),
        transcript: d.transcript_excerpt || null,
        source,
        confirmed: saved !== null,
        confidence: d.identification_confidence || null,
        // The analysis' lower-confidence guess is for the curator only; it is never in the public payload.
        ...(admin ? { suggested: source === null ? (d.speaker_or_source || null) : null } : {}),
      };
    });
  return {
    types: codes.map((code) => ({ code, label: acoustic.codeLabel('audio_samples', code) })),
    items,
    ...(admin ? {
      orphans: [...sources.entries()].filter(([k]) => !matched.has(k)).map(([k, source]) => {
        const i = k.indexOf('|');
        return { type: k.slice(0, i), timestamp: k.slice(i + 1), source };
      }),
    } : {}),
  };
}

function buildBlock(row, { withSamples, sources, admin }) {
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
    timeline: cleanTimeline(row.audio_timeline),
    sections: parseSections(row.sonic_evidence, row.audio_timeline && row.audio_timeline.duration_sec),
    samples: withSamples ? buildSamples(row, { sources, admin }) : null,
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
  const withSamples = row.show_audio_samples === true;
  return buildBlock(row, { withSamples, sources: withSamples ? await loadSampleSources(db, songId) : undefined, admin: false });
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
    ? buildBlock(row, { withSamples: true, sources: await loadSampleSources(db, songId), admin: true })
    : { summary: null, rows: [], tempo_bpm: null, key: null, timeline: null, sections: [], samples: null };
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
  LATEST_AUDIO, audioColumnSql, MOOD_SUBQUERY, attachMood, SAMPLES_PENDING_SQL, BROKEN_VIDEO_SQL, parseSections, parseRange, cleanTimeline,
  getSongAudio, getAdminAudio, loadSampleSources, audioFacets, tempoRange, coverage,
};
