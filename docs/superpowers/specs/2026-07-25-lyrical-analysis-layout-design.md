# Design — Song-page Lyrical Analysis / Themes layout rework

**Date:** 2026-07-25
**Status:** Approved (design), pending implementation plan
**Curator brief (2026-07-25):** the song-page analysis section is three parts — a description via 7
general metadata codes (Perspective / Tone / Intensity / Clarity / Focus / Audience / Emotions), 5
sets of thematic analysis (targets / actions / tactics / moral_frames / themes), and evidence. They
look inconsistent and aren't clearly distinguished; some dimension names collide (Audience vs
Targets); evidence summaries run long and quotes aren't clearly tied to their codes. Wants cohesion,
clearer separation of the two, clearer names, and better evidence composition.

This rework is **display-only** (read side). No analysis-pipeline changes, no new DB columns, no
migrations. The curator owns the coding and is, in parallel, fixing stray codes and generating
summaries with `gemini-3.5-flash-lite`.

---

## Correction (2026-07-25, post-build — commit `e25d300`)

**The top summary comes from `song_lyric_analysis.lyric_summary`, NOT `explanation`.** The curator
generates the "In short" summaries into the **`lyric_summary`** (TEXT) column on the
`gemini-3.5-flash-lite` pass — populated for **668 / 672 live songs**, while `explanation` is empty for
all. The plan and Decision #3 below said the summary reads `explanation`, so the strip shipped blank on
every song. Fixed on-branch: `getSongAnalysis` now selects `lyric_summary` and exposes it as the API
field **`summary`** (the misleading `explanation` key is dropped; the frontend variable was already
named `summary`). Wherever this doc says the summary source is `explanation`, read **`lyric_summary`**;
wherever it names the API field `explanation`, read **`summary`**. Everything else about Decision #3
(shown only when present; not auto-composed; not reused from older gemma4 prose) still holds.

## Decisions (with rationale)

### 1. Data source: dynamic "latest complete pass per song" — across the whole analysis surface

Replace the two fixed model constants (`CODE_MODEL = gemma4:key_focus_pipeline`,
`SCALAR_MODEL = gemini-3.5-flash-lite`) with a per-song selection of the single
`song_lyric_analysis` row with the newest `analyzed_at`:

```sql
DISTINCT ON (sla.song_id) sla.*
FROM song_lyric_analysis sla
ORDER BY sla.song_id, sla.analyzed_at DESC NULLS LAST
```

- **Every** field a song shows — the 5 thematic code dimensions, per-code evidence, the 7 scalar
  metadata components, emotions, and the summary (`explanation`) — reads from that one row, so they
  are always internally coherent.
- **This applies to the whole analysis surface, not just the song page** (curator-confirmed): the
  browse facet tree (`facetTree`), scalar facets (`scalarFacets`), the `/search` analysis filters
  (`facetSelectionClauses` join), and `themeCounts` all switch to the same latest-row selection.
  The song page and the browse filters therefore can never disagree about which coding a song has.
- The two-tier read is **retired**. `CODE_MODEL` / `SCALAR_MODEL` / `ANY_TIER_SQL` are removed.
  (Per CLAUDE.md those constants were "the only place a model string may appear"; after this change
  there is no hard-coded model string at all — the selector is purely `MAX(analyzed_at)`.)
- **"Has analysis"** = a latest row exists with any displayable content.

**Verification of the data (2026-07-25, read-only):** for all 672 live songs with any analysis, the
newest pass is `gemini-3.5-flash-lite` — no song regresses to an older scalar-only or empty pass.
638 have non-empty thematic codes; `explanation` is currently empty for all (summaries not yet
generated), so summaries are hidden until that pass lands.

**Documented assumption / known limitation:** "latest **row** per song" is only safe if each new
pass is *complete*. If a future pass writes a newer row containing only summaries (or only part of
the coding), the page will follow that partial row and drop the rest. The curator's current
`gemini-3.5-flash-lite` pass is complete (or updates its rows in place), so this holds today. Keeping
each pass complete is the operational contract this design depends on. (A more defensive "latest
non-empty value per field" was considered and rejected: it can pair a summary from one pass with
codes from another, reintroducing the very incoherence this section removes.)

### 2. Codebook gating: the page shows only codebook-valid codes

`mapDim` gains the same taxonomy gate the filters and `facetTree` already apply: a thematic code not
present in `taxonomy.json` is dropped from display. This covers the ~30 off-codebook codes the newest
pass currently emits — real-but-unmapped concepts (`speciesism`, `total_liberation`, `exploitation`,
…), typos (`captisvity`, `capturing`, `consumers_demand`), and blank strings.

- Result: the song page and the browse filters show the **same** set of codes — no page-vs-filter
  asymmetry, no typos or empty chips on the public page.
- The curator is fixing stray codes in the pipeline; as legitimate new concepts are added to
  `taxonomy.json`, they appear on **both** surfaces automatically, with no code change.
