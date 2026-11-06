# Explorer upgrade: 3D map, theme colouring, labels, time and neighbours

Status: design for the curator's approval. Date: 2026-11-06. Built in **two rounds** (below).
A separate project, the **artist location map**, follows this one and gets its own design.

## Intent and why

The Explore map (`/explore`) is a hand-rolled 2D canvas scatter of ~640 analysed songs, switchable
between spaces (Message/Thematic, Sound, Holistic; Semantic is hidden) and coloured by genre or an
acoustic dimension. The curator finds it "a little static and flat" and wants it more dynamic and
interesting, with more *dimensionality* to explore, and a way to see the analysis's **themes** on
the map (today colour-by has nothing from the lyrical themes, the richest part of the analysis).

The data is ready: `song_coordinates` already holds 2D **and 3D** UMAP projections in all four spaces
for all 664 rows, and every song carries theme codes grouped into a hierarchy. This is a
presentation and exploration upgrade; it does not change what is in the catalogue or the analysis.

## Goals

Round 1 (build first):
1. A **3D view** of each space (orbit, pan, zoom, depth cues, orientation gizmo, camera presets), beside
   the existing 2D view, with **animated transitions** between 2D and 3D, between spaces, and an
   optional gentle drift.
2. **Colour by Themes**: four new Colour-by entries (Themes, Targets & Species, Actions & Advocacy,
   Moral Frames) that colour songs by *sub-dimension*, with spotlight support.
3. A new **floating toolbar** on the map and a refreshed layout (curator chose layout A).
4. A short **hand-off note** to the curator's separate analysis project about how to get tighter
   clusters (UMAP parameters). Not implemented here.

Round 2 (build after round 1 is smoked):
5. **Cluster labels** floating over regions of the map.
6. **Year scrubber** (with play) along the bottom of the map.
7. **Neighbour lines** from the selected song.
8. **Guided walk** ("Next similar" / Back) through the map.

## Non-goals and anti-goals

- No charting/3D dependency (no Three.js, no WebGL): the map stays hand-rolled 2D canvas with
  perspective-projection maths, like the existing scatter.
- No change to `song_coordinates`, embeddings or any analysis table; the web app stays a read-only
  consumer. The UMAP refit happens in the analysis project, not here.
- No audio playback in the guided walk. No curator-editable cluster labels (deferred). No D-pad (the
  existing +/-/Reset zoom buttons stay).
- The pilot's colours, typography and chrome are **not** adopted: everything uses the site's own tokens
  (`--bg-*`, `--text-*`, `--accent-*`, `--explore-cat-*`).
- Anti-goal: anything that makes the default experience slower or breaks existing shared Explore links
  (`space`, `colour`, `codes`, `q`, `song`, `view` URL params must keep working exactly as today).
- Anti-goal: a song's colour must never be unexplained by the legend on screen (existing invariant).

## Constraints

- Public reads keep the gate `status='included' AND published=true` plus the existing `ELIGIBLE`
  (real lyrics + visible analysis). The map payload stays **one response** so switching view, space,
  colour, spotlight and search costs no further request.
- Palette: 7 validated categorical slots (`--explore-cat-1..7`) plus the neutral not-coded colour; a
  legend must not need an 8th (the existing `colourScale` warns if it does).
- Pure logic (projection, camera interpolation, normalisation, bucket rules, region labelling) lives in
  small DOM-free modules covered by `node --test`, like `mapGeometry.js` / `exploreUrlState.js`.
- `prefers-reduced-motion`: no drift, and tweens/camera moves snap (the existing 2D tween already does).
- Project rules: YAGNI; light-touch to the 650-song dataset (nothing here writes to it); follow the
  Start/End-Session guides; the site is dark-only.

## Round 1 design

### 1. Data (backend, `services/explore.js`)

- **3D discovery.** `discoverSpaces` today matches `*_2d` columns. Extend it to also detect the matching
  `*_3d` column with the same strict identifier pattern, so a space with no 3D data is 2D-only
  (the 3D control is disabled for it). `HIDDEN_SPACES` applies to both dimensions.
