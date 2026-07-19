// Analysis-service reads over the shared song_lyric_analysis / taxonomy data.
// Display-only: this service never writes analysis and never touches song_lyrics.
// Functions take `db` (pool or client) first, mirroring services/curation.js.
const taxonomy = require('../data/taxonomy.json');

const DEFAULT_MODEL = 'gemma4:latest';
// DB column -> taxonomy group key. topics=targets, advocacy=actions.
const EVIDENCE_DIMS = ['themes', 'topics', 'advocacy', 'tactics', 'moral_frames'];
const DIM_TO_TAXONOMY = { themes: 'themes', topics: 'targets', advocacy: 'actions', tactics: 'tactics', moral_frames: 'moral_frames' };

function titleCase(code) {
  return String(code).split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

// Build id->label maps once per taxonomy group.
const LABELS = {};
for (const [dim, group] of Object.entries(DIM_TO_TAXONOMY)) {
  const list = taxonomy[group] || [];
  LABELS[dim] = new Map(list.map(item => [item.id, item.label]));
}

function label(dimension, code) {
  const m = LABELS[dimension];
  return (m && m.get(code)) || titleCase(code);
}

// Per-DB-column code -> {sub_dimension, group} maps, and sub-dimension label lookup from `hierarchy`.
const SUBDIM = {};
for (const [dbCol, taxKey] of Object.entries(DIM_TO_TAXONOMY)) {
  SUBDIM[dbCol] = new Map((taxonomy[taxKey] || []).map(i => [i.id, { sub_dimension: i.sub_dimension, group: i.group }]));
}

function subDimensionLabel(dbCol, subId) {
  const h = taxonomy.hierarchy && taxonomy.hierarchy[DIM_TO_TAXONOMY[dbCol]];
  return (h && h.sub_dimensions[subId] && h.sub_dimensions[subId].label) || titleCase(subId || '');
}

// Per-DB-column code -> definition map (for chip tooltips).
const DEFS = {};
for (const [dbCol, taxKey] of Object.entries(DIM_TO_TAXONOMY)) {
  DEFS[dbCol] = new Map((taxonomy[taxKey] || []).map(i => [i.id, i.definition || '']));
}

// Scalar category label lookup. Some taxonomy scalar lists are [{id,label}],
// others are plain strings; fall back to Title Case in both misses.
function scalarLabel(listKey, value) {
  if (!value) return null;
  for (const item of (taxonomy[listKey] || [])) {
    if (typeof item === 'string') { if (item === value) return titleCase(value); }
    else if (item && item.id === value) return item.label || titleCase(value);
  }
  return titleCase(value);
}

function mapDim(dimension, arr) {
  return (Array.isArray(arr) ? arr : []).map(row => {
    const sd = SUBDIM[dimension].get(row.code) || {};
    return {
      code: row.code, label: label(dimension, row.code), evidence: row.evidence,
      definition: (DEFS[dimension].get(row.code)) || '',
      sub_dimension: sd.sub_dimension || null,
      sub_dimension_label: sd.sub_dimension ? subDimensionLabel(dimension, sd.sub_dimension) : null,
      group: sd.group || null,
    };
  });
}

async function getSongAnalysis(db, songId) {
  const r = await db.query(
    `SELECT perspective, intensity, clarity, focus_amount, lyrical_tone, target_audience,
            emotions, explanation, themes, topics, advocacy, tactics, moral_frames
     FROM song_lyric_analysis WHERE song_id = $1 AND model_used = $2`,
    [songId, DEFAULT_MODEL]);
  if (r.rows.length === 0) return null;
  const a = r.rows[0];
  const attributes = [
    ['Perspective', scalarLabel('perspectives', a.perspective)],
    ['Tone', scalarLabel('lyrical_tones', a.lyrical_tone)],
    ['Intensity', scalarLabel('intensity_levels', a.intensity)],
    ['Clarity', scalarLabel('clarity_levels', a.clarity)],
    ['Focus', scalarLabel('focus_amounts', a.focus_amount)],
  ].filter(([, v]) => v).map(([label, value]) => ({ label, value }));
  return {
    perspective: a.perspective, intensity: a.intensity, clarity: a.clarity,
    focus_amount: a.focus_amount, lyrical_tone: a.lyrical_tone, target_audience: a.target_audience,
    emotions: a.emotions || [], explanation: a.explanation,
    themes: mapDim('themes', a.themes),
    targets: mapDim('topics', a.topics),
    actions: mapDim('advocacy', a.advocacy),
    tactics: mapDim('tactics', a.tactics),
    moral_frames: mapDim('moral_frames', a.moral_frames),
    attributes,
  };
}

// DB column -> public dimension name used in API output (facetTree, etc.).
const PUBLIC_DIMS = { themes: 'themes', topics: 'targets', advocacy: 'actions', tactics: 'tactics', moral_frames: 'moral_frames' };

async function facetTree(db, constraint = null) {
  const out = {};
  const extraJoin = constraint ? (constraint.joinSql || '') : '';
  const extraWhere = constraint && constraint.where && constraint.where.length
    ? ' AND ' + constraint.where.join(' AND ') : '';
  const extraParams = constraint && constraint.params ? constraint.params : [];
  for (const [col, pub] of Object.entries(PUBLIC_DIMS)) {
    // One query: distinct (song_id, code) pairs over live+coded songs for this dimension.
    // ${col} comes from the controlled PUBLIC_DIMS whitelist — never user input.
    const rows = (await db.query(
      `SELECT DISTINCT s.id AS song_id, elem->>'code' AS code
       FROM songs s${extraJoin}
       JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = $1
       CROSS JOIN LATERAL jsonb_array_elements(sa.${col}) AS elem
       WHERE s.status = 'included' AND s.published = true${extraWhere}`,
      [DEFAULT_MODEL, ...extraParams])).rows;

    // Distinct-song sets at code / group / sub-dimension / dimension level.
    const codeSongs = new Map(), groupSongs = new Map(), subSongs = new Map(), dimSongs = new Set();
    const bump = (m, k, songId) => { let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(songId); };
    for (const { song_id, code } of rows) {
      const sd = SUBDIM[col].get(code);
      if (!sd) continue; // code absent from taxonomy — skip defensively
      bump(codeSongs, code, song_id);
      bump(groupSongs, `${sd.sub_dimension}/${sd.group}`, song_id);
      bump(subSongs, sd.sub_dimension, song_id);
      dimSongs.add(song_id);
    }

    const taxKey = DIM_TO_TAXONOMY[col];
    const codesOf = taxonomy[taxKey] || [];
    const h = taxonomy.hierarchy[taxKey];
    const subDimensions = [];
    for (const [subId, sub] of Object.entries(h.sub_dimensions)) {
      const groups = [];
      for (const [groupId, groupLabel] of Object.entries(sub.groups)) {
        const codes = codesOf
          .filter(i => i.sub_dimension === subId && i.group === groupId)
          .map(i => ({ code: i.id, label: i.label, count: (codeSongs.get(i.id) || new Set()).size }))
          .filter(c => c.count > 0);
        if (codes.length === 0) continue;
        groups.push({ id: groupId, label: groupLabel, count: (groupSongs.get(`${subId}/${groupId}`) || new Set()).size, codes });
      }
      if (groups.length === 0) continue;
      subDimensions.push({ id: subId, label: sub.label, count: (subSongs.get(subId) || new Set()).size, groups });
    }
    out[pub] = { label: h.label, count: dimSongs.size, sub_dimensions: subDimensions };
  }
  return out;
}

const FACET_TO_COLUMN = { themes: 'themes', targets: 'topics', actions: 'advocacy', tactics: 'tactics', moral_frames: 'moral_frames' };

function facetFilterConditions(selections, startIndex) {
  const clauses = [], params = [];
  let idx = startIndex;
  for (const [facet, column] of Object.entries(FACET_TO_COLUMN)) {
    const raw = selections && selections[facet];
    if (!raw) continue;
    const codes = Array.isArray(raw) ? raw : [raw];
    for (const code of codes) {
      if (!code) continue;
      clauses.push(`sa.${column} @> $${idx}::jsonb`);
      params.push(JSON.stringify([{ code }]));
      idx++;
    }
  }
  return { clauses, params, needsJoin: clauses.length > 0 };
}

async function themeCounts(db, limit = 15) {
  const r = await db.query(
    `SELECT elem->>'code' AS theme, COUNT(DISTINCT s.id)::int AS song_count
     FROM songs s
     JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = $1
     CROSS JOIN LATERAL jsonb_array_elements(sa.themes) AS elem
     WHERE s.status = 'included' AND s.published = true
     GROUP BY elem->>'code'
     ORDER BY song_count DESC
     LIMIT $2`,
    [DEFAULT_MODEL, limit]);
  return r.rows.map(row => ({ theme: row.theme, label: label('themes', row.theme), song_count: row.song_count }));
}

module.exports = { DEFAULT_MODEL, EVIDENCE_DIMS, DIM_TO_TAXONOMY, taxonomy, label, getSongAnalysis, subDimensionLabel, SUBDIM, PUBLIC_DIMS, facetTree, facetFilterConditions, themeCounts };
