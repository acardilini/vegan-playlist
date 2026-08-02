// Categorical colours for the map. Values live in CSS (components.css, --explore-cat-*)
// so light/dark theming stays in the token layer; JS only reads them.
//
// Chosen via the `dataviz` skill's validated default categorical palette
// (blue/orange/aqua/yellow/magenta/green/violet/red) — NOT the literal first-N
// slots in that order. Validated at scatter-plot rigor (`--pairs all`, since any
// two categories' dots can be spatially adjacent on the map): blue+yellow+magenta+green
// is one of only two 4-hue subsets of the eight documented hues that clear every
// hard gate in both light and dark. See components.css for the exact values and
// docs/PROJECT_STATE.md / task-5-report.md for the full validator output.
export const NOT_CODED = 'NOT_CODED';

const CAT_VARS = [
  '--explore-cat-1', '--explore-cat-2', '--explore-cat-3',
  '--explore-cat-4', '--explore-cat-5',
];

// Only the first 4 slots are validated (dataviz's --pairs all, both modes — see
// components.css). --explore-cat-5 is a documented-but-unvalidated fallback: no 5-hue
// subset of the palette's 8 documented hues clears every hard gate in both light and
// dark (checked all four candidates for the 5th slot; see task-5-report.md). Rather than
// let it ship silently, colourScale warns the moment a legend actually reaches it.
const VALIDATED_CATS = 4;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Colour lookup for one legend. Entries arrive in legend order; NOT_CODED always takes the
// neutral, never a categorical slot. A group's `children` share the group's colour — that is
// what lets the legend name every genre while the palette stays at its 4 validated slots, and
// it keeps the invariant that every dot's colour is explained by a legend entry on screen.
// `dimensionLabel` is optional and used only to name the dimension in the overflow warning.
export function colourScale(entries, dimensionLabel) {
  const cats = CAT_VARS.map(v => cssVar(v, '#888'));
  const neutral = cssVar('--explore-not-coded', '#8a8a8a');
  const map = new Map();
  let i = 0;
  for (const entry of entries) {
    if (entry.code === NOT_CODED) { map.set(entry.code, neutral); continue; }
    if (i >= VALIDATED_CATS) {
      // Silent-and-visual is the worst failure mode here: a wrong colour looks plausible,
      // not broken. Loud in the console instead — names the dimension and the code so the
      // next person sees it the first time it happens, rather than discovering it by eye.
      console.warn(
        `explore palette: "${dimensionLabel || 'this dimension'}" needs a ${i + 1}th `
        + `categorical colour ("${entry.code}"), past the ${VALIDATED_CATS} validated slots. `
        + 'Group the surplus codes server-side under one parent entry with `children` '
        + "(see genre's Other genres group in backend/services/explore.js) rather than "
        + 'relying on this colour.');
    }
    const colour = cats[i % cats.length];
    map.set(entry.code, colour);
    for (const child of entry.children || []) map.set(child.code, colour);
    i += 1;
  }
  return (code) => map.get(code) || neutral;
}

// Not used until Task 6 (legend spotlight dims the rest of the map) — defined here so the
// colour module owns every colour decision, but not imported by ExploreMap yet: an unused
// import would fail lint at 0-warnings-tolerance.
export function dimColour() {
  return cssVar('--explore-dimmed', 'rgba(140,140,140,0.22)');
}
