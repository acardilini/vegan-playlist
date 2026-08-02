# B4 map refinements — design

**Date:** 2026-08-02 · **Branch:** `session-B4-explore-map` (Batch A), then a new branch (Batch B)
**Follows:** [`2026-07-27-B4-explore-vector-map-design.md`](./2026-07-27-B4-explore-vector-map-design.md)
**Source:** the curator's smoke of the whole B4 branch ([`B4_CURATOR_SMOKE.md`](../../B4_CURATOR_SMOKE.md)).

## 1. Why this exists

The B4 smoke passed §1–§3 outright and §6/§6.4 outright — the song page needs no work. It produced one
change already shipped (`062b38f`, the Semantic space removed) and nine further items, split here into
two batches.

**The split is deliberate.** The §4 items are cheap, self-contained answers to a smoke of work that is
already built. The §5 items are new feature requests that rewrite the canvas draw loop. Piling both onto
an unmerged branch keeps working code off `main` for no benefit, so:

- **Batch A ships on `session-B4-explore-map` and the branch then merges.**
- **Batch B is the next session, from `main`.**

## 2. What the smoke measured, and two corrections it forces

Both of these were measured against the live database before designing, and both change what the
curator's observations mean.

**Genre on the map is mostly empty.** Of the 640 mapped songs: Not coded 379 (59.2%), metal 96 (15.0%),
hardcore 77 (12.0%), punk 48 (7.5%), folk 10, hip-hop 7, reggae 7, electronic 7, rock 4, pop 3, other 1,
soul 1. That is **11 real genre buckets**, not the 13 the catalogue-wide figure in the B4 spec reported —
the map population is a different population. "Other genres" is currently hiding **40 songs across 8
genres**, and below punk every genre is ≤10 songs.

**The far-away clusters are not a scaling bug.** The middle 99% of points already occupies **96–99%** of
the plot extent on every axis of every space (thematic x: 14.1 of 14.7; audio y: 15.7 of 16.0; holistic
x: 9.7 of 9.8). No handful of extreme outliers is squashing the mass. Those detached islands are real
UMAP structure. **Rescaling would therefore fix nothing; zoom is the answer**, which is why the response
sits in Batch B rather than being treated as a defect.

## 3. Batch A — ships on this branch, then merge

### 3.1 The genre legend: every genre named, four colours, spotlight as the identity channel

**An earlier draft of this spec specified an 11-colour palette. That was measured and is impossible.**
It is recorded here rather than quietly dropped, because the measurement is the reason for the design.

Run against the `dataviz` validator at scatter rigor (`--pairs all`, because any two categories' dots
can be spatially adjacent), on the dark surface:

