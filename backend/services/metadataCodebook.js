// Codebook service over the curator's master_metadata_codebook.json — the seven scalar
// metadata components of the lyric analysis (perspective … emotions).
// Pure: no DB access, no writes. Mirrors how services/analysis.js owns taxonomy.json.
const codebook = require('../data/master_metadata_codebook.json');

// Absence codes: coding artifacts meaning "nothing found", not findings.
// Hidden from display AND from filters (spec 2026-07-22, curator decision 6).
const SUPPRESSED = new Set([
  'THEMATIC_ABSENCE',   // clarity
  'ABSENCE_OF_FOCUS',   // focus_amount
  'INSUFFICIENT_DATA',  // focus_amount
  'UNSPECIFIED',        // target_audience
]);

// Ordered component list. `column` is the song_lyric_analysis column and doubles as the
// SQL identifier whitelist — user input never reaches an identifier. `heading` is the short
// UI label (not the codebook's long component_name). `multi` = TEXT[] column.
const COMPONENTS = [
  { key: 'perspective',     column: 'perspective',     heading: 'Perspective', multi: false },
  { key: 'lyrical_tone',    column: 'lyrical_tone',    heading: 'Tone',        multi: false },
  { key: 'intensity',       column: 'intensity',       heading: 'Intensity',   multi: false },
  { key: 'clarity',         column: 'clarity',         heading: 'Clarity',     multi: false },
  { key: 'focus_amount',    column: 'focus_amount',    heading: 'Focus',       multi: false },
  { key: 'target_audience', column: 'target_audience', heading: 'Audience',    multi: false },
  { key: 'emotions',        column: 'emotions',        heading: 'Emotions',    multi: true  },
];

const COMPONENT_KEYS = COMPONENTS.map(c => c.key);

function titleCase(code) {
  return String(code).toLowerCase().split('_')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

// key -> Map(code -> codebook entry), built once.
const CODES = {};
for (const c of COMPONENTS) {
  CODES[c.key] = new Map((((codebook[c.key] || {}).codes) || []).map(i => [i.code, i]));
}

function isSuppressed(code) {
  return SUPPRESSED.has(code);
}

// Display label. The codebook's emoji short_tag is deliberately never used (brand voice).
function codeLabel(key, code) {
  if (!code) return null;
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.label) || titleCase(code);
}

// The codebook's one-line description of a whole component (not of an individual code).
function componentDescription(key) {
  return (codebook[key] && codebook[key].description) || '';
}

function codeDefinition(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.definition) || '';
}

// Filterable options for one component, in codebook order, suppressed codes removed.
function optionsFor(key) {
  return (((codebook[key] || {}).codes) || [])
    .filter(i => !SUPPRESSED.has(i.code))
    .map(i => ({ code: i.code, label: i.label }));
}

// Incoming selection -> known, non-suppressed codes only (a hand-crafted URL can't
// select a suppressed or invented code).
function cleanSelection(key, values) {
  const known = CODES[key];
  if (!known) return [];
  const arr = values == null ? [] : (Array.isArray(values) ? values : [values]);
  return arr.filter(v => v && !SUPPRESSED.has(v) && known.has(v));
}

// One clause per selected component: OR within a component (= ANY / && overlap),
// ANDed across components by the caller's WHERE accumulation.
// `alias` is the scalar-tier join alias in the caller's query.
function scalarSelectionClauses(sel, startIndex, alias = 'sca') {
  const clauses = [], params = [];
  let idx = startIndex;
  for (const c of COMPONENTS) {
    const codes = cleanSelection(c.key, sel[c.key]);
    if (codes.length === 0) continue;
    clauses.push(c.multi
      ? `${alias}.${c.column} && $${idx}::text[]`
      : `${alias}.${c.column} = ANY($${idx}::text[])`);
    params.push(codes);
    idx++;
  }
  return { clauses, params, needsJoin: clauses.length > 0, nextIndex: idx };
}

module.exports = {
  COMPONENTS, COMPONENT_KEYS, SUPPRESSED,
  isSuppressed, codeLabel, codeDefinition, componentDescription, optionsFor, cleanSelection,
  scalarSelectionClauses,
};
