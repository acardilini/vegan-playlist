// Shared sub-dimension colour palette (dataviz-validated, Okabe-Ito 5).
// Dark-only app. Chips/legend items ALWAYS render a text label (mandatory
// secondary encoding), so CVD sitting in the 6-8 floor band is legal; the
// normal-vision floor and 3:1 contrast on the chip surface both PASS.
// See docs/superpowers/plans/2026-07-18-B2-song-page-analysis.md (Task 2)
// for the validator run. Keep in sync with backend/data/taxonomy.json's
// sub-dimensions on the monthly codebook cadence.
export const CHIP_HUES = ['#56b4e9', '#009e73', '#d55e00', '#cc79a7', '#e69f00'];
const NEUTRAL = '#898781'; // null / unknown sub-dimension

// Each sub-dimension id -> hue, keyed by its index within its parent dimension.
// Hues repeat across dimensions; the dimension heading + per-dimension mini-legend
// disambiguate, so co-visible colours within any one dimension are always distinct.
const SUBDIM_HUE = {
  // themes
  cruelty_suffering: CHIP_HUES[0], commercial_ecological: CHIP_HUES[1],
  psychology_barriers: CHIP_HUES[2], liberation_ethics: CHIP_HUES[3],
  planetary_lifestyle: CHIP_HUES[4],
  // targets
  farmed_domesticated: CHIP_HUES[0], wild_marine: CHIP_HUES[1],
  exploitative_industries: CHIP_HUES[2], systemic_actors: CHIP_HUES[3],
  // actions
  direct_intervention: CHIP_HUES[0], public_advocacy: CHIP_HUES[1],
  personal_practice: CHIP_HUES[2],
  // tactics
  confrontational_tactics: CHIP_HUES[0], public_outreach: CHIP_HUES[1],
  cultural_consumer: CHIP_HUES[2],
  // moral_frames
  rights_justice: CHIP_HUES[0], care_duties: CHIP_HUES[1],
  political_critiques: CHIP_HUES[2], justice_stewardship: CHIP_HUES[3],
};

export function subDimensionColor(subId) {
  return (subId && SUBDIM_HUE[subId]) || NEUTRAL;
}
