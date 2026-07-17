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

function mapDim(dimension, arr) {
  return (Array.isArray(arr) ? arr : []).map(row => {
    const sd = SUBDIM[dimension].get(row.code) || {};
    return {
      code: row.code, label: label(dimension, row.code), evidence: row.evidence,
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
  return {
    perspective: a.perspective, intensity: a.intensity, clarity: a.clarity,
    focus_amount: a.focus_amount, lyrical_tone: a.lyrical_tone, target_audience: a.target_audience,
    emotions: a.emotions || [], explanation: a.explanation,
    themes: mapDim('themes', a.themes),
    targets: mapDim('topics', a.topics),
    actions: mapDim('advocacy', a.advocacy),
    tactics: mapDim('tactics', a.tactics),
    moral_frames: mapDim('moral_frames', a.moral_frames),
  };
}

module.exports = { DEFAULT_MODEL, EVIDENCE_DIMS, DIM_TO_TAXONOMY, taxonomy, label, getSongAnalysis, subDimensionLabel, SUBDIM };