- Scalars keep their existing `codebook.cleanSelection` gate (unchanged).

### 3. Layout: Option C (curator-selected)

Within the existing `Lyrical analysis` `<h2>` section:

1. **Summary line** at the top, from `explanation`, rendered **only when present**; hidden entirely
   otherwise (curator: "only show the summary if a summary is available"). Styled as an ember-accent
   summary strip.
2. **Two labelled sub-sections, side by side** (grid; stacks to one column on narrow screens):
   - **"Style & tone"** — descriptor *"The voice, mood and intensity of the lyrics."* Renders the 6
     single-value metadata rows (Perspective, Tone, Intensity, Clarity, Focus, **Speaking to**) plus
     the Emotions row. Each value keeps its definition tooltip (`InfoTip`).
   - **"What it's about"** — the 5 thematic dimensions (Themes, **Subjects**, Actions, Tactics,
     Moral frames), each a small dimension heading + colour-coded chips (sub-dimension colour on
     border + dot, as today).
3. **Evidence = a per-section "Show quotes" toggle** on the thematic section, default **hidden**.
   When on, each code's short quote appears grouped under its dimension, tied to the specific code
   (`code label → "quote"`). The old bottom "Show evidence" block and the "Summary" heading nested
   inside it are removed — the summary is now the top line, and evidence lives next to its codes.

Section descriptors reuse the API-served component/dimension descriptions where they read well; else
a short hand-written line. (The codebook already serves these — built in triage 1a/1b, previously
unused on this surface.)

### 4. Naming

Resolves the Audience/Targets collision the brief named.

| Where | Current | New | Source of truth |
|-------|---------|-----|-----------------|
| Metadata component (left) | Audience | **Speaking to** | `backend/services/metadataCodebook.js` — `target_audience` `heading` |
| Thematic dimension (right) | Targets (song page) / "Targets & Species" (browse) | **Subjects** | `backend/data/taxonomy.json` — `hierarchy.targets.label`, **and** the frontend dimension heading constant |

- The thematic **section** title stays **"What it's about."**
- Renaming in `taxonomy.json` reflects through the browse facet tree and the future About page as
  well as the song page (curator: "reflected throughout"). Note this replaces the richer browse
  label "Targets & Species" with plain "Subjects" — intended.
- The frontend `LyricalAnalysis` dimension headings are currently a hard-coded constant; the
  `Targets`→`Subjects` heading is updated there too (or driven from the API dimension label).

### 5. Evidence composition

The brief's "quotes aren't well connected to their codes" is addressed structurally: quotes render
directly under each dimension, per code, as `label → "quote"`. Quotes are already concise (avg 44
chars, max 156). The long `explanation` is repurposed as the top summary rather than an evidence
dump, so the section no longer leads with a wall of prose.

---

## Components touched

**Backend**
- `services/analysis.js` — new shared "latest row per song" selection; `getSongAnalysis` reads one
  latest row; `mapDim` gains codebook gating; `facetTree`, `scalarFacets`, `themeCounts`, and the
  `facetSelectionClauses` join switch to the latest-row selection; remove `CODE_MODEL`/`SCALAR_MODEL`/
  `ANY_TIER_SQL`.
- `data/taxonomy.json` — `hierarchy.targets.label` → "Subjects".
- `services/metadataCodebook.js` — `target_audience` heading → "Speaking to".
- Any route/module that imported the removed constants (grep `CODE_MODEL`/`SCALAR_MODEL`/`ANY_TIER_SQL`).

**Frontend**
- `components/LyricalAnalysis.jsx` — Option C layout: conditional summary line; two labelled
  sub-sections ("Style & tone" / "What it's about"); per-section "Show quotes" toggle with quotes
  grouped under each dimension; remove the bottom evidence block; `Targets`→`Subjects` heading.
- `styles/components.css` (or the LA block) — two-column sub-section layout, summary strip, per-code
  quote rows; retire the old `.la-evidence-*` bottom-block styles no longer used.

## Non-goals

- No analysis-pipeline changes, no new columns, no migration.
- Browse/search behaviour is otherwise unchanged (facet logic, chips, filters, sort all as-is) —
  only the model-source selection and the two label renames.
- No change to the `song_lyrics` privacy invariants (this service never touches that table).

## Testing

- Backend `node:test`: the latest-row-per-song selection (returns the newest pass; ignores older
  rows), and `mapDim` codebook gating (drops unknown/blank codes). Unique fixture prefix per the
  per-file sentinel convention.
- Frontend: live smoke on the song page (no FE test runner, per Phase 3 / B2 / B3 precedent) —
  a song with codes + no summary (summary hidden), the "Show quotes" toggle, the two-column →
  single-column reflow, and the renamed labels on both the song page and the browse sidebar.
- Confirm browse facet counts and `/search` results still agree after the model-source swap.