- **Payload.** Each song gains `coords3[space] = [x, y, z]`, **normalised per space on the server**
  (done once, pure and tested): centre on the midpoint of the bounding box, divide by
  `R = max(span_x, span_y, span_z) / 2 * 1.15` so the whole cloud lies in [-1, 1]^3 with the same
  scale on all axes (no distortion, ~15% breathing room). Round to 4 decimals to keep the payload
  near today's size (~393KB now). The existing 2D `coords` stay as they are.
- **Theme data per song.** `mapRows` also selects the latest-analysis `themes`, `topics`, `advocacy`
  and `moral_frames` columns (exactly the four columns `analysis.js` already treats as public
  dimensions; the public "Actions & Advocacy" dimension is the `advocacy` column, and `tactics` is
  **not** used, so the map matches the browse sidebar) and maps each code to its sub-dimension through `analysis.js`'s existing
  `SUBDIM` lookup (codebook-gated, like every public read). For each of the four public dimensions the
  payload carries per song: the list of sub-dimension ids the song touches (for spotlight) and one
  **colour bucket** (below). Keys are the public dimension names (`themes`, `targets`, `actions`,
  `moral_frames`).
- **Colour bucket rule** (the curator's decision): the sub-dimension in which the song has the **most
  codes**; if two or more sub-dimensions tie for most, the bucket is `MIXED`; if the song has no codes
  in that dimension, `NOT_CODED`. Codes carry no weights, so "most codes" is the only available
  strength signal.
- **Colour-by entries.** Four new entries added to the Colour-by menu with `source: 'theme'`, legends
  in sub-dimension order from the taxonomy hierarchy: 3-4 sub-dimensions + `Mixed` + `Not coded`
  (<= 6 entries, inside the 7 slots). `Mixed` takes a categorical slot, not the neutral grey (grey
  means Not coded). Legend counts are over the songs on the map. The legend **label** for each is the
  sub-dimension label; the rail note says `Mixed = tied sub-dimensions` (usage help only).
- **Spotlight semantics for themes.** Spotlight state keeps holding raw codes in the `codes=` URL param.
  For a theme colour-by, a code is a sub-dimension id and a song passes the spotlight if **any** of its
  sub-dimensions is lit (so spotlight is inclusive even though colour is single-valued). The `Mixed`
  and `Not coded` entries spotlight on their bucket value. Existing single-valued dimensions behave
  exactly as now.

### 2. The 3D engine (frontend, new pure + hook modules in `components/explore/`)

- **Projection** (pure, `project3d.js`): camera orbit by yaw/pitch rotation matrix; perspective with
  camera distance `d_cam = 4.2 / zoom`, focal length `f = 0.72 * min(W, H)`, so the full normalised
  cloud fits on load with margin and no clipping; `z_cam = r_z + d_cam / zoom` style depth;
  `x_screen = W/2 + r_x * f / z_cam + pan_x`, `y_screen = H/2 - r_y * f / z_cam + pan_y`. (Starting
  values from the pilot; the builder tunes them against the real cloud.) Each projected point returns
  screen `x`, `y`, depth, and a depth factor `d_cam / z_cam` used for dot radius and opacity
  (closer = larger, brighter; farther = smaller, fading toward the dim colour).
- **Draw** back-to-front (painter's algorithm, sorted each frame; 640 points is trivial). Spotlight/search
  dimming, hover halo and the selection ring work as in 2D, using the projected point.
- **Hit-testing** uses the projected screen position; among points within the grab radius the
  **nearest to the camera wins**.
- **Orientation gizmo**: a small axis indicator (+X/+Y/+Z) in the bottom-right of the plot reflecting the
  current camera rotation, drawn in site tokens (not the pilot's red/green/blue).
- **Gestures** (a 3D counterpart of `useMapTransform`, `useOrbitCamera.js`): left-drag orbits, right-drag
  or Shift-drag pans, wheel zooms toward the cursor, same click-vs-drag threshold (4px) and the same
  +/-/Reset buttons. Keyboard: arrow keys orbit when the canvas is focused (builder's call on exact
  keys). The camera commits to the URL once per gesture (debounced), never per frame.
- **Camera presets** (toolbar): Iso (~35deg yaw / 20deg pitch), Top, Front, Side. Click eases the camera
  there (~380ms ease-out; snaps under reduced motion). "Reset" returns to the default view.
- **Drift**: a toggle (default **off**) rotating the cloud slowly about the vertical axis; any
  pointer interaction pauses it; never active under reduced motion; stops when the tab is hidden.
- **Transitions.** Switching 2D <-> 3D and switching space tween each dot from where it is drawn now
  to where it belongs (extends the existing 450ms tween in `ExploreMap.jsx`, which is based on the last
  frame actually drawn). 2D positions map to z = 0 during the 2D side of a transition.
- **Render loop.** Frames are drawn only while something changes (tween, drag, drift, preset move) or
  on state change, not continuously at rest.

### 3. Layout and controls (curator chose "A": floating toolbar on the map)

- A floating, centred pill at the top of the plot: `2D | 3D`, camera presets (visible in 3D only),
  `Drift`, `Labels` (round 2 adds the labels switch; round 1 omits it). The existing top toolbar
  (Space chips, Colour by, search) and right rail (legend, matches, selected card) stay where they are.
  The year strip (round 2) goes along the bottom edge of the plot.
- Narrow screens: the pill wraps/collapses sensibly and stays usable by touch (one-finger orbit, pinch
  zoom if the existing 2D hook supports it, otherwise the +/- buttons).
- **URL state** (extend `exploreUrlState.js`, pure and tested): `dim=2d|3d` (absent = `2d`, so every
  existing link is unchanged) and the 3D camera (`cam=` preset name, or `cam=yaw,pitch,zoom,panx,pany`
  after a free orbit). Invalid values fall back to defaults, as the other params do. **Default view is
  2D** (the curator may choose to flip the default after trying it; it is a one-word change).
- Hover card, selected-song card and search behave as today in both views.

### 4. Hand-off note for the analysis project (documentation only)

A short markdown note (in `docs/`) the curator can give to the analysis project: fit separate UMAPs with
`n_components=2` and `3` for each of the four spaces (not a 2D layout lifted into 3D); `min_dist=0.15`,
`n_neighbors` 25-30 (not `min_dist=0.5`); cosine metric for thematic, semantic and holistic spaces,
standardised features with Euclidean for the 6-D Sound space; and a note that the site normalises the
3D cloud itself, so the pipeline need not. This is the clustering-quality half of the request; the
site shows whatever coordinates it is given.

## Round 2 design

- **Cluster labels (server).** The 2D and 3D layouts are separate UMAP fits, so a 3D region's members
  need not sit together in 2D. Therefore **each view gets its own label set**: per space, run
  deterministic k-means (fixed seed, so labels are stable between loads) separately on the 2D
  coordinates and on the 3D coordinates, ~10-14 regions each, and name each region by what is
  **over-represented** there relative to the whole catalogue (by lift, with a minimum region size and
  a minimum count). Naming by plain most-common value is explicitly rejected (every label would say
  the same top genre). The label has up to two parts: the most over-represented **code** (the specific
  term, e.g. "Factory farming", using the codebook's label, drawn from all four theme dimensions) and
  the most over-represented **parent genre**, e.g. "Factory farming - hardcore". Regions with no
  distinctive value get no label. This is why round 2 adds the per-song **code lists** to the payload
  (round 1 carries only sub-dimension ids). Payload: per space, `labels2d` and `labels3d`, each
  `[{ label, centre, count }]`. Labels are drawn as text anchored at the region centre, fading in with
  zoom, depth-faded in 3D, with a `Labels` toggle in the toolbar (default on). Pure region/labelling
  code is node-tested.
- **Year scrubber.** Uses the existing `year` (release year from the album). A range handle along the
  bottom edge with a play button that sweeps songs in by year. Songs with no release year stay visible
  but faint at all times, with a note such as "38 songs have no release year". State in the URL
  (`yr=from-to` or a single sweep position; builder's call), never required.
- **Neighbour lines.** Selecting a song draws thin lines to its **8 nearest songs in the current map
  space**, computed client-side from the displayed coordinates (2D or 3D), with the same depth fade in
  3D. (Deliberately the map's own geometry, so the lines match what the viewer sees; the song page's
  "You might also like" keeps its embedding-based similarity and is untouched.) A toggle to hide them.
- **Guided walk.** A "Next similar" button on the selected-song card selects the nearest song (current
  space) not yet visited in this walk and eases the camera to it; "Back" retraces the path; the path
  resets on Escape/clear. Navigation aid only, no audio. The visited path is kept in component state,
  not the URL.

## Revision 2026-11-06 (after first look at live data)

On the live data `Mixed` held 311 of 612 songs, so the curator asked for a tie-break. **Superseded rule:** a tie goes to the sub-dimension fewer served songs touch, then taxonomy order; there is no `Mixed` bucket, no `Mixed` legend entry and no Mixed colour slot. Spotlight is unchanged (every song that touches a lit sub-dimension lights). The legend instead carries a usage note: each song is coloured by its strongest sub-dimension, and a pick lights every song that touches it. References to `Mixed` below are historical.

## Settled decisions (curator)

- Order: explorer first, then the artist location map.
- All five ideas are wanted; split into two rounds (3D, motion, Themes colouring first).
- Layout A (floating toolbar plus bottom year strip).
- Colour by Themes uses sub-dimensions; a song is coloured by the sub-dimension with the most of its
  codes, ties are Mixed; spotlight lights every song that touches the chosen sub-dimension.
- The pilot's styling is ignored; our own style guide applies.

## Calls made by the author (not yet the curator's)

- Default view stays 2D so existing links are unchanged.
- Drift is off by default.
- No D-pad; keep the existing +/-/Reset buttons.
- `Mixed` gets a categorical colour slot; grey is reserved for Not coded.
- Neighbours (and the walk) use distance on the map's own coordinates, not the embedding similarity
  (this differs slightly from how it was first described in chat).
- Normalisation of the 3D cloud happens on the server, once.
- Cluster labels are automatic only; no curator editing in v1.
- Cluster labels are computed separately for 2D and 3D, and name regions at the level of the specific
  code plus parent genre (not sub-dimension), which is why round 2 extends the payload.
- Actions & Advocacy colouring uses the `advocacy` column only, matching the browse sidebar.

## Left to the builder

Exact camera maths constants (tuned on the real cloud), key bindings for keyboard orbit, how the
pill collapses on small screens, the URL encoding of the year range, k-means details and the lift
threshold for labels, test file names and fixtures (give each backend test file its own sentinel
prefix), and the internal split between pure modules and hooks.

## Verification expectations

Backend: node:test for the 3D normalisation, the theme bucket rule (single, tie -> Mixed, none ->
Not coded), the new colour-by legend shape (counts, order, <= 7 slots), the payload still gated to
live+eligible songs, and (round 2) region/label determinism. Frontend: node:test for the projection,
camera presets/interpolation, hit-ordering and URL derivations; lint 0 errors; build clean. Smoke: run
backend + frontend, load `/explore`, check 2D unchanged against a pre-change shared link, switch to 3D,
orbit/pan/zoom, each preset, drift, Colour by each theme dimension and spotlight a sub-dimension, switch
space in 3D, reload with the URL and confirm the view restores. The curator smoke steps are written out
in the chat at the end of each round.

## Round 2 revisions (2026-11-06, author's calls, written with the Round 2 plan)

- **No per-song code lists in the payload.** Labels are named on the server from the rows it already holds, so the payload only grows by the label arrays (`spaces[i].labels2d` / `labels3d`, each `{ label, centre, count }`; 2D centres in raw 2D units, 3D centres in the normalised units of `coords3`). This replaces the earlier sentence that round 2 adds code lists to the payload.
- **k-means is deterministic without a seed** (farthest-point start, then Lloyd's iterations), `k = 12`, regions under 15 songs unlabelled; a label is the most over-represented term (any of the four theme columns) plus the most over-represented parent genre, joined by ` · `; duplicate label text keeps the larger region. Thresholds are exported constants tuned once against the live data.
- **Labels that collide are dropped, smaller regions first**, so zooming in reveals more labels; labels are hidden during a tween.
- **Year scrubber is a single cutoff**, `yr=<year>` ("up to this year"), written only while a cutoff is active. Later songs dim like a spotlight miss and are not pickable; songs with no release year draw at half strength while a cutoff is set and stay pickable; with no cutoff nothing changes. **Play** steps one year per ~350ms.
- **Toggles** `Labels` and `Lines` sit in the first toolbar pill (URL `labels=0`, `lines=0`; default on).
- **Guided walk centres the camera only when the next song is near or beyond the edge of the plot** (an unzoomed map already shows everything, so the camera would never need to move); Back retraces; the path resets whenever the selection is not the end of the path.
