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

module.exports = { catalogue, DIMENSIONS };
