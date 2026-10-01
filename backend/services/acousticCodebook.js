// Codebook service over the curator's acoustic_codebook.json — the six acoustic dimensions
// derived from the audio (sonic_energy … tempo_bpm).
// Pure: no DB access, no writes. Mirrors services/metadataCodebook.js.
const codebook = require('../data/acoustic_codebook.json');

// Ordered component list. `column` is the song_lyric_analysis column and doubles as the
// SQL identifier whitelist — user input never reaches an identifier. `heading` is the short
// UI label (not the codebook's long component_name, which wraps in a grid cell).
// tempo_bpm is NOT here: it is an integer, not an enum, and filters as a range (see TEMPO).
const COMPONENTS = [
  { key: 'sonic_energy',   column: 'sonic_energy',   heading: 'Energy' },
  { key: 'emotional_mood', column: 'emotional_mood', heading: 'Mood' },
  { key: 'rhythmic_style', column: 'rhythmic_style', heading: 'Rhythm' },
  { key: 'acoustic_type',  column: 'acoustic_type',  heading: 'Instruments' },
  { key: 'vocal_delivery', column: 'vocal_delivery', heading: 'Vocals' },
];

const TEMPO = { key: 'tempo_bpm', column: 'tempo_bpm', heading: 'Tempo' };

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

// The codebook's long name for a whole component, e.g. "Sonic Energy & Intensity".
function componentName(key) {
  return (codebook[key] && codebook[key].component_name) || '';
}

function componentDescription(key) {
  return (codebook[key] && codebook[key].description) || '';
}

// Display label. Unknown codes title-case rather than vanish: acoustic display is ungated
// (spec 2026-07-26 §4.3) — the page shows whatever the pipeline emitted.
// The codebook's emoji short_tag is deliberately never used (brand voice).
function codeLabel(key, code) {
  if (!code) return null;
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.label) || titleCase(code);
}

function codeDefinition(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.definition) || '';
}

// The Librosa measurement a dimension is derived from. Shown on the About Reference page,
// which is the only surface that discloses how the sound dimensions are produced.
function derivationSource(key) {
  return (codebook[key] && codebook[key].derivation_source) || '';
}

// The numeric cut-off that puts a song in this code (e.g. "Librosa RMS > 0.12").
function codeThreshold(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.threshold) || '';
}

// Filterable options for one component, in codebook order. No suppressed codes exist here.
function optionsFor(key) {
  return (((codebook[key] || {}).codes) || []).map(i => ({ code: i.code, label: i.label }));
}

// Incoming selection -> known codes only. Filters ARE gated even though display is not, so a
// hand-crafted URL cannot select an invented code.
function cleanSelection(key, values) {
  const known = CODES[key];
  if (!known) return [];
  const arr = values == null ? [] : (Array.isArray(values) ? values : [values]);
  return arr.filter(v => v && known.has(v));
}

// One clause per selected component: OR within a component (= ANY), ANDed across by the
// caller's WHERE accumulation. Every acoustic enum column is single-valued — there is no
// multi/array case. `alias` is the latest-analysis join alias in the caller's query.
function acousticSelectionClauses(sel, startIndex, alias = 'sca') {
  const clauses = [], params = [];
  let idx = startIndex;
  for (const c of COMPONENTS) {
    const codes = cleanSelection(c.key, sel[c.key]);
    if (codes.length === 0) continue;
    clauses.push(`${alias}.${c.column} = ANY($${idx}::text[])`);
    params.push(codes);
    idx++;
  }
  return { clauses, params, needsJoin: clauses.length > 0, nextIndex: idx };
}

module.exports = {
  COMPONENTS, COMPONENT_KEYS, TEMPO,
  componentName, componentDescription, codeLabel, codeDefinition,
  optionsFor, cleanSelection, acousticSelectionClauses,
  derivationSource, codeThreshold,
};
