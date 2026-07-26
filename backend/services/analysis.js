// Analysis-service reads over the shared song_lyric_analysis / taxonomy data.
// Display-only: this service never writes analysis and never touches song_lyrics.
// Functions take `db` (pool or client) first, mirroring services/curation.js.
const taxonomy = require('../data/taxonomy.json');
const codebook = require('./metadataCodebook');
const acoustic = require('./acousticCodebook');

// The site shows each song's latest analysis pass (see LATEST_ANALYSIS below).

// Exactly one row per song: the newest pass (MAX analyzed_at). Drop-in replacement for
// `song_lyric_analysis` in any JOIN — join on song_id, no model filter. model_used DESC is a
// deterministic tiebreak when two passes share an analyzed_at. This is the ONLY place model
// selection happens; the site always shows a song's latest coding.
const LATEST_ANALYSIS = `(SELECT DISTINCT ON (song_id) *
   FROM song_lyric_analysis
   ORDER BY song_id, analyzed_at DESC NULLS LAST, model_used DESC)`;

// "Has any analysis at all" — any row exists (a latest row therefore exists).
const hasAnalysisExists = (alias) =>
  `EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = ${alias}.id)`;

// "The latest pass carries at least one thematic code" (for the theme-tree caption count).
const hasCodesExists = (alias) =>
  `EXISTS (SELECT 1 FROM ${LATEST_ANALYSIS} la WHERE la.song_id = ${alias}.id AND (
     jsonb_array_length(COALESCE(la.themes,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.topics,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.advocacy,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.tactics,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.moral_frames,'[]'::jsonb)) > 0))`;

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

