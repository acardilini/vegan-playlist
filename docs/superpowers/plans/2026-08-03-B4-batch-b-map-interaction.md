# B4 Batch B — Explore map interaction layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Explore map zoom and pan with the viewport in the URL, hover growth and a tweened
space switch that respects `prefers-reduced-motion`, and a narrow-width layout whose legend sits above
the plot and whose selected song is a capped bottom sheet.

**Architecture:** Frontend only — no backend file is touched and no query changes. The work starts with
two extractions the B4 final review asked for: every URL derivation moves into a pure
`exploreUrlState.js`, and every coordinate calculation into a pure `mapGeometry.js`. Both are plain ESM
with no React and no DOM, so `node --test` exercises them directly with no test runner installed. On top
of those, a `useMapTransform` hook owns the `{k, tx, ty}` gesture state, and `ExploreMap`'s draw loop
becomes a `requestAnimationFrame` frame function so a space switch can tween.

**Tech Stack:** React 19 + Vite + react-router v7, plain canvas 2D (no charting dependency), CSS custom
properties in `frontend/src/styles/components.css`, `node:test` for the two pure modules, puppeteer
(already in `frontend/node_modules`) for the smoke.

## Global Constraints

- **No new dependency.** No charting library, no test runner, no animation library. `node:test` is
  built into Node 22 and puppeteer is already installed under `frontend/`.
- **Backend is untouched.** `backend/services/explore.js` and every backend test stay exactly as they
  are; the suite must still report **165** passing at the end.
- **Legend swatches keep their text labels** in every layout, including the new narrow one. In dark
  mode the green/yellow pair sits in the `dataviz` validator's WARN band for one form of colour
  blindness, and the text label is the only compensating control. An icon-only or label-optional legend
  is forbidden.
- **The palette stays at four validated categorical slots.** `VALIDATED_CATS` remains `4`; do not add
  `--explore-cat-6` or beyond, and do not introduce a new colour anywhere in this batch.
- **Dot radius is constant under zoom.** Zoom separates clusters; it never inflates dots.
- **Styling uses the design tokens only** (`--bg-*`, `--text-*`, `--accent-*`, `--space-*`,
  `--radius-*`, `--border-hairline`). No raw colour values.
- **Zoom clamps to 1×–12×**, 1× being fit-to-plot. Pan clamps so the plot cannot be dragged off screen.
- **A malformed `view` param falls back to fit** — never to a blank plot. This page's whole contract is
  that the view lives in the URL.
- **Smoke tests run on isolated ports** — backend `:5001`, Vite `:5199`. The curator's `:5000`/`:5173`
  must survive. **Kill by PID only — never `taskkill /F /IM node.exe`.**
- **Commit messages** end with the two trailers used throughout this repo:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and the `Claude-Session:` line. Write them via
  `git commit -F <scratchpad file>`; PowerShell here-strings mangle long messages.
- **Run git and npm from the repo root or the named subdirectory** — `cd` inside a compound PowerShell
  command triggers a permission prompt. Prefer `npm --prefix frontend run lint`.
- **Never rewrite a whole file with a PowerShell read/replace/write** — PS 5.1 double-encodes BOM-less
  UTF-8. Use the Edit tool per hunk.

## Branch

All tasks land on a new branch off `main`:

```bash
git checkout -b session-B4-batch-b
```

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `frontend/src/components/explore/exploreUrlState.js` | **New.** Every URL→state derivation and state→URL write. Pure. | 1, 3 |
| `frontend/src/components/explore/exploreUrlState.test.js` | **New.** `node:test` coverage for the above. | 1, 3 |
| `frontend/src/components/explore/mapGeometry.js` | **New.** Extents, the fit projection, the view transform, clamping, zoom-toward-a-point. Pure. | 2 |
| `frontend/src/components/explore/mapGeometry.test.js` | **New.** `node:test` coverage for the above. | 2 |
| `frontend/src/components/explore/useMapTransform.js` | **New.** `{k,tx,ty}` state, wheel/drag/button gestures, URL commit on gesture end. | 3 |
| `frontend/src/components/explore/ExploreMap.jsx` | Wires all of the above; the rAF draw loop, the space tween, hover growth. | 1–5 |
| `frontend/src/components/explore/SelectedSongCard.jsx` | Unchanged markup; only the rail label around it gains a class. | 5 |
| `frontend/src/styles/components.css` | Zoom controls, `touch-action`, the ≤860px legend row and bottom sheet. | 3, 5 |
| `docs/BATCH_B_CURATOR_SMOKE.md` | **New.** The curator's checklist for this batch. | 6 |

---

### Task 1: Extract `exploreUrlState.js` (no behaviour change)

The B4 final review found three separate defects in URL derivation — an unvalidated `space`, an
unvalidated `colour`, and an empty-but-non-null search set that dimmed all 640 dots — and **all three
lived in this one unextracted block**. Extracting it before adding a fourth param is a carried
instruction from that review, not an optional tidy-up.

**Files:**
- Create: `frontend/src/components/explore/exploreUrlState.js`
- Create: `frontend/src/components/explore/exploreUrlState.test.js`
- Modify: `frontend/src/components/explore/ExploreMap.jsx:87–115` (the derivation block and `setParam`),
  `:159–169` (the Escape handler, which builds params by hand)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Tasks 3–5):
  - `deriveSpace(params: URLSearchParams, spaces: {key}[]) -> string | null`
  - `deriveColour(params, colourBy: {key}[]) -> string | null`
  - `deriveSpotlit(params) -> Set<string>`
  - `deriveQuery(params) -> string`
  - `deriveSelectedId(params) -> number | null`
  - `withParam(params, key: string, value: string | null) -> URLSearchParams`
  - `DEFAULT_COLOUR = 'sonic_energy'`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/explore/exploreUrlState.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COLOUR,
  deriveColour,
  deriveQuery,
  deriveSelectedId,
  deriveSpace,
  deriveSpotlit,
  withParam,
} from './exploreUrlState.js';

// Shapes match what GET /api/analysis/explore/points serves: spaces and colourBy are
// arrays of objects keyed by `key`. Only `key` matters to these functions.
const SPACES = [{ key: 'thematic' }, { key: 'audio' }, { key: 'holistic' }];
const COLOURS = [{ key: 'genre' }, { key: 'sonic_energy' }, { key: 'emotional_mood' }];
const p = (qs) => new URLSearchParams(qs);

test('deriveSpace honours a space the catalogue still serves', () => {
  assert.equal(deriveSpace(p('space=audio'), SPACES), 'audio');
});

test('deriveSpace falls back to the first space for a retired one', () => {
  // `semantic` is in HIDDEN_SPACES since 062b38f. A link shared while it existed must
  // draw the default map, never an empty plot with no chip lit.
  assert.equal(deriveSpace(p('space=semantic'), SPACES), 'thematic');
});

test('deriveSpace falls back when the param is absent or the catalogue is empty', () => {
  assert.equal(deriveSpace(p(''), SPACES), 'thematic');
  assert.equal(deriveSpace(p('space=audio'), []), null);
});

