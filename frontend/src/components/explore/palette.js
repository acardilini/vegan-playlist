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

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Colour lookup for one legend. Codes arrive in legend order; NOT_CODED always takes the
// neutral, never a categorical slot.
export function colourScale(codes) {
  const cats = CAT_VARS.map(v => cssVar(v, '#888'));
  const neutral = cssVar('--explore-not-coded', '#8a8a8a');
  const map = new Map();
  let i = 0;
  for (const code of codes) {
    if (code === NOT_CODED) { map.set(code, neutral); continue; }
    map.set(code, cats[i % cats.length]);
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