// Only codebook-known codes reach the page — the same gate facetTree/filters use, so the
// song page and the browse filters never disagree. Drops unknowns, typos and blank codes.
function mapDim(dimension, arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(row => row && row.code && SUBDIM[dimension].has(row.code))
    .map(row => {
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
    `SELECT sla.themes, sla.topics, sla.advocacy, sla.tactics, sla.moral_frames, sla.lyric_summary,
            sla.perspective, sla.lyrical_tone, sla.intensity, sla.clarity, sla.focus_amount,
            sla.target_audience, sla.emotions,
            sla.sonic_energy, sla.emotional_mood, sla.rhythmic_style,
            sla.acoustic_type, sla.vocal_delivery, sla.tempo_bpm
     FROM ${LATEST_ANALYSIS} sla
     WHERE sla.song_id = $1`,
    [songId]);
  const a = r.rows[0];
  if (!a) return null;

  // Compact attributes card: the six single-valued components. cleanSelection drops null,
  // suppressed and off-codebook values — the same gate the filters use, so the page can only
  // ever show a value you could also filter by.
  const attributes = [];
  for (const c of codebook.COMPONENTS) {
    if (c.multi) continue;
    const [v] = codebook.cleanSelection(c.key, a[c.column]);
    if (!v) continue;
    attributes.push({
      label: c.heading,
      value: codebook.codeLabel(c.key, v),
      definition: codebook.codeDefinition(c.key, v),
      component_description: codebook.componentDescription(c.key),
    });
  }
  const emotions = codebook.cleanSelection('emotions', a.emotions)
    .map(e => codebook.codeLabel('emotions', e));

  const dims = {
    themes: mapDim('themes', a.themes),
    targets: mapDim('topics', a.topics),
    actions: mapDim('advocacy', a.advocacy),
    tactics: mapDim('tactics', a.tactics),
    moral_frames: mapDim('moral_frames', a.moral_frames),
  };

  // Acoustic dimensions, derived from the audio. UNGATED by design (spec 2026-07-26 §4.3):
  // whatever the pipeline emits is shown, title-cased when off-codebook. The tooltip carries
  // "<Component name> — <definition>" so the long name stays out of the narrow grid cell.
  const acousticCells = [];
  for (const c of acoustic.COMPONENTS) {
    const v = a[c.column];
    if (!v) continue;
    const def = acoustic.codeDefinition(c.key, v);
    acousticCells.push({
      label: c.heading,
      value: acoustic.codeLabel(c.key, v),
      definition: def
        ? `${acoustic.componentName(c.key)} — ${def}`
        : acoustic.componentDescription(c.key),
    });
  }
  if (a.tempo_bpm != null) {
    acousticCells.push({
      label: acoustic.TEMPO.heading,
      value: `${a.tempo_bpm} BPM`,
      definition: acoustic.componentDescription(acoustic.TEMPO.key),
    });
  }

  // Nothing displayable (e.g. a lyrics-less pass with empty codes and empty scalars) -> null,
  // so the route 404s and the page shows no empty "Lyrical analysis" heading.
  const hasContent = attributes.length > 0 || emotions.length > 0 || acousticCells.length > 0 ||
    Object.values(dims).some(d => d.length > 0) || !!(a.lyric_summary && a.lyric_summary.trim());
  if (!hasContent) return null;

  return {
    perspective: a.perspective, intensity: a.intensity, clarity: a.clarity,
    focus_amount: a.focus_amount, lyrical_tone: a.lyrical_tone,
    target_audience: a.target_audience,
    emotions, summary: a.lyric_summary,
    ...dims,
    attributes,
    acoustic: acousticCells,
    dimension_descriptions: DIM_DESCRIPTIONS,
  };
}

// DB column -> public dimension name used in API output (facetTree, etc.).
const PUBLIC_DIMS = { themes: 'themes', topics: 'targets', advocacy: 'actions', tactics: 'tactics', moral_frames: 'moral_frames' };

// Public dimension name -> the curator's one-line description (taxonomy.json hierarchy).
// Read at call time by getSongAnalysis, which is declared above — safe at module scope.
const DIM_DESCRIPTIONS = Object.fromEntries(
  Object.entries(PUBLIC_DIMS).map(([col, pub]) => {
    const h = (taxonomy.hierarchy || {})[DIM_TO_TAXONOMY[col]] || {};
    return [pub, h.description || ''];
  })
);

// Parameter base: constraint.where/params must be built with startIndex: 1 — this function no
// longer prepends a model param.
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
       JOIN ${LATEST_ANALYSIS} sa ON sa.song_id = s.id
       CROSS JOIN LATERAL jsonb_array_elements(sa.${col}) AS elem
       WHERE s.status = 'included' AND s.published = true${extraWhere}`,
      [...extraParams])).rows;

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
    out[pub] = { label: h.label, description: h.description || '', count: dimSongs.size, sub_dimensions: subDimensions };
  }
  return out;
}

// Per-component option counts for the sidebar. `constraints` is keyed by component:
// { [componentKey]: { joinSql, where: string[], params: any[] } } — each built with that
// component excluded, so a group's own selection never shrinks its own options.
// Lives here (not in metadataCodebook) so that module stays DB-free.
// Parameter base: each constraint's where/params is built with startIndex: 1; no model param
// is appended.
async function scalarFacets(db, constraints = {}) {
  const out = {};
  for (const c of codebook.COMPONENTS) {
    const cn = constraints[c.key] || {};
    const cParams = cn.params || [];
    const extraJoin = cn.joinSql || '';
    const extraWhere = (cn.where && cn.where.length) ? ' AND ' + cn.where.join(' AND ') : '';
    // c.column comes from the COMPONENTS whitelist — never user input.
    const inner = c.multi
      ? `SELECT DISTINCT s.id AS song_id, e.code AS code
         FROM songs s${extraJoin}
         JOIN ${LATEST_ANALYSIS} scf ON scf.song_id = s.id
         CROSS JOIN LATERAL unnest(scf.${c.column}) AS e(code)
         WHERE s.status = 'included' AND s.published = true${extraWhere}`
      : `SELECT DISTINCT s.id AS song_id, scf.${c.column} AS code
         FROM songs s${extraJoin}
         JOIN ${LATEST_ANALYSIS} scf ON scf.song_id = s.id
         WHERE s.status = 'included' AND s.published = true${extraWhere}`;
    const rows = (await db.query(
      `SELECT code, COUNT(DISTINCT song_id)::int AS count FROM (${inner}) t
       WHERE code IS NOT NULL GROUP BY code`,
      [...cParams])).rows;
    const counts = new Map(rows.map(r => [r.code, r.count]));
    out[c.key] = {
      key: c.key,
      heading: c.heading,
      multi: c.multi,
      description: codebook.componentDescription(c.key),
      options: codebook.optionsFor(c.key).map(o => ({ ...o, count: counts.get(o.code) || 0 })),
    };
  }
  return out;
}

// Per-component option counts for the sidebar's Sound group. Mirrors scalarFacets: each
// component's constraint is built with that component excluded, so an open group's own
// selection never shrinks its own options. Tempo is absent by design — a range has no
// options to count; the route serves tempoRange() instead.
// Parameter base: each constraint's where/params is built with startIndex: 1.
async function acousticFacets(db, constraints = {}) {
  const out = {};
  for (const c of acoustic.COMPONENTS) {
    const cn = constraints[c.key] || {};
    const cParams = cn.params || [];
    const extraJoin = cn.joinSql || '';
    const extraWhere = (cn.where && cn.where.length) ? ' AND ' + cn.where.join(' AND ') : '';
    // c.column comes from the COMPONENTS whitelist — never user input.
    const rows = (await db.query(
      `SELECT code, COUNT(DISTINCT song_id)::int AS count FROM (
         SELECT DISTINCT s.id AS song_id, acf.${c.column} AS code
         FROM songs s${extraJoin}
         JOIN ${LATEST_ANALYSIS} acf ON acf.song_id = s.id
         WHERE s.status = 'included' AND s.published = true${extraWhere}
       ) t WHERE code IS NOT NULL GROUP BY code`,
      [...cParams])).rows;
    const counts = new Map(rows.map(r => [r.code, r.count]));
    out[c.key] = {
      key: c.key,
      heading: c.heading,
      description: acoustic.componentDescription(c.key),
      options: acoustic.optionsFor(c.key).map(o => ({ ...o, count: counts.get(o.code) || 0 })),
    };
  }
  return out;
}

// Min/max BPM over live+published songs' latest pass — feeds the range input placeholders,
// the same role year_range plays for the Year inputs.
async function tempoRange(db) {
  const r = await db.query(
    `SELECT MIN(la.tempo_bpm)::int AS min_bpm, MAX(la.tempo_bpm)::int AS max_bpm
     FROM songs s JOIN ${LATEST_ANALYSIS} la ON la.song_id = s.id
     WHERE s.status = 'included' AND s.published = true`);
  return r.rows[0] || { min_bpm: null, max_bpm: null };
}

const FACET_TO_COLUMN = { themes: 'themes', targets: 'topics', actions: 'advocacy', tactics: 'tactics', moral_frames: 'moral_frames' };

// Reverse maps (built once): per facet dimension, group id -> [code ids] and sub-dimension id -> [code ids].
const FACET_GROUP_CODES = {};
const FACET_SUBDIM_CODES = {};
for (const dimKey of Object.keys(FACET_TO_COLUMN)) {
  const list = taxonomy[dimKey] || [];
  const g = new Map(), s = new Map();
  for (const it of list) {
    if (it.group) { if (!g.has(it.group)) g.set(it.group, []); g.get(it.group).push(it.id); }
    if (it.sub_dimension) { if (!s.has(it.sub_dimension)) s.set(it.sub_dimension, []); s.get(it.sub_dimension).push(it.id); }
  }
  FACET_GROUP_CODES[dimKey] = g;
  FACET_SUBDIM_CODES[dimKey] = s;
}

function splitDimId(v) {
  const i = String(v).indexOf(':');
  return i < 0 ? [null, null] : [v.slice(0, i), v.slice(i + 1)];
}

// AND-of-terms builder. codes: exact terms; groups/subdims: OR-over-their-codes terms.
function facetSelectionClauses(sel, startIndex) {
  const clauses = [], params = [];
  let idx = startIndex;
  const asArr = (v) => v == null ? [] : (Array.isArray(v) ? v : [v]);
  const pushTerm = (column, codeList) => {
    const ors = [];
    for (const code of codeList) {
      if (!code) continue;
      ors.push(`sa.${column} @> $${idx}::jsonb`);
      params.push(JSON.stringify([{ code }]));
      idx++;
    }
    if (ors.length === 1) clauses.push(ors[0]);
    else if (ors.length > 1) clauses.push('(' + ors.join(' OR ') + ')');
  };

  // individual code terms (each exact, ANDed)
  for (const [dimKey, column] of Object.entries(FACET_TO_COLUMN)) {
    for (const code of asArr(sel.codes && sel.codes[dimKey])) pushTerm(column, [code]);
  }
  // group terms (each OR over its codes)
  for (const gv of asArr(sel.groups)) {
    const [dimKey, id] = splitDimId(gv);
    const column = FACET_TO_COLUMN[dimKey];
    const codes = column && FACET_GROUP_CODES[dimKey] && FACET_GROUP_CODES[dimKey].get(id);
    if (codes && codes.length) pushTerm(column, codes);
  }
  // sub-dimension terms (each OR over its codes)
  for (const sv of asArr(sel.subdims)) {
    const [dimKey, id] = splitDimId(sv);
    const column = FACET_TO_COLUMN[dimKey];
    const codes = column && FACET_SUBDIM_CODES[dimKey] && FACET_SUBDIM_CODES[dimKey].get(id);
    if (codes && codes.length) pushTerm(column, codes);
  }
  return { clauses, params, needsJoin: clauses.length > 0 };
}

function facetFilterConditions(selections, startIndex) {
  return facetSelectionClauses({ codes: selections }, startIndex);
}

async function themeCounts(db, limit = 15) {
  const r = await db.query(
    `SELECT elem->>'code' AS theme, COUNT(DISTINCT s.id)::int AS song_count
     FROM songs s
     JOIN ${LATEST_ANALYSIS} sa ON sa.song_id = s.id
     CROSS JOIN LATERAL jsonb_array_elements(sa.themes) AS elem
     WHERE s.status = 'included' AND s.published = true
     GROUP BY elem->>'code'
     ORDER BY song_count DESC
     LIMIT $1`,
    [limit]);
  return r.rows.map(row => ({ theme: row.theme, label: label('themes', row.theme), song_count: row.song_count }));
}

module.exports = { LATEST_ANALYSIS, hasAnalysisExists,
  hasCodesExists, EVIDENCE_DIMS, DIM_TO_TAXONOMY,
  taxonomy, label, getSongAnalysis, subDimensionLabel, SUBDIM, PUBLIC_DIMS, facetTree,
  scalarFacets, acousticFacets, tempoRange, facetFilterConditions, facetSelectionClauses, themeCounts };