test('deriveColour falls back to sonic_energy, not merely to the first entry', () => {
  // The distinction matters: colourBy[0] is `genre`, so a naive fallback would silently
  // change the default map's colouring whenever a stale link arrives.
  assert.equal(deriveColour(p('colour=nonsense'), COLOURS), DEFAULT_COLOUR);
  assert.equal(deriveColour(p(''), COLOURS), DEFAULT_COLOUR);
  assert.equal(deriveColour(p('colour=genre'), COLOURS), 'genre');
});

test('deriveColour uses the first entry only when sonic_energy is not served', () => {
  assert.equal(deriveColour(p('colour=nope'), [{ key: 'genre' }]), 'genre');
  assert.equal(deriveColour(p(''), []), null);
});

test('deriveSpotlit parses codes and tolerates empty segments', () => {
  assert.deepEqual([...deriveSpotlit(p('codes=metal,,punk'))], ['metal', 'punk']);
  assert.equal(deriveSpotlit(p('')).size, 0);
  assert.equal(deriveSpotlit(p('codes=')).size, 0);
});

test('deriveQuery returns the raw query or an empty string', () => {
  assert.equal(deriveQuery(p('q=milk')), 'milk');
  assert.equal(deriveQuery(p('')), '');
});

test('deriveSelectedId returns null for a non-numeric id', () => {
  // Guards NaN reaching `songs.find(s => s.id === NaN)`, which silently matches nothing.
  assert.equal(deriveSelectedId(p('song=4691')), 4691);
  assert.equal(deriveSelectedId(p('song=abc')), null);
  assert.equal(deriveSelectedId(p('')), null);
});

test('withParam sets one key and leaves its neighbours alone', () => {
  const next = withParam(p('space=audio&q=milk'), 'song', '4691');
  assert.equal(next.get('space'), 'audio');
  assert.equal(next.get('q'), 'milk');
  assert.equal(next.get('song'), '4691');
});

test('withParam deletes the key for a null or empty value', () => {
  assert.equal(withParam(p('song=4691&q=milk'), 'song', null).has('song'), false);
  assert.equal(withParam(p('q=milk'), 'q', '').has('q'), false);
});

test('changing colour drops a spotlight expressed in the old dimension codes', () => {
  const next = withParam(p('colour=genre&codes=metal,punk'), 'colour', 'sonic_energy');
  assert.equal(next.get('colour'), 'sonic_energy');
  assert.equal(next.has('codes'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from the repo root:

```
node --test frontend/src/components/explore/exploreUrlState.test.js
```

Expected: FAIL — `Cannot find module .../exploreUrlState.js`.

- [ ] **Step 3: Write the module**

Create `frontend/src/components/explore/exploreUrlState.js`:

```js
// Every derivation of view state from the URL lives here, and nothing else does.
//
// The B4 final review found three defects in this logic — an unvalidated `space`, an
// unvalidated `colour`, and an empty-but-non-null search set that dimmed all 640 dots — and
// all three lived in the same unextracted block of ExploreMap.jsx. Pure by design: no React,
// no DOM, so `node --test` exercises it directly with no frontend test runner installed.
//
// The rule every `derive*` follows: a value from the URL is honoured only if the catalogue
// still serves it. A shared link must degrade to the default view, never to an empty one.

export const DEFAULT_COLOUR = 'sonic_energy';

export function deriveSpace(params, spaces = []) {
  const requested = params.get('space');
  if (spaces.some(s => s.key === requested)) return requested;
  return (spaces[0] && spaces[0].key) || null;
}

export function deriveColour(params, colourBy = []) {
  const requested = params.get('colour');
  if (colourBy.some(c => c.key === requested)) return requested;
  // Falls back to the named default rather than colourBy[0] — the first entry is `genre`,
  // so a positional fallback would quietly recolour the default map.
  const fallback = colourBy.find(c => c.key === DEFAULT_COLOUR) || colourBy[0];
  return (fallback && fallback.key) || null;
}

export function deriveSpotlit(params) {
  const raw = params.get('codes');
  return new Set(raw ? raw.split(',').filter(Boolean) : []);
}

export function deriveQuery(params) {
  return params.get('q') || '';
}

export function deriveSelectedId(params) {
  const raw = params.get('song');
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

// One writer for every param, so a change never clobbers its neighbours.
export function withParam(params, key, value) {
  const next = new URLSearchParams(params);
  if (value == null || value === '') next.delete(key);
  else next.set(key, String(value));
  // Changing the colour dimension invalidates a spotlight expressed in its codes.
  if (key === 'colour') next.delete('codes');
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
node --test frontend/src/components/explore/exploreUrlState.test.js
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Wire `ExploreMap.jsx` to the module**

Add to the imports at the top of `ExploreMap.jsx`:

```js
import {
  deriveColour, deriveQuery, deriveSelectedId, deriveSpace, deriveSpotlit, withParam,
} from './exploreUrlState';
```

Replace the whole derivation block (currently lines 89–115, from the `// A space from the URL…`
comment through the closing brace of `setParam`) with:

```js
  // Every rule about what the URL may say lives in exploreUrlState.js — see the comment
  // there for why this is not inlined.
  const space = data ? deriveSpace(params, data.spaces) : null;
  const colour = data ? deriveColour(params, data.colourBy) : null;
  const query = deriveQuery(params);
  const selectedId = deriveSelectedId(params);
  const spotlit = useMemo(() => deriveSpotlit(params), [params]);

  const setParam = (key, value) => setParams(withParam(params, key, value), { replace: true });
```

Then replace the body of the Escape handler (currently lines 161–166) so it uses the same writer:

```js
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setParams(withParam(params, 'song', null), { replace: true });
    };
```

- [ ] **Step 6: Verify nothing changed**

```
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: 0 errors (6 pre-existing warnings elsewhere), build clean. This task is a pure extraction —
if any behaviour differs on `/explore`, that is a defect in the extraction, not an improvement.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/explore/exploreUrlState.js frontend/src/components/explore/exploreUrlState.test.js frontend/src/components/explore/ExploreMap.jsx
git commit -F <scratchpad message file>
```

Message subject: `refactor(explore): extract every URL derivation into a tested pure module`

---

### Task 2: Extract `mapGeometry.js` and draw through it (no behaviour change)

The zoom transform and the space tween both need the fit projection as a value they can transform,
rather than as arithmetic buried in the draw loop. Extracting it now keeps Tasks 3 and 4 to their
actual subject.

**Files:**
- Create: `frontend/src/components/explore/mapGeometry.js`
- Create: `frontend/src/components/explore/mapGeometry.test.js`
- Modify: `frontend/src/components/explore/ExploreMap.jsx` — delete `PAD` (line 8) and `extentsFor`
  (lines 61–77); rewrite the draw effect's position loop (lines 184–216) and `onMove` (241–248)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (used by Tasks 3–4):
  - `PAD = 18`, `MIN_K = 1`, `MAX_K = 12`, `FIT_VIEW = { k: 1, tx: 0, ty: 0 }`
  - `extentsFor(songs, spaceKey) -> {minX, maxX, minY, maxY}`
  - `layout(songs, spaceKey, size, view) -> [{ id, song, x, y }]` — screen positions, already
    view-transformed. `size` is `{ w, h }`.
  - `applyView({x, y}, view) -> {x, y}`
  - `clampView(view, size) -> view`
  - `zoomAtPoint(view, nextK, px, py) -> view` (unclamped translate; clamp the result)

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/explore/mapGeometry.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIT_VIEW, MAX_K, PAD,
  applyView, clampView, extentsFor, layout, zoomAtPoint,
} from './mapGeometry.js';

const SIZE = { w: 800, h: 520 };
const songs = (coords) => coords.map(([x, y], i) => ({ id: i + 1, coords: { audio: [x, y] } }));

test('extentsFor spans the real coordinates of one space', () => {
  const e = extentsFor(songs([[0, 0], [4, 10]]), 'audio');
  assert.deepEqual(e, { minX: 0, maxX: 4, minY: 0, maxY: 10 });
});

test('extentsFor pads a degenerate axis so the scale never divides by zero', () => {
  const e = extentsFor(songs([[3, 1], [3, 5]]), 'audio');
  assert.equal(e.minX, 2.5);
  assert.equal(e.maxX, 3.5);
});

test('extentsFor returns a unit box when no song has coordinates in this space', () => {
  assert.deepEqual(extentsFor(songs([[1, 1]]), 'holistic'),
    { minX: 0, maxX: 1, minY: 0, maxY: 1 });
});

test('layout fits the extremes to the padded box and flips y', () => {
  const pts = layout(songs([[0, 0], [4, 10]]), 'audio', SIZE, FIT_VIEW);
  assert.equal(pts.length, 2);
  // Min x sits at the left pad; max x at the right pad.
  assert.equal(Math.round(pts[0].x), PAD);
  assert.equal(Math.round(pts[1].x), SIZE.w - PAD);
  // Canvas y grows downward, so the SMALLEST coordinate is the LOWEST pixel.
  assert.equal(Math.round(pts[0].y), SIZE.h - PAD);
  assert.equal(Math.round(pts[1].y), PAD);
});

test('layout skips songs with no coordinates in the chosen space and carries the song', () => {
  const list = [
    { id: 1, coords: { audio: [0, 0] } },
    { id: 2, coords: {} },
  ];
  const pts = layout(list, 'audio', SIZE, FIT_VIEW);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].id, 1);
  assert.equal(pts[0].song, list[0]);
});

