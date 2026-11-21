// Codebook service over acoustic_codebook.json — the audio vocabulary written by the analysis project's
// listening model (eight dimensions) plus the objective metrics measured by software (tempo, key, loudness).
// Pure: no DB access, no writes. Mirrors services/metadataCodebook.js. The JSON is owned by the analysis
// project and synced into backend/data/ by its tooling; never hand-edit it here.
const codebook = require('../data/acoustic_codebook.json');

const DIMS = codebook.dimensions || {};

// Site headings. The codebook's own `name` for production_texture is "Sound", which would repeat the section
// title "The Sound" on the page, so the site calls it Production (curator decision 2026-11-22). One constant.
const HEADINGS = {
  musical_mood: 'Mood',
  sonic_intensity: 'Intensity',
  production_texture: 'Production',
  dynamic_arc: 'Dynamics',
  vocal_style: 'Vocals',
  rhythmic_feel: 'Rhythm',
  instrumentation: 'Instruments',
  audio_samples: 'Audio samples',
};

// The coded dimensions in the order the song page lists them. `column` doubles as the SQL identifier
// whitelist (user input never reaches an identifier); `multi` follows the codebook's selection_mode.
const ORDER = [
  'musical_mood', 'sonic_intensity', 'production_texture', 'dynamic_arc',
  'vocal_style', 'rhythmic_feel', 'instrumentation',
];
const isMulti = (key) => (DIMS[key] || {}).selection_mode === 'multi_select';

function describe(key) {
  const d = DIMS[key] || {};
  return {
    key, column: key, heading: HEADINGS[key], multi: isMulti(key),
    name: d.name || '', description: d.description || '',
  };
}

const DIMENSIONS = ORDER.map(describe);
const SAMPLES = describe('audio_samples');
// Tempo is an integer measured by software, not a coded dimension: it filters as a range.
const TEMPO = { key: 'tempo_bpm', column: 'tempo_bpm', heading: 'Tempo' };

const FILTER_KEYS = [...ORDER, SAMPLES.key];
const SINGLE_KEYS = ORDER.filter((k) => !isMulti(k));
// Explore colour-by candidates: single-value dimensions whose codes fit the validated 7-colour categorical
// palette (rhythm has 8 codes, so it is not offered; multi-value dimensions such as mood come later).
const PALETTE_SLOTS = 7;
const COLOUR_KEYS = SINGLE_KEYS.filter((k) => (((DIMS[k] || {}).codes) || []).filter((c) => !c.hidden_in_ui).length <= PALETTE_SLOTS);

// key -> Map(code -> codebook entry), built once.
const CODES = {};
for (const key of FILTER_KEYS) {
  CODES[key] = new Map((((DIMS[key] || {}).codes) || []).map((c) => [c.code, c]));
}

function titleCase(code) {
  return String(code).toLowerCase().split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

// The codebook's own name for a whole dimension (e.g. "Sound" for production_texture).
function componentName(key) {
  return (DIMS[key] && DIMS[key].name) || '';
}

function componentDescription(key) {
  return (DIMS[key] && DIMS[key].description) || '';
}

// Display label. Unknown codes title-case rather than vanish: audio display is ungated, the page shows
// whatever the pipeline emitted. (Filters are gated: see cleanSelection.)
function codeLabel(key, code) {
  if (!code) return null;
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.label) || titleCase(code);
}

// Public text: what a listener would read.
function codeDefinition(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.listener_description) || '';
}

// The rule the model was told to apply; shown on the About Reference page only.
function aiDefinition(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.ai_definition) || '';
}

// Filterable options for one dimension, in codebook order. A `hidden_in_ui` code (NONE) is never offered.
function optionsFor(key) {
  return (((DIMS[key] || {}).codes) || [])
    .filter((c) => !c.hidden_in_ui)
    .map((c) => ({ code: c.code, label: c.label }));
}

// Incoming selection -> known, visible codes only. Filters ARE gated even though display is not, so a
// hand-crafted URL cannot select an invented code.
function cleanSelection(key, values) {
  const known = CODES[key];
  if (!known) return [];
  const arr = values == null ? [] : (Array.isArray(values) ? values : [values]);
  return arr.filter((v) => v && known.has(v) && !known.get(v).hidden_in_ui);
}

// One clause per selected dimension: OR within a dimension (any selected code), ANDed across by the caller's
// WHERE accumulation. Multi dimensions are arrays (&&), single ones plain (= ANY). `alias` is the audio join
// alias in the caller's query; audio_samples is additionally gated on the curator's approval on `s`.
function selectionClauses(sel, startIndex, alias = 'sau') {
  const clauses = [];
  const params = [];
  let idx = startIndex;
  for (const key of FILTER_KEYS) {
    const codes = cleanSelection(key, sel[key]);
    if (codes.length === 0) continue;
    if (key === SAMPLES.key) {
      clauses.push(`(${alias}.audio_samples && $${idx}::text[] AND s.show_audio_samples IS TRUE)`);
    } else if (isMulti(key)) {
      clauses.push(`${alias}.${key} && $${idx}::text[]`);
    } else {
      clauses.push(`${alias}.${key} = ANY($${idx}::text[])`);
    }
    params.push(codes);
    idx++;
  }
  return { clauses, params, needsJoin: clauses.length > 0, nextIndex: idx };
}

const METRIC_LABELS = { tempo_bpm: 'Tempo', musical_key: 'Key', loudness_lufs: 'Loudness' };

// The values measured by software rather than judged by the model, for the Reference page.
function objectiveMetrics() {
  const m = codebook.objective_metrics || {};
  return Object.keys(METRIC_LABELS).map((key) => ({
    key,
    label: METRIC_LABELS[key],
    description: (m[key] && m[key].description) || '',
    source: (m[key] && m[key].source) || '',
  }));
}

module.exports = {
  DIMENSIONS, SAMPLES, TEMPO, FILTER_KEYS, SINGLE_KEYS, COLOUR_KEYS,
  componentName, componentDescription, codeLabel, codeDefinition, aiDefinition,
  optionsFor, cleanSelection, selectionClauses, objectiveMetrics,
};