| Simultaneous colours | Worst pair, normal vision | Result |
|---:|---|---|
| 4 (today's) | 19.3 | **PASS** — one CVD warn, mitigated by the legend's text labels |
| 5 | violet↔blue **9.8** | FAIL |
| 6 | red↔magenta **7.8** | FAIL |
| 8 (every documented hue) | red↔orange **7.1** | FAIL; magenta↔aqua CVD ΔE **1.6** under deuteranopia |

The floor is 15, below which the skill's own wording is "hard to tell apart even with full color vision".
**Four simultaneous categorical colours is a hard ceiling on a scatter plot**, and shades are worse than
hues, since a shade sits closer to its own base than any two different hues do. The `dataviz`
non-negotiable — *a 9th series is never a generated hue; it folds, facets, or uses composite encoding* —
is therefore binding, not advisory.

**The curator's actual objection was visibility, not colour count**, and this map has a second identity
channel a static chart does not: the legend is a spotlight control, and the hover card names a dot's
value. So:

- **The legend names all eleven genres**, each with its count. Nothing is hidden behind an opaque bucket.
- **Colour keeps four validated slots.** The top three by count (metal, hardcore, punk — 34% of the map
  between them) take categorical slots 1–3. The remaining eight named genres form an **"Other genres"
  group that shares slot 4**, and the group is rendered as a heading with its eight members listed
  beneath it, each individually clickable. This is the existing nested pattern — `FilterSection` and the
  theme tree already read this way — not a new one.
- **Every genre is individually spotlightable, including the one-song ones.** Spotlighting reduces the
  plot to a two-colour scene (lit vs dimmed), which is legible regardless of palette budget. That is
  what makes a 1-song genre findable, and no palette ever could.
- **"Other genres" takes slot 4, not the neutral grey.** "A smaller genre" and "no genre at all" are
  different claims, and the neutral is reserved for the second — the same reasoning as the 2026-07-27
  decision not to merge `NOT_CODED` into the fold.

The colour bucket and the spotlight identity therefore come apart: a song's `codes.genre` carries its
**raw parent genre** (so spotlight can target folk specifically), while the **colour scale** maps top-3
to slots 1–3, any other named genre to slot 4, and `NOT_CODED` to the neutral. `GENRE_TOP_N` stays **3** —
it now sets how many genres get their own hue, not how many are visible.

**The invariant survives in a sharper form:** a dot's colour is always explained by a legend entry, and
its exact genre is always named in the legend and reachable by one click.

**Scope:** genre only. The five acoustic dimensions and Focus carry 3–4 codes each, already fit inside
the validated four, and the curator confirmed they look right. Nothing about them is re-validated, and
`VALIDATED_CATS` stays 4.

### 3.2 Dot radius

`DOT_RADIUS` 3.2 → **4.0**. The curator found the dots "perhaps a little small" and judged density
otherwise fine. Hover growth is Batch B; this is the static size only.

### 3.3 The coverage line

Smaller and greyer so it stops competing with the plot: `0.8rem` and `--text-muted`. The wording is
unchanged — the curator confirmed it reads as an honest limit, which was the open question.

### 3.4 Space descriptions

The three remaining spaces do mean distinct things, so the page says which. One muted line under the
toolbar, changing with the selected chip:

| Space | Line |
|---|---|
| Thematic | Positioned by an analysis of the lyrics. |
| Sound | Positioned by an analysis of the song's acoustic properties. |
| Holistic | Positioned by an analysis of both the lyrics and the sound. |

**Served from the backend**, in a map beside `SPACE_LABELS`, as a `description` on each space. Discovery
is data-driven, so a space the pipeline adds later has no description and the frontend renders nothing —
the same shape as labels, and it keeps copy about the analysis in one place.

This is definitional copy beside a control, which the curator has previously cut twice (see the
2026-07-22 and 2026-07-26 decisions). It is included here **only because it was explicitly requested** in
the smoke; it is not a precedent for reintroducing sidebar prose elsewhere.

### 3.5 Batch A verification

- Backend `node:test`: every named genre appears in the legend with its own count and its raw code; the
  top three carry their own colour slot and the rest carry the group's; `NOT_CODED` is never merged into
  the group; descriptions are served for the three known spaces and absent for an unknown one.
- The `dataviz` validator run recorded above stands as the palette evidence — no new colours are
  introduced, so nothing further needs validating.
- Gates: backend suite green, lint 0 errors, build clean.
- Curator eyeball on the live map — the palette question is one only their eyes can close, which is why
  the values are judged on the real map at real dot size rather than in a mockup.

## 4. Batch B — next session, from `main`

All decided in this brainstorm; recorded here so the next session starts from decisions, not questions.

### 4.1 Zoom and pan

A `{k, tx, ty}` transform in the draw loop: screen position = base × k + translate, where base comes
from the per-space extents exactly as now.

- **Wheel zooms toward the cursor**; trackpad pinch arrives as a ctrl-wheel event and works for free.
  Drag pans. **+ / − / Reset** buttons sit in the plot corner and give keyboard and touch users the same
  power. Rejected: modifier-gated zoom (undiscoverable) and buttons-only (several clicks to reach a
  cluster).
- Zoom clamps to **1×–12×**, 1× being fit-to-plot. Pan clamps so the map cannot be dragged off screen.
- **Dot radius stays constant under zoom** — zoom separates clusters rather than inflating dots, which
  is the point given §2's finding about detached islands.
- A **4px movement threshold** distinguishes drag from click, so panning never selects a song.
- Hit-testing needs no change: it already reads the screen positions the draw loop writes.
- **URL:** one `view=k,tx,ty` param, rounded, written on gesture end (not per pixel) with `replace`.
  Malformed values fall back to fit — the same guard added for `space` in `062b38f`, and the reason that
  guard exists is that this page's whole contract is that the view lives in the URL.
- **Deferred:** real touchscreen pinch. Drag-pan and the buttons cover touch.

### 4.2 Motion

- **Hover:** the dot grows and takes a soft halo; the cursor becomes a pointer.
- **Switching space tweens** every dot from its old position to its new one over ~450ms. This is not
  decoration: it shows which songs travel together between Thematic and Sound, which is the question the
  curator was asking in §4. Interrupting mid-tween resumes from the current position, not the old one.
- **`prefers-reduced-motion` disables the tween and snaps.** Non-negotiable for a full-canvas animation.

Rejected: a broader dot restyle (glow, size variation) — it drifts to decoration and would make the
1-song genres harder to pick out, working against §3.1.

### 4.3 Narrow layout (≤860px)

The curator chose the bottom-sheet option over the recommended stack.

- The legend moves **above** the plot as a wrapping row of swatch toggles; the map goes full width.
- The selected song becomes a **bottom sheet**.
- **The risk this carries is that the sheet covers the dots just clicked**, so it is capped: small inline
  cover art, compact title/artist/link rows, ~30vh maximum, and a close ×. Dismissing it leaves the
  selected dot's ring in place so the reader does not lose their position. It never becomes a full-height
  overlay.
- The search matches list sits under the legend strip.

### 4.4 Batch B verification

No frontend test runner exists, so a **puppeteer smoke** carries this: zoom via the buttons, `view`
round-tripping through a copied URL, drag not stealing selection, the legend summing to 640, and the
narrow layout at a forced viewport. Plus the standard gates.

## 5. Out of scope

3D remains its own future session, unchanged from the B4 spec. The acoustic derivation re-run is a
pipeline matter. Nothing here writes to any analysis table — `services/explore.js` stays read-only.
