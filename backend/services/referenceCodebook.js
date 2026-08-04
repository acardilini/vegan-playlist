// The About → Reference page's data source: the complete vocabulary the site uses, with
// definitions and live song counts.
//
// This module COMPOSES the existing owners — it never re-reads their JSON. metadataCodebook
// and acousticCodebook stay the single owners of their files, which is what keeps label
// rules and code suppression in one place.
//
// Why this exists rather than reusing analysis.facetTree: facetTree keeps only codes whose
// count is greater than zero and carries no per-term definition. That is right for a filter
// sidebar, where an option matching nothing is noise, and exactly wrong for a glossary —
// where the gap between the taxonomy's size and the coded corpus is itself information.
const analysis = require('./analysis');
const metadata = require('./metadataCodebook');
const acoustic = require('./acousticCodebook');
// Read directly for one field only: the codebook's long `component_name` ("Narrative
// Perspective"), which is distinct from the short UI heading ("Perspective") and for which
// metadataCodebook exposes no getter. Nothing else here reads a JSON file — everything else
// goes through the owning service.
const metadataJson = require('../data/master_metadata_codebook.json');

const taxonomy = analysis.taxonomy;

function componentName(key) {
  return (metadataJson[key] && metadataJson[key].component_name) || '';
}

// DB column -> public dimension name, in the order the page renders them. Mirrors
// analysis.PUBLIC_DIMS; kept local so the render order is explicit here.
const DIMENSIONS = [
  { column: 'themes', key: 'themes' },
  { column: 'topics', key: 'targets' },
  { column: 'advocacy', key: 'actions' },
  { column: 'tactics', key: 'tactics' },
  { column: 'moral_frames', key: 'moral_frames' },
];

// The full vocabulary with every count at 0. Pure — no DB. withCounts() fills the counts in.
function catalogue() {
  return {
    thematic: DIMENSIONS.map(({ column, key }) => {
      const taxKey = analysis.DIM_TO_TAXONOMY[column];
      const h = taxonomy.hierarchy[taxKey];
      const terms = taxonomy[taxKey] || [];
      return {
        key,
        label: h.label,
        description: h.description || '',
        count: 0,
        sub_dimensions: Object.entries(h.sub_dimensions).map(([subId, sub]) => ({
          id: subId,
          label: sub.label,
          count: 0,
          groups: Object.entries(sub.groups).map(([groupId, groupLabel]) => ({
            id: groupId,
            label: groupLabel,
            count: 0,
            // Zero-count terms are KEPT. See the module comment.
            terms: terms
              .filter(t => t.sub_dimension === subId && t.group === groupId)
              .map(t => ({ code: t.id, label: t.label, definition: t.definition || '', count: 0 })),
          })),
        })),
      };
    }),

    metadata: metadata.COMPONENTS.map(c => ({
      key: c.key,
      heading: c.heading,
      name: componentName(c.key),
      description: metadata.componentDescription(c.key),
      // optionsFor() already drops the four suppressed absence codes.
      codes: metadata.optionsFor(c.key).map(o => ({
        code: o.code,
        label: o.label,
        definition: metadata.codeDefinition(c.key, o.code),
        count: 0,
      })),
    })),

    acoustic: [...acoustic.COMPONENTS, acoustic.TEMPO].map(c => ({
      key: c.key,
      heading: c.heading,
      name: acoustic.componentName(c.key),
      description: acoustic.componentDescription(c.key),
      derivation_source: acoustic.derivationSource(c.key),
      // tempo_bpm is an integer range, so it has no codes — an empty array, not a missing key.
      codes: (c.key === acoustic.TEMPO.key ? [] : acoustic.optionsFor(c.key)).map(o => ({
        code: o.code,
        label: o.label,
        definition: acoustic.codeDefinition(c.key, o.code),
        threshold: acoustic.codeThreshold(c.key, o.code),
        count: 0,
      })),
    })),
  };
}

const PUBLISHED = `s.status = 'included' AND s.published = true`;

// (song_id, code) pairs for one thematic dimension's latest pass. `column` comes from the
// DIMENSIONS whitelist — never user input.
async function thematicPairs(db, column) {
  return (await db.query(
    `SELECT DISTINCT s.id AS song_id, elem->>'code' AS code
       FROM songs s
       JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
       CROSS JOIN LATERAL jsonb_array_elements(sa.${column}) AS elem
      WHERE ${PUBLISHED}`)).rows;
}

