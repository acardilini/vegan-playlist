// Analysis-service reads over the shared song_lyric_analysis / taxonomy data.
// Display-only: this service never writes analysis and never touches song_lyrics.
// Functions take `db` (pool or client) first, mirroring services/curation.js.
const taxonomy = require('../data/taxonomy.json');
const codebook = require('./metadataCodebook');

// Two display tiers. The code dimensions (+ explanation/evidence) come from the refined
// key-focus coding; the seven scalar metadata components come from the newer, enum-clean
// pass. No song is guaranteed to be in both — getSongAnalysis returns whatever exists.
const CODE_MODEL = 'gemma4:key_focus_pipeline';
const SCALAR_MODEL = 'gemini-3.5-flash-lite';

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
// For inlining into `model_used IN (…)` — "has analysis in either tier".
const ANY_TIER_SQL = [CODE_MODEL, SCALAR_MODEL].map(sqlQuote).join(', ');

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
  // One row per (song_id, model_used) — PK-guaranteed, so both LEFT JOINs are 1:1.
  const r = await db.query(
    `SELECT c.themes, c.topics, c.advocacy, c.tactics, c.moral_frames, c.explanation,
            f.perspective, f.lyrical_tone, f.intensity, f.clarity, f.focus_amount,
            f.target_audience, f.emotions,
            (c.song_id IS NOT NULL) AS has_code,
            (f.song_id IS NOT NULL) AS has_scalar
     FROM (SELECT $1::int AS song_id) x
     LEFT JOIN song_lyric_analysis c ON c.song_id = x.song_id AND c.model_used = $2
     LEFT JOIN song_lyric_analysis f ON f.song_id = x.song_id AND f.model_used = $3`,
    [songId, CODE_MODEL, SCALAR_MODEL]);
  const a = r.rows[0];
  if (!a || (!a.has_code && !a.has_scalar)) return null;

  // Compact attributes card: the six single-valued components. cleanSelection drops null,
  // suppressed AND off-codebook values in one pass — the same gate the filters use, so the
  // page can only ever show a value you could also filter by. That matters: a pipeline re-run
  // has shipped typo'd codes (VISVERAL_HORROR…) and template artifacts (EXACT_ENUM_CODE_KEY)
  // into these columns before, and the label fallback would have rendered them as prose.
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

  // NOTE mixed representation: `emotions` below is display labels (mapped via codebook),
  // while perspective/lyrical_tone/intensity/clarity/focus_amount/target_audience are raw
  // enum codes — the display surface for those is `attributes` above. Intended, but do not
  // assume any of these top-level fields are codes you can match against the codebook.
  return {
    perspective: a.perspective, intensity: a.intensity, clarity: a.clarity,
    focus_amount: a.focus_amount, lyrical_tone: a.lyrical_tone,
    target_audience: a.target_audience,
    emotions, explanation: a.explanation,
    themes: mapDim('themes', a.themes),
    targets: mapDim('topics', a.topics),
    actions: mapDim('advocacy', a.advocacy),
    tactics: mapDim('tactics', a.tactics),
    moral_frames: mapDim('moral_frames', a.moral_frames),
    attributes,
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

// Parameter base: constraint.where/params must be built with startIndex: 2 — this function
// prepends CODE_MODEL as $1 in every per-dimension query, so constraint params start at $2.
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
      [CODE_MODEL, ...extraParams])).rows;

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
// Parameter base: each constraint's where/params must be built with startIndex: 1 — this
// function appends SCALAR_MODEL at $(cParams.length + 1) per component, so constraint
// params start at $1 and the model param comes last, not first.
async function scalarFacets(db, constraints = {}) {
  const out = {};
  for (const c of codebook.COMPONENTS) {
    const cn = constraints[c.key] || {};
    const cParams = cn.params || [];
    const extraJoin = cn.joinSql || '';
    const extraWhere = (cn.where && cn.where.length) ? ' AND ' + cn.where.join(' AND ') : '';
    const modelIdx = cParams.length + 1;
    // c.column comes from the COMPONENTS whitelist — never user input.
    const inner = c.multi
      ? `SELECT DISTINCT s.id AS song_id, e.code AS code
         FROM songs s${extraJoin}
         JOIN song_lyric_analysis scf ON scf.song_id = s.id AND scf.model_used = $${modelIdx}
         CROSS JOIN LATERAL unnest(scf.${c.column}) AS e(code)
         WHERE s.status = 'included' AND s.published = true${extraWhere}`
      : `SELECT DISTINCT s.id AS song_id, scf.${c.column} AS code
         FROM songs s${extraJoin}
         JOIN song_lyric_analysis scf ON scf.song_id = s.id AND scf.model_used = $${modelIdx}
         WHERE s.status = 'included' AND s.published = true${extraWhere}`;
    const rows = (await db.query(
      `SELECT code, COUNT(DISTINCT song_id)::int AS count FROM (${inner}) t
       WHERE code IS NOT NULL GROUP BY code`,
      [...cParams, SCALAR_MODEL])).rows;
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
     JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = $1
     CROSS JOIN LATERAL jsonb_array_elements(sa.themes) AS elem
     WHERE s.status = 'included' AND s.published = true
     GROUP BY elem->>'code'
     ORDER BY song_count DESC
     LIMIT $2`,
    [CODE_MODEL, limit]);
  return r.rows.map(row => ({ theme: row.theme, label: label('themes', row.theme), song_count: row.song_count }));
}

module.exports = { CODE_MODEL, SCALAR_MODEL, ANY_TIER_SQL, EVIDENCE_DIMS, DIM_TO_TAXONOMY,
  taxonomy, label, getSongAnalysis, subDimensionLabel, SUBDIM, PUBLIC_DIMS, facetTree,
  scalarFacets, facetFilterConditions, facetSelectionClauses, themeCounts };
