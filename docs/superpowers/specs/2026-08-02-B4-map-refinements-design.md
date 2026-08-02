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

### 3.1 The genre palette: eleven colours, and a fold that is raised rather than deleted

`--explore-cat-*` grows from 5 slots to **11**: the eight `dataviz`-documented hues, then three shades
within already-used hues. Values are **not fixed in this spec** — they come from running the `dataviz`
validator at scatter rigor (`--pairs all`, because any two categories' dots can be spatially adjacent)
in **both** light and dark. The output is recorded in the `components.css` comment that already carries
the slot-5 record, and in the session report.

Two constraints bind that run, so it is not a free choice: **a shade must clear the validator against
its own base hue**, not merely against the other ten — a shade pair is the most likely thing to collapse
at dot size; and the **base hue a shade derives from should be one assigned far from it in legend
order**, so the pair is never adjacent in the legend where the eye compares them directly.

Genre has no codebook, so `legendFor` orders it by descending count. Assignment therefore puts the eight
**distinct hues on metal → rock** (96 down to 4 songs) and the three **shade variants on pop, other and
soul — 5 songs between them**, where a near-miss costs least. If a pair cannot clear the validator, the
failing pair is pushed onto the two smallest genres rather than accepted silently.

**`GENRE_TOP_N` moves 3 → 11 rather than the fold being removed.** Today nothing folds, which is what the
curator asked for. But the fold is the mechanism enforcing the invariant from the B4 spec — *a dot can
never carry a bucket its own legend does not explain* — so deleting it would mean a 12th genre, whenever
the pipeline emits one, either overflowing into an unvalidated colour or being drawn in the neutral grey
that means "Not coded", which would be a lie about the data. Raising it costs nothing and keeps the
guarantee. `VALIDATED_CATS` moves 4 → 11 so `colourScale`'s console warning keeps guarding the real edge.

**Scope:** genre only. The five acoustic dimensions and Focus carry 3–4 codes each, already fit inside
the validated hues, and the curator confirmed they look right. Nothing about them is re-validated.

**Stated limitation, because it is load-bearing:** eight of these genres have ≤10 songs on a 640-point
map. Colour separates metal/hardcore/punk well; it cannot make one soul song findable by scanning. The
**legend spotlight** is what finds it — the palette's job is to make it legible *once spotlit*.

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

- Backend `node:test`: nothing folds at 11 with today's data; a synthetic 12-genre fixture does fold;
  descriptions are served for the three known spaces and absent for an unknown one.
- The `dataviz` validator output for all 11 slots, both themes, recorded.
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