// (song_id, code) pairs for one scalar column. `multi` columns are TEXT[]; the rest are TEXT.
async function scalarPairs(db, column, multi) {
  const sql = multi
    ? `SELECT DISTINCT s.id AS song_id, e.code AS code
         FROM songs s
         JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
         CROSS JOIN LATERAL unnest(sa.${column}) AS e(code)
        WHERE ${PUBLISHED}`
    : `SELECT DISTINCT s.id AS song_id, sa.${column} AS code
         FROM songs s
         JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
        WHERE ${PUBLISHED} AND sa.${column} IS NOT NULL`;
  return (await db.query(sql)).rows;
}

// Distinct-song counts keyed by code, from (song_id, code) rows.
function countByCode(rows) {
  const m = new Map();
  for (const { song_id, code } of rows) {
    if (!code) continue;
    let s = m.get(code);
    if (!s) { s = new Set(); m.set(code, s); }
    s.add(song_id);
  }
  return m;
}

async function coverage(db) {
  const one = async (sql) => (await db.query(sql)).rows[0].n;

  const live_songs = await one(
    `SELECT COUNT(*)::int AS n FROM songs s WHERE ${PUBLISHED}`);
  const artists = await one(
    `SELECT COUNT(DISTINCT ar.id)::int AS n
       FROM artists ar
       JOIN song_artists sa ON sa.artist_id = ar.id
       JOIN songs s ON s.id = sa.song_id
      WHERE ${PUBLISHED}`);
  const analysed_songs = await one(
    `SELECT COUNT(DISTINCT s.id)::int AS n
       FROM songs s JOIN song_lyric_analysis a ON a.song_id = s.id
      WHERE ${PUBLISHED}`);
  const mapped_songs = await one(
    `SELECT COUNT(DISTINCT s.id)::int AS n
       FROM songs s JOIN song_coordinates c ON c.song_id = s.id
      WHERE ${PUBLISHED}`);

  // Which model produced each live song's LATEST pass. Deliberately computed rather than
  // written into the copy: a hand-typed model name goes stale silently, which is exactly
  // what dating the disclosure was meant to prevent.
  const models = (await db.query(
    `SELECT la.model_used AS model, COUNT(*)::int AS songs, MAX(la.analyzed_at) AS latest
       FROM songs s
       JOIN ${analysis.LATEST_ANALYSIS} la ON la.song_id = s.id
      WHERE ${PUBLISHED}
      GROUP BY la.model_used
      ORDER BY songs DESC, model ASC`)).rows;

  const latest = models.reduce(
    (max, m) => (m.latest && (!max || m.latest > max) ? m.latest : max), null);

  return {
    live_songs, artists, analysed_songs, mapped_songs,
    latest_pass_models: models.map(m => ({ model: m.model, songs: m.songs })),
    latest_pass_at: latest ? new Date(latest).toISOString() : null,
  };
}

// The catalogue with real counts, plus the coverage block. One call serves the whole page.
async function payload(db) {
  const out = catalogue();

  for (const { column, key } of DIMENSIONS) {
    const rows = await thematicPairs(db, column);
    const byCode = countByCode(rows);
    const dim = out.thematic.find(d => d.key === key);
    const dimSongs = new Set();
    for (const sd of dim.sub_dimensions) {
      const subSongs = new Set();
      for (const g of sd.groups) {
        const groupSongs = new Set();
        for (const t of g.terms) {
          const songs = byCode.get(t.code);
          t.count = songs ? songs.size : 0;
          if (songs) for (const id of songs) { groupSongs.add(id); subSongs.add(id); dimSongs.add(id); }
        }
        g.count = groupSongs.size;
      }
      sd.count = subSongs.size;
    }
    dim.count = dimSongs.size;
  }

  for (const c of metadata.COMPONENTS) {
    const byCode = countByCode(await scalarPairs(db, c.column, c.multi));
    for (const code of out.metadata.find(m => m.key === c.key).codes) {
      code.count = (byCode.get(code.code) || new Set()).size;
    }
  }

  for (const c of acoustic.COMPONENTS) {
    const byCode = countByCode(await scalarPairs(db, c.column, false));
    for (const code of out.acoustic.find(a => a.key === c.key).codes) {
      code.count = (byCode.get(code.code) || new Set()).size;
    }
  }

  out.coverage = await coverage(db);
  return out;
}

module.exports = { catalogue, payload, coverage, DIMENSIONS };