test('applyView scales about the origin then translates', () => {
  assert.deepEqual(applyView({ x: 10, y: 20 }, { k: 2, tx: 5, ty: -3 }), { x: 25, y: 37 });
});

test('zoomAtPoint keeps the content under the cursor under the cursor', () => {
  // The whole point of cursor-anchored zoom: the base position that mapped to screen 100
  // must still map to 100 afterwards.
  const before = { k: 1, tx: 0, ty: 0 };
  const base = 100;
  const after = zoomAtPoint(before, 3, 100, 100);
  assert.equal(base * after.k + after.tx, 100);
  assert.equal(base * after.k + after.ty, 100);
});

test('zoomAtPoint clamps k to the 1x-12x range', () => {
  assert.equal(zoomAtPoint({ k: 1, tx: 0, ty: 0 }, 40, 0, 0).k, MAX_K);
  assert.equal(zoomAtPoint({ k: 4, tx: 0, ty: 0 }, 0.2, 0, 0).k, 1);
});

test('clampView pins the view to fit at 1x', () => {
  // At 1x the content exactly fills the plot, so any translate would show empty space.
  assert.deepEqual(clampView({ k: 1, tx: 300, ty: -80 }, SIZE), FIT_VIEW);
});

test('clampView keeps the plot covered when panned at zoom', () => {
  const size = { w: 800, h: 520 };
  // At 2x the content is 1600 wide, so tx may run from -800 (right edge flush) to 0.
  assert.equal(clampView({ k: 2, tx: 50, ty: 0 }, size).tx, 0);
  assert.equal(clampView({ k: 2, tx: -5000, ty: 0 }, size).tx, -800);
  assert.equal(clampView({ k: 2, tx: -400, ty: -100 }, size).tx, -400);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
node --test frontend/src/components/explore/mapGeometry.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `frontend/src/components/explore/mapGeometry.js`:

```js
// Pure geometry for the map: per-space extents, the fit projection, and the pan/zoom
// transform applied on top of it. No React, no canvas — the draw loop, the gesture hook and
// `node --test` all consume the same functions.

export const PAD = 18;

// 1x is fit-to-plot; 12x is the point past which 640 dots stop being a map and become a few
// dots on an empty field.
export const MIN_K = 1;
export const MAX_K = 12;
export const FIT_VIEW = { k: 1, tx: 0, ty: 0 };

// Each space is projected on its own scale (audio_2d x spans -2.9..12.3 where
// holistic_2d spans -4.7..5.1), so extents are recomputed per space — never assume a
// shared domain.
export function extentsFor(songs, spaceKey) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of songs) {
    const c = s.coords[spaceKey];
    if (!c) continue;
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  return { minX, maxX, minY, maxY };
}

// Screen position = base x k + translate. Keeping this one line separate is what lets the
// gesture maths and the draw loop agree by construction.
export function applyView({ x, y }, view) {
  return { x: x * view.k + view.tx, y: y * view.k + view.ty };
}

export function layout(songs, spaceKey, size, view) {
  const { minX, maxX, minY, maxY } = extentsFor(songs, spaceKey);
  const sx = (size.w - PAD * 2) / (maxX - minX);
  const sy = (size.h - PAD * 2) / (maxY - minY);
  const out = [];
  for (const song of songs) {
    const c = song.coords[spaceKey];
    if (!c) continue;
    const base = {
      x: PAD + (c[0] - minX) * sx,
      // Canvas y grows downward; flip so the plot reads like a chart.
      y: size.h - PAD - (c[1] - minY) * sy,
    };
    const { x, y } = applyView(base, view);
    out.push({ id: song.id, song, x, y });
  }
  return out;
}

// The plot must stay covered: at k the content is size x k, so the translate may run from
// (size - size x k) — the far edge flush — to 0. At k = 1 that collapses to exactly 0, which
// is why 1x is fit and not "zoomed out with slack".
export function clampView(view, size) {
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k));
  const minTx = size.w - size.w * k;
  const minTy = size.h - size.h * k;
  return {
    k,
    tx: Math.min(0, Math.max(minTx, view.tx)),
    ty: Math.min(0, Math.max(minTy, view.ty)),
  };
}

// Zoom toward a screen point: that point must address the same content before and after,
// which fixes the translate once k is chosen. The caller clamps the result against the plot.
export function zoomAtPoint(view, nextK, px, py) {
  const k = Math.min(MAX_K, Math.max(MIN_K, nextK));
  const ratio = k / view.k;
  return { k, tx: px - (px - view.tx) * ratio, ty: py - (py - view.ty) * ratio };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
node --test frontend/src/components/explore/mapGeometry.test.js
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Draw through `layout`**

In `ExploreMap.jsx`: delete the `const PAD = 18;` line and the whole `extentsFor` function (with its
comment), and add to the imports:

```js
import { FIT_VIEW, layout } from './mapGeometry';
```

Replace the position loop inside the draw effect — from `const { minX, maxX, minY, maxY } = …`
through `positionsRef.current = positions;` — with:

```js
    const points = layout(data.songs, space, size, FIT_VIEW);
    const dim = dimColour();
    const lit = [];
    for (const p of points) {
      const passesSpotlight = spotlit.size === 0 || spotlit.has(p.song.codes[colour]);
      const passesSearch = !matchIds || matchIds.has(p.id);
      if (passesSpotlight && passesSearch) lit.push(p);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = dim;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.85;
    for (const p of lit) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = scale(p.song.codes[colour]);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    positionsRef.current = points;
```

The selection ring below it is unchanged — `points` entries still carry `id`, `x` and `y`.

- [ ] **Step 6: Simplify `onMove`, which no longer needs a lookup**

`positionsRef` entries now carry their song, so replace `onMove`:

```js
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const hit = nearest(e.clientX - r.left, e.clientY - r.top);
    setHover(hit ? { song: hit.song, x: hit.x, y: hit.y } : null);
  };
```

- [ ] **Step 7: Verify nothing changed**

```
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: 0 errors, build clean. The map must look and behave exactly as before — this is the second
and last pure extraction.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/explore/mapGeometry.js frontend/src/components/explore/mapGeometry.test.js frontend/src/components/explore/ExploreMap.jsx
git commit -F <scratchpad message file>
```

Message subject: `refactor(explore): extract the map's projection and view maths`

---

### Task 3: Zoom and pan, with the viewport in the URL

**Files:**
- Modify: `frontend/src/components/explore/exploreUrlState.js` (add `deriveView` / `formatView`)
- Modify: `frontend/src/components/explore/exploreUrlState.test.js` (their tests)
- Create: `frontend/src/components/explore/useMapTransform.js`
- Modify: `frontend/src/components/explore/ExploreMap.jsx` (wire the hook, the canvas handlers, the
  zoom buttons, the draw effect's view)
- Modify: `frontend/src/styles/components.css` (`.explore-zoom`, `touch-action` on the canvas)

**Interfaces:**
- Consumes: Task 1's `withParam`; Task 2's `FIT_VIEW`, `MIN_K`, `MAX_K`, `clampView`, `zoomAtPoint`,
  `layout`.
- Produces (used by Task 4):
  - `deriveView(params) -> {k, tx, ty}` — `FIT_VIEW` for absent or malformed input.
  - `formatView(view) -> string` — `''` at fit, so the param is deleted rather than written as `1,0,0`.
  - `useMapTransform({ size, params, onCommit }) -> { view, isDragging, didDrag, onPointerDown,
    onPointerMove, onPointerUp, zoomIn, zoomOut, reset, attachWheel }`
    - `onPointerMove(e) -> boolean` — `true` when the event was consumed by a pan, so the caller
      skips hover work.
    - `didDrag() -> boolean` — `true` if the gesture that just ended moved past the threshold.
    - `attachWheel(canvasEl)` — registers a **non-passive** wheel listener; returns a cleanup fn.

- [ ] **Step 1: Write the failing tests for the two URL functions**

Append to `frontend/src/components/explore/exploreUrlState.test.js` (and extend the import at the top
of that file with `deriveView, formatView`):

```js
test('deriveView reads a well-formed viewport', () => {
  assert.deepEqual(deriveView(p('view=2.5,-120,-64')), { k: 2.5, tx: -120, ty: -64 });
});

test('deriveView falls back to fit for anything malformed', () => {
  // A stale or hand-edited link must draw the default map, never a blank one.
  for (const qs of ['', 'view=', 'view=abc', 'view=2,3', 'view=2,3,4,5', 'view=NaN,0,0']) {
    assert.deepEqual(deriveView(p(qs)), { k: 1, tx: 0, ty: 0 }, qs);
  }
});

test('deriveView falls back to fit for an out-of-range zoom', () => {
  assert.deepEqual(deriveView(p('view=0.2,0,0')), { k: 1, tx: 0, ty: 0 });
  assert.deepEqual(deriveView(p('view=99,0,0')), { k: 1, tx: 0, ty: 0 });
});

test('formatView rounds, and writes nothing at fit', () => {
  assert.equal(formatView({ k: 1, tx: 0, ty: 0 }), '');
  assert.equal(formatView({ k: 2.4567, tx: -120.7, ty: -64.2 }), '2.46,-121,-64');
});

test('a formatted view round-trips back through deriveView', () => {
  const v = { k: 3.25, tx: -240, ty: -96 };
  assert.deepEqual(deriveView(p(`view=${formatView(v)}`)), v);
});
```

- [ ] **Step 2: Run to verify they fail**

```
node --test frontend/src/components/explore/exploreUrlState.test.js
```

Expected: FAIL — `deriveView is not a function`.

- [ ] **Step 3: Add the two functions**

At the top of `exploreUrlState.js`, add the import:

```js
import { FIT_VIEW, MAX_K, MIN_K } from './mapGeometry';
```

And append:

```js
// The viewport travels as one `view=k,tx,ty` param. Anything unparseable falls back to fit
// rather than to a blank plot — the same guard `space` and `colour` carry, and for the same
// reason: this page's whole contract is that the view lives in the URL.
export function deriveView(params) {
  const raw = params.get('view');
  if (!raw) return FIT_VIEW;
  const parts = raw.split(',');
  if (parts.length !== 3) return FIT_VIEW;
  const [k, tx, ty] = parts.map(Number);
  if (![k, tx, ty].every(Number.isFinite)) return FIT_VIEW;
  if (k < MIN_K || k > MAX_K) return FIT_VIEW;
  return { k, tx, ty };
}

// Fit serialises to the empty string so the param is deleted, not written as `1,0,0` — an
// unzoomed map should share as a clean URL. Translates round to whole pixels; nobody can see
// a hundredth of one, and it keeps shared links short.
export function formatView(view) {
  if (view.k <= MIN_K) return '';
  return `${Math.round(view.k * 100) / 100},${Math.round(view.tx)},${Math.round(view.ty)}`;
}
```

- [ ] **Step 4: Run to verify they pass**

```
node --test frontend/src/components/explore/exploreUrlState.test.js
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Write the gesture hook**

Create `frontend/src/components/explore/useMapTransform.js`:

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { FIT_VIEW, clampView, zoomAtPoint } from './mapGeometry';
import { deriveView, formatView } from './exploreUrlState';

// Below this a pointer-up is a click, not a pan — without it every attempt to drag the map
// would also select whichever song happened to be under the press.
const DRAG_THRESHOLD = 4;
// One press of + or −.
const ZOOM_STEP = 1.5;
// A wheel gesture has no end event, so the URL write is debounced instead of fired per notch.
const WHEEL_SETTLE_MS = 300;

export function useMapTransform({ size, params, onCommit }) {
  const urlView = params.get('view') || '';
  const [view, setView] = useState(() => deriveView(params));
  const [isDragging, setIsDragging] = useState(false);

  // What we last wrote to the URL. Compared against the URL on every render so an external
  // change (a pasted link, the Back button) resyncs while our own writes do not loop.
  const committedRef = useRef(urlView);
  const viewRef = useRef(view);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const wheelTimerRef = useRef(null);
  const sizeRef = useRef(size);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { sizeRef.current = size; }, [size]);

  useEffect(() => {
    if (urlView === committedRef.current) return;
    committedRef.current = urlView;
    setView(deriveView(new URLSearchParams(`view=${urlView}`)));
  }, [urlView]);

  // A view saved on a wide screen can be out of bounds on a narrow one, so re-clamp whenever
  // the plot is resized. The identity check is load-bearing, not a micro-optimisation:
  // ResizeObserver hands back a fresh `size` object on every observation and clampView always
  // returns a fresh view, so returning it unconditionally would re-render on every
  // observation — a render loop with a redraw inside it.
  useEffect(() => {
    setView(v => {
      const next = clampView(v, size);
      return (next.k === v.k && next.tx === v.tx && next.ty === v.ty) ? v : next;
    });
  }, [size]);

  const commit = useCallback((next) => {
    const serialised = formatView(next);
    committedRef.current = serialised;
    onCommit(serialised);
  }, [onCommit]);

  const zoomBy = useCallback((factor) => {
    const current = viewRef.current;
    const s = sizeRef.current;
    // Buttons zoom about the middle of the plot: there is no cursor to anchor to.
    const next = clampView(
      zoomAtPoint(current, current.k * factor, s.w / 2, s.h / 2), s);
    setView(next);
    commit(next);
  }, [commit]);

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);

  const reset = useCallback(() => {
    setView(FIT_VIEW);
    commit(FIT_VIEW);
  }, [commit]);

  // React attaches `wheel` at the root as a passive listener, so preventDefault() inside an
  // onWheel prop is ignored and the page scrolls instead of the map zooming. The listener has
  // to be registered directly, non-passive. Trackpad pinch arrives here as a ctrl-wheel and
  // works for free.
  const attachWheel = useCallback((el) => {
    if (!el) return undefined;
    const handler = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.002);
      setView(v => clampView(
        zoomAtPoint(v, v.k * factor, px, py), sizeRef.current));
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => commit(viewRef.current), WHEEL_SETTLE_MS);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      clearTimeout(wheelTimerRef.current);
    };
  }, [commit]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX, y: e.clientY,
      tx: viewRef.current.tx, ty: viewRef.current.ty,
    };
    // Reset here rather than on pointer-up: `click` fires after `pointerup`, and the click
    // handler is what needs to know whether this gesture was a drag.
    movedRef.current = false;
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return false;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return true;
    if (!movedRef.current) setIsDragging(true);
    movedRef.current = true;
    setView(clampView({ k: viewRef.current.k, tx: d.tx + dx, ty: d.ty + dy }, sizeRef.current));
    return true;
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (movedRef.current) {
      setIsDragging(false);
      commit(viewRef.current);
    }
  }, [commit]);

  const didDrag = useCallback(() => movedRef.current, []);

  return {
    view, isDragging,
    onPointerDown, onPointerMove, onPointerUp, didDrag,
    zoomIn, zoomOut, reset, attachWheel,
  };
}
```

- [ ] **Step 6: Wire it into `ExploreMap.jsx`**

Add the import:

```js
import { useMapTransform } from './useMapTransform';
```

Directly after the `setParam` definition, add:

```js
  // The viewport is committed to the URL at the end of a gesture, never per pixel — a pan
  // writing 60 history entries would make Back useless.
  const commitView = useCallback((serialised) => setParam('view', serialised), [setParam]);
  const transform = useMapTransform({ size, params, onCommit: commitView });
```

`setParam` must therefore be memoised — replace it with:

```js
  const setParam = useCallback((key, value) => {
    setParams(withParam(params, key, value), { replace: true });
  }, [params, setParams]);
```

and add `useCallback` to the React import on line 1.

Register the wheel listener alongside the other canvas effects. **Destructure `attachWheel` first** —
depending on `transform` would re-run this on every render, tearing the listener down and rebuilding it
each time:

```js
  const { attachWheel } = transform;
  useEffect(() => attachWheel(canvasRef.current), [attachWheel]);
```

In the draw effect, replace `FIT_VIEW` with `transform.view` and add it to the dependency array:

```js
    const points = layout(data.songs, space, size, transform.view);
```

Remove the now-unused `FIT_VIEW` import.

Update the canvas element's props:

```jsx
          <canvas
            ref={canvasRef}
            role="img"
            className={transform.isDragging ? 'explore-canvas grabbing' : 'explore-canvas'}
            aria-label={`Map of ${data.coverage.mapped} songs positioned by ${
              (data.spaces.find(s => s.key === space) || {}).label} similarity, coloured by ${
              (legend || {}).label}.`}
            onPointerDown={transform.onPointerDown}
            onPointerMove={onMove}
            onPointerUp={transform.onPointerUp}
            onPointerLeave={() => { transform.onPointerUp(); setHover(null); }}
            onClick={onClick}
          />
```

And make `onMove` yield to a pan, and `onClick` ignore the click that ends one:

```js
  const onMove = (e) => {
    // A pan owns the pointer; showing a hover card mid-drag is noise.
    if (transform.onPointerMove(e)) { setHover(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const hit = nearest(e.clientX - r.left, e.clientY - r.top);
    setHover(hit ? { song: hit.song, x: hit.x, y: hit.y } : null);
  };

  const onClick = (e) => {
    // `click` fires after the pointer-up that ended a pan; without this every drag would
    // also select a song.
    if (transform.didDrag()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const hit = nearest(e.clientX - r.left, e.clientY - r.top);
    if (hit) setParam('song', String(hit.id));
  };
```

- [ ] **Step 7: Add the zoom controls**

Inside `.explore-plot`, immediately after the `<canvas>` element and before the hover card:

```jsx
          <div className="explore-zoom">
            <button type="button" aria-label="Zoom in" onClick={transform.zoomIn}>+</button>
            <button type="button" aria-label="Zoom out" onClick={transform.zoomOut}>−</button>
            <button type="button" className="explore-zoom-reset" onClick={transform.reset}>
              Reset
            </button>
          </div>
```

The `+`/`−` glyphs are not accessible names, hence the `aria-label`s; `Reset` names itself.

- [ ] **Step 8: Style the controls**

Append to `components.css` after the `.explore-plot` rule:

```css
/* Keyboard and touch get the same power as the wheel — buttons-only would take several
   clicks to reach a cluster, and wheel-only leaves both out entirely. */
.explore-zoom {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: flex;
  gap: var(--space-1);
  z-index: 1;
}

.explore-zoom button {
  min-width: 28px;
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
}

.explore-zoom button:hover { color: var(--text-primary); }

/* touch-action: none is what makes drag-pan work on a touchscreen — without it the browser
   claims the gesture for page scrolling before the canvas ever sees it. */
.explore-canvas { touch-action: none; cursor: grab; }
.explore-canvas.grabbing { cursor: grabbing; }
```

- [ ] **Step 9: Verify**

```
node --test frontend/src/components/explore/exploreUrlState.test.js frontend/src/components/explore/mapGeometry.test.js
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: 26 tests pass, 0 lint errors, build clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/explore frontend/src/styles/components.css
git commit -F <scratchpad message file>
```

Message subject: `feat(explore): zoom and pan the map, with the viewport in the URL`

---

### Task 4: Motion — hover growth and a tweened space switch

**Files:**
- Modify: `frontend/src/components/explore/ExploreMap.jsx` (draw effect becomes a rAF frame loop;
  a `usePrefersReducedMotion` helper; hover feeds the draw)
- Modify: `frontend/src/styles/components.css` (nothing new required; verify no rule fights the
  canvas cursor)

**Interfaces:**
- Consumes: Task 2's `layout`; Task 3's `transform.view`.
- Produces: nothing later tasks import. Internal only.

- [ ] **Step 1: Add the reduced-motion hook**

At module scope in `ExploreMap.jsx`, below `extentsFor`'s former position:

```js
// A full-canvas animation is exactly the case the media query exists for, so the tween is
// not merely shortened under it — it is skipped, and the new space snaps into place.
function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduce;
}
```

- [ ] **Step 2: Add the tween constants and the easing**

Also at module scope:

```js
// Long enough to read a song travelling between two spaces, short enough not to be a wait.
const TWEEN_MS = 450;
const HOVER_GROWTH = 3;   // px added to the hovered dot's radius

// Decelerating: the arrival is the informative part of the motion, so it gets the time.
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
```

- [ ] **Step 3: Capture the outgoing frame when the space changes**

Add these refs beside `positionsRef` in the component:

```js
  const lastFrameRef = useRef(null);   // Map<id, {x, y}> — the most recent frame actually drawn
  const tweenRef = useRef(null);       // { from: Map<id,{x,y}>, start: number }
  const reduceMotion = usePrefersReducedMotion();
```

Then, **declared above the draw effect** so it runs first in the same commit:

```js
  // Switching space tweens every dot from where it is to where it belongs — that motion is
  // the answer to "which songs travel together between Thematic and Sound", which is the
  // question the map exists to raise. `from` is the last frame DRAWN, not the last space's
  // final layout, so interrupting mid-tween resumes from the current position.
  useEffect(() => {
    if (!lastFrameRef.current || reduceMotion) return;
    tweenRef.current = { from: lastFrameRef.current, start: performance.now() };
  }, [space, reduceMotion]);
```

- [ ] **Step 4: Turn the draw effect into a frame loop**

Replace the body of the draw effect (everything after the canvas sizing, from
`const points = layout(...)` to the end of the effect) with:

```js
    const target = layout(data.songs, space, size, transform.view);
    const dim = dimColour();
    const ringColour = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-primary').trim() || '#fff';

    const drawFrame = (points) => {
      ctx.clearRect(0, 0, size.w, size.h);
      const lit = [];
      for (const p of points) {
        const passesSpotlight = spotlit.size === 0 || spotlit.has(p.song.codes[colour]);
        const passesSearch = !matchIds || matchIds.has(p.id);
        if (passesSpotlight && passesSearch) lit.push(p);
        else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = dim;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 0.85;
      for (const p of lit) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.id === hoverId ? DOT_RADIUS + HOVER_GROWTH : DOT_RADIUS,
          0, Math.PI * 2);
        ctx.fillStyle = scale(p.song.codes[colour]);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // A soft halo, drawn in the dot's own colour, so the hovered song is findable without
      // reading the card — and without a second colour entering the palette.
      if (hoverId != null) {
        const h = points.find(p => p.id === hoverId);
        if (h) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, DOT_RADIUS + HOVER_GROWTH + 3, 0, Math.PI * 2);
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = scale(h.song.codes[colour]);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      if (selectedId) {
        const hit = points.find(p => p.id === selectedId);
        if (hit) {
          ctx.beginPath();
          ctx.arc(hit.x, hit.y, DOT_RADIUS + 4, 0, Math.PI * 2);
          ctx.strokeStyle = ringColour;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      positionsRef.current = points;
      lastFrameRef.current = new Map(points.map(p => [p.id, { x: p.x, y: p.y }]));
    };

    let raf = 0;
    const frame = (now) => {
      const tween = tweenRef.current;
      if (!tween) { drawFrame(target); return; }
      const t = Math.min(1, (now - tween.start) / TWEEN_MS);
      const e = easeOutCubic(t);
      drawFrame(target.map(p => {
        const from = tween.from.get(p.id);
        if (!from) return p;   // a song with no coordinates in the old space simply appears
        return { ...p, x: from.x + (p.x - from.x) * e, y: from.y + (p.y - from.y) * e };
      }));
      if (t < 1) raf = requestAnimationFrame(frame);
      else tweenRef.current = null;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
```

Add this plain derivation to the component body, beside the `selected` memo:

```js
  // The id, not the hover object: `hover` is rebuilt on every mousemove even while the
  // pointer stays on one dot, and it is a draw dependency now.
  const hoverId = hover ? hover.song.id : null;
```

Set the effect's dependency array to:

```js
  }, [data, space, colour, scale, size, spotlit, matchIds, selectedId, transform.view, hoverId]);
```

`tween.start` lives in the ref rather than in the effect, so a re-render mid-tween (a pan, a hover)
continues the animation at the right progress instead of restarting it.

- [ ] **Step 5: Verify by hand in the browser**

```
npm --prefix frontend run lint
npm --prefix frontend run build
```

Then with the dev servers running, on `/explore`:
- Hovering a dot grows it and draws a halo in its own colour; the cursor is a hand.
- Switching Thematic → Sound animates every dot for about half a second.
- Switching space again mid-animation continues from where the dots are, with no jump.
- In the browser devtools, **Rendering → Emulate CSS prefers-reduced-motion: reduce**, then switch
  space: the new layout appears immediately, with no animation.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/explore/ExploreMap.jsx
git commit -F <scratchpad message file>
```

Message subject: `feat(explore): hover growth and a tweened space switch`

---

### Task 5: Narrow layout (≤860px) — legend above, song card as a bottom sheet

**Files:**
- Modify: `frontend/src/components/explore/ExploreMap.jsx` (one class on the "Selected" rail label)
- Modify: `frontend/src/styles/components.css` (replace the `@media (max-width: 860px)` block at
  ~line 2573)

**Interfaces:**
- Consumes: nothing. Produces: nothing. Layout only — no JS branch on width, so there is no second
  code path to keep in step.

**One deliberate deviation from spec §4.3, which is out of date on this point.** The spec says
"dismissing it leaves the selected dot's ring in place so the reader does not lose their position".
That was written on 2026-08-02; the curator's **second** smoke round then found that a selected song
could not be cleared at all, and `76ffb1f` made the card's × (and Escape) delete the `song` param —
ring included. Honouring both would mean two controls on one card: a "collapse the sheet" and a
"clear the selection". The later, curator-driven decision wins, and the sheet keeps exactly one ×
meaning exactly what it means in the rail. **Do not add a second dismiss control.**

- [ ] **Step 1: Give the "Selected" label its own class**

In `ExploreMap.jsx`, change the rail label above `SelectedSongCard`:

```jsx
          <div className="explore-rail-label explore-rail-label--selected">Selected</div>
```

It is hidden in the narrow layout: the sheet is anchored to the bottom of the viewport, so a heading
left behind above the plot would label nothing.

- [ ] **Step 2: Replace the narrow-layout media block**

Replace the whole existing `@media (max-width: 860px)` block in `components.css` with:

```css
/* Narrow: the legend becomes a wrapping strip ABOVE the plot, the map takes the full width, and
   the selected song becomes a bottom sheet. The curator chose the sheet over stacking the rail
   under the plot. The risk a sheet carries is that it covers the dots just clicked, so it is
   capped hard at 30vh and never becomes a full-height overlay. */
@media (max-width: 860px) {
  .explore-body { flex-direction: column; }

  .explore-rail {
    width: auto;
    order: -1;
    border-left: 0;
    padding-left: 0;
  }

  .explore-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
  }
  .explore-legend > li { padding: 0; }
  .explore-legend-toggle { width: auto; }

  /* Group members wrap inline too, keeping the hairline as the only grouping cue. Text
     labels stay beside every swatch here as everywhere else: in dark mode the green/yellow
     pair sits in the CVD warn band and the label is its only compensating control. */
  .explore-legend-children {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-2);
    margin-left: 0;
    padding-left: var(--space-2);
  }

  .explore-rail-label--selected { display: none; }

  .explore-song-card {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    max-height: 30vh;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-3);
    background: var(--bg-surface);
    border-top: 1px solid var(--border-hairline);
    box-shadow: var(--shadow-raised);
  }

  /* Small inline cover art — the sheet's whole budget is 30vh, and a full-width image would
     spend all of it before the title. */
  .explore-song-art {
    width: 56px;
    height: 56px;
    object-fit: cover;
    float: left;
    margin-right: var(--space-3);
  }
}
```

- [ ] **Step 3: Verify by hand**

```
npm --prefix frontend run lint
npm --prefix frontend run build
```

Then in the browser at a 800px-wide viewport (devtools device toolbar), on `/explore`:
- The legend sits above the plot as a wrapping row, **every swatch still has its text label**, and
  every entry is still clickable as a spotlight.
- The map is full width; the zoom buttons are still in the top-right corner and not overlapped.
- Clicking a dot raises a bottom sheet no taller than 30% of the viewport, with small art on the
  left, and its × clears the selection — sheet and ring together, exactly as it does in the rail.
- At ≥861px nothing has changed from Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/explore/ExploreMap.jsx frontend/src/styles/components.css
git commit -F <scratchpad message file>
```

Message subject: `feat(explore): narrow-width legend strip and a capped bottom sheet`

---

### Task 6: Puppeteer smoke, curator checklist, and docs

**Files:**
- Create: `<scratchpad>/batch-b-smoke.mjs` (not committed — smoke scripts live in the scratchpad so
  nodemon never restarts the curator's backend mid-run)
- Create: `docs/BATCH_B_CURATOR_SMOKE.md`
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`

**Interfaces:** none — this task ships verification and documentation.

- [ ] **Step 1: Start isolated servers**

Backend on `:5001` and Vite on `:5199`, so the curator's `:5000`/`:5173` survive. Record both PIDs;
kill **by PID** at the end. **Never `taskkill /F /IM node.exe`** — it has killed unrelated Node
processes on this machine before.

```
$env:PORT=5001; node backend/server.js        # background
npm --prefix frontend run dev -- --port 5199  # background
```

- [ ] **Step 2: Write the smoke script**

Create `<scratchpad>/batch-b-smoke.mjs`. It lives in the scratchpad, not in the repo: a `.js` file
written under `backend/` restarts the curator's nodemon mid-run.

```js
// Batch B smoke. Run against an isolated Vite on :5199 backed by :5001.
// Puppeteer is installed under frontend/, not at the repo root, so it is required from there.
import { createRequire } from 'node:module';

const REPO = 'C:/Users/Owner/Documents/AI Applications/vegan-playlist';
const require = createRequire(`${REPO}/frontend/`);
const puppeteer = require('puppeteer');

const BASE = 'http://localhost:5199';
const CANVAS = '.explore-canvas';
let pass = 0, fail = 0;

const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Park the pointer off the plot and let a frame land, so a stray hover halo never makes two
// otherwise-identical canvases compare unequal.
async function settle(page) {
  await page.mouse.move(2, 2);
  await sleep(220);
}

async function openMap(page, qs = '') {
  await page.goto(`${BASE}/explore${qs}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(CANVAS);
  await settle(page);
}

const snapshot = (page) => page.$eval(CANVAS, c => c.toDataURL());
const viewParam = (page) => new URL(page.url()).searchParams.get('view');
const songParam = (page) => new URL(page.url()).searchParams.get('song');

// Topmost drawn pixel, in CSS pixels relative to the canvas. The topmost dot sits on the
// plot's edge, so it is effectively always an isolated one.
async function topDot(page) {
  return page.$eval(CANVAS, (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const dpr = c.width / c.clientWidth;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 200) {
          return { x: x / dpr, y: y / dpr, dx: x, dy: y, dpr };
        }
      }
    }
    return null;
  });
}

// Diameter of that topmost blob, in device pixels: the widest contiguous run of opaque
// pixels within a small window under its top edge.
async function topDotWidth(page) {
  return page.$eval(CANVAS, (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const opaque = (x, y) => d[(y * c.width + x) * 4 + 3] > 200;
    let x0 = -1, y0 = -1;
    outer: for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) if (opaque(x, y)) { x0 = x; y0 = y; break outer; }
    }
    if (y0 < 0) return 0;
    const W = 24;
    let widest = 0;
    for (let y = y0; y < Math.min(c.height, y0 + W); y++) {
      let run = 0;
      for (let x = Math.max(0, x0 - W); x < Math.min(c.width, x0 + W); x++) {
        run = opaque(x, y) ? run + 1 : 0;
        if (run > widest) widest = run;
      }
    }
    return widest;
  });
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

try {
  // 1 + 2 — the + button zooms, writes the viewport to the URL, and changes the picture.
  await openMap(page);
  const atFit = await snapshot(page);
  const fitWidth = await topDotWidth(page);
  for (let i = 0; i < 3; i++) await page.click('button[aria-label="Zoom in"]');
  await settle(page);
  const view = viewParam(page);
  check('1 zoom writes view=k,tx,ty', !!view && Number(view.split(',')[0]) > 1, String(view));
  const zoomed = await snapshot(page);
  check('2 zoom redraws the map', zoomed !== atFit);

  // 3 — dot radius is constant. If radius scaled with zoom, the widest blob would GROW; with a
  // constant radius, zoom pulls clusters apart so it can only shrink or stay the same.
  const zoomWidth = await topDotWidth(page);
  check('3 dot radius constant under zoom',
    zoomWidth > 0 && zoomWidth <= fitWidth, `${fitWidth}px -> ${zoomWidth}px`);

  // 5 — the viewport round-trips through a copied URL. Done before Reset, while still zoomed.
  const shared = page.url();
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1280, height: 900 });
  await page2.goto(shared, { waitUntil: 'networkidle0' });
  await page2.waitForSelector(CANVAS);
  await settle(page2);
  check('5 view round-trips through a copied URL', (await snapshot(page2)) === zoomed);
  await page2.close();

  // 4 — Reset returns to fit and removes the param, so an unzoomed map shares as a clean URL.
  await page.click('.explore-zoom-reset');
  await settle(page);
  check('4 Reset clears the view param', viewParam(page) === null);
  check('4b Reset restores the fit view', (await snapshot(page)) === atFit);

  // 6 — a malformed viewport falls back to fit rather than to a blank plot.
  await openMap(page, '?view=banana');
  check('6 malformed view falls back to fit', (await snapshot(page)) === atFit);

  // 8 — a click with no movement still selects. Run at fit, before any panning.
  await openMap(page);
  const box = await page.$eval(CANVAS, c => {
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const dot = await topDot(page);
  // Aim a couple of pixels below the top edge, at the dot's middle.
  await page.mouse.click(box.left + dot.x, box.top + dot.y + 3);
  await page.waitForSelector('.explore-song-card .explore-song-title', { timeout: 3000 });
  check('8 a click selects a song', songParam(page) !== null, `song=${songParam(page)}`);

  // 12a — Escape clears it again.
  await page.keyboard.press('Escape');
  await sleep(200);
  check('12a Escape clears the selection', songParam(page) === null);

  // 7 — a drag pans and does NOT select. Zoom first: at 1x the pan is clamped to zero, which
  // would make this check pass without exercising anything.
  await openMap(page);
  for (let i = 0; i < 3; i++) await page.click('button[aria-label="Zoom in"]');
  await settle(page);
  const beforeDrag = await snapshot(page);
  const start = { x: box.left + 400, y: box.top + 260 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(start.x - i * 10, start.y + i * 5);
  await page.mouse.up();
  await settle(page);
  check('7 a drag pans the map', (await snapshot(page)) !== beforeDrag);
  check('7b a drag never selects a song', songParam(page) === null);

  // 9 — the genre legend still accounts for every mapped song.
  await openMap(page);
  await page.select('.explore-colour-by select', 'genre');
  await sleep(300);
  const total = await page.$$eval('.explore-legend > li > button .explore-legend-count',
    els => els.reduce((n, el) => n + Number(el.textContent.replace(/[^\d]/g, '')), 0));
  check('9 genre legend sums to 640', total === 640, String(total));

  // 11 — prefers-reduced-motion snaps instead of tweening.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await openMap(page);
  const chips = await page.$$('.explore-chip');
  await chips[1].click();
  await sleep(30);
  const early = await snapshot(page);
  await sleep(120);
  check('11 reduced motion snaps, does not tween', (await snapshot(page)) === early);
  await page.emulateMediaFeatures([]);

  // 10 — narrow layout: legend above the plot, sheet capped at 30vh.
  await page.setViewport({ width: 800, height: 900 });
  await openMap(page);
  await page.type('.explore-search input', 'love');
  await page.waitForSelector('.explore-matches button', { timeout: 3000 });
  await page.click('.explore-matches button');
  await page.waitForSelector('.explore-song-card', { timeout: 3000 });
  const legendBox = await page.$eval('.explore-legend', el => el.getBoundingClientRect().y);
  const canvasY = await page.$eval(CANVAS, el => el.getBoundingClientRect().y);
  check('10 legend sits above the plot when narrow', legendBox < canvasY,
    `legend ${Math.round(legendBox)} vs canvas ${Math.round(canvasY)}`);
  const sheet = await page.$eval('.explore-song-card', el => {
    const r = el.getBoundingClientRect();
    return { h: r.height, position: getComputedStyle(el).position };
  });
  check('10b the sheet is fixed and capped at 30vh',
    sheet.position === 'fixed' && sheet.h <= 900 * 0.30 + 2, `${Math.round(sheet.h)}px`);
  // Every swatch keeps its text label — the compensating control for the WARN-band pair.
  const unlabelled = await page.$$eval('.explore-legend > li > button',
    els => els.filter(el => !el.textContent.trim()).length);
  check('10c every legend swatch still carries a text label', unlabelled === 0);

  // 12b — the retired standalone dashboard still redirects.
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' });
  check('12b /dashboard still redirects to /explore/data',
    new URL(page.url()).pathname === '/explore/data', page.url());
} finally {
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
```

- [ ] **Step 3: Run the smoke and fix anything red**

```
node <scratchpad>/batch-b-smoke.mjs
```

Expected: **17 passed, 0 failed**. Report the actual number — a partial pass is a partial pass, and
a check that had to be weakened to go green is a finding, not a pass.

- [ ] **Step 4: Run the full gates**

```
npm --prefix backend test
node --test frontend/src/components/explore/exploreUrlState.test.js frontend/src/components/explore/mapGeometry.test.js
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: backend **165** passing (unchanged — this batch touches no backend file), 26 frontend module
tests passing, 0 lint errors, build clean.

- [ ] **Step 5: Kill the isolated servers by PID**

Kill only the two PIDs recorded in Step 1. Confirm the curator's `:5000` and `:5173` are still
answering afterwards.

- [ ] **Step 6: Write the curator checklist**

Create `docs/BATCH_B_CURATOR_SMOKE.md`, modelled on `docs/B4_CURATOR_SMOKE.md`. No §0 restart step —
the `:5000` backend is nodemon and this batch changes no backend file at all. Sections:

- **§1 Zoom and pan** — wheel toward a cluster, drag to it, `+`/`−`/`Reset`; does 12× feel like enough
  and 1× like the right floor?
- **§2 The URL** — zoom in, copy the URL, open it in a new tab: the same view. Then hand-edit the
  `view` param to nonsense and confirm the map still draws.
- **§3 Drag versus click** — panning must never select a song; a click must still select one.
- **§4 Motion** — switch Thematic → Sound and watch: **does the tween actually show you which songs
  travel together?** That is the question no test can answer, and the reason the tween was built.
- **§5 Narrow** — resize the window below ~860px: legend above, map full width, bottom sheet capped.
  Does the sheet cover the dots you just clicked badly enough to matter?
- **§6 Regressions** — legend spotlight, search, Escape/× clearing, `/dashboard` redirect.

- [ ] **Step 7: Update the project docs**

- `docs/PROJECT_STATE.md` — advance the current/next session, refresh "Next Tasks" (the next item is
  **triage 6 — the About analysis-explainer + AI-disclosure page**), add a Decision Log entry for this
  batch, and append a Changelog entry.
- `docs/PROJECT_PLAN.md` — mark Batch B ☑ with its outcome.
- `CLAUDE.md` — extend the `components/explore/` list in the Frontend Structure section with
  `exploreUrlState.js`, `mapGeometry.js` and `useMapTransform.js`, one clause each saying what they
  own and why they are separate.

- [ ] **Step 8: Commit and push**

```bash
git add docs CLAUDE.md
git commit -F <scratchpad message file>
git push -u origin session-B4-batch-b
```

Message subject: `docs: record Batch B and its curator smoke checklist`

---

## Done when

- Backend **165/165** (unchanged), the 26 frontend module tests pass under `node --test`, lint 0
  errors, frontend build clean.
- Puppeteer smoke **17/17**, run on `:5001`/`:5199` with the curator's servers untouched and both
  isolated PIDs killed individually afterwards.
- Wheel, drag and the three buttons all move the map; the viewport survives a copied URL and a
  malformed one falls back to fit; dots keep their radius at every zoom level.
- A space switch tweens, resumes correctly when interrupted, and snaps under
  `prefers-reduced-motion`.
- Below 860px the legend is a labelled strip above a full-width map and the selected song is a
  bottom sheet no taller than 30vh.
- Branch pushed and **held for the curator's smoke before merge**, as every session since triage 1.
