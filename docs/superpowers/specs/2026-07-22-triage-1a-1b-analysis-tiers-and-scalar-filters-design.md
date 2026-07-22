# Triage 1a + 1b — two-tier analysis read + scalar-attribute browse filters

_Design spec. 2026-07-22. Curator-approved at brainstorm._
_**Supersedes** [`2026-07-20-triage-1a-key-focus-adoption-design.md`](./2026-07-20-triage-1a-key-focus-adoption-design.md)
and its plan (branch `session-triage-1a-key-focus`, unmerged — abandon it). That spec's premises
were correct for the data as it stood on 2026-07-20; the curator's reanalysis has since changed
the data. It also un-defers **item 1b**, which that spec kicked back to the pipeline._

## Goal

Surface the curator's refined lyric analysis on the site:

1. **1a** — read the five **code dimensions** (themes / targets / actions / tactics /
   moral_frames) from the refined `gemma4:key_focus_pipeline` coding, and the seven **scalar
   metadata components** from the new, clean `gemini-3.5-flash-lite` coding.
2. **1b** — turn those seven components into **browse filters** (the "filter by lyrical
   analysis" ask), and show them properly on the song page.

## What changed in the data (verified read-only, 2026-07-22)

The curator ran two new analysis passes and vendored a new codebook,
`backend/data/master_metadata_codebook.json` (7 components: perspective, lyrical_tone,
intensity, clarity, focus_amount, target_audience, emotions).

| `model_used` | rows | live songs | code dimensions | scalars | `explanation` |
|---|---|---|---|---|---|
| `gemini-3.5-flash-lite` (07-22) | 679 | **661** | **all empty** | **clean codebook enums** | none |
| `gemini-flash-deductive` (07-21) | 679 | 661 | all empty | 378 null + 160 `ERROR` | — |
| `gemma4:key_focus_pipeline` | 637 | **617** | **clean, 1–3 codes/dim** | free-text | 637/637 |
| `gemma4:latest` (current site tier) | 673 | 640 | noisy, prompt-leak codes | free-text | yes |

**Curator confirmed:** `gemini-3.5-flash-lite` is the final scalar tier; `gemini-flash-deductive`
is a dead run to ignore; `gemma4:key_focus_pipeline` is the settled code-dimension source.

So the change **is** a two-tier split read — but not the split the 2026-07-20 handoff assumed
(which had scalars coming from `deep_pipeline`). Neither new pass carries code dimensions, and
the old gemma4 tiers' scalars are free-text.

### Scalar cleanliness — 100%

Every non-null value in all seven components of `gemini-3.5-flash-lite` is a valid codebook
code. **Zero unknown values.** Nulls: perspective 3, intensity 2, lyrical_tone 1, focus_amount 1;
clarity / target_audience / emotions 0. This is what unblocks 1b — the 2026-07-20 blocker was
free-text scalars with 0/637 enum match.

Codes per component: perspective 11 · lyrical_tone 15 · intensity 10 · clarity 10 ·
focus_amount 6 · target_audience 12 · emotions 32.

The six non-emotion columns are single-valued `TEXT` in the DB and single-valued in practice
(the codebook's "allow a 2nd code" rule never produced one). `emotions` is `TEXT[]`, 1–3 codes —
but **321 of 679 rows (47%) have an empty array** (flagged to the curator as a pipeline
observation, not worked around here: an empty array simply renders nothing and counts nothing).

### Coverage overlap (live = `status='included' AND published=true`)

| | live songs |
|---|---|
| both tiers | **613** |
| code dimensions only | 4 |
| scalars only | **48** |
| either (the new "has analysis") | **665** |

## Curator decisions

1. **Split read**, two constants — code dims from key_focus, scalars from flash-lite.
2. **"Has analysis" = either tier.** A song shows whatever it has: 613 get the full section,
   4 get chips only, 48 get the attributes card only.
3. **All seven components become filters**, each its own **collapsed-by-default** sidebar group.
4. **OR within a component, AND across components.** (ANDing two Perspectives would always
   return zero — the six single-valued components require OR.) Emotions follows the same rule.
5. **Song page**: keep the compact label→value attributes card; add a 7th **Audience** row;
   codebook labels as values; codebook definition as a hover tooltip. No links into browse.
6. **Absence codes are hidden everywhere** — display *and* filters: `THEMATIC_ABSENCE`
   (clarity), `ABSENCE_OF_FOCUS` + `INSUFFICIENT_DATA` (focus_amount), `UNSPECIFIED`
   (target_audience). A song whose only value in a component is suppressed shows no row for it
   and is not selectable by it.

## Design

### 1. Two model constants (`backend/services/analysis.js`)

```js
const CODE_MODEL   = 'gemma4:key_focus_pipeline';  // code dims + explanation + evidence
const SCALAR_MODEL = 'gemini-3.5-flash-lite';      // the 7 codebook components
```

`DEFAULT_MODEL` is **removed, not aliased**, so every consumer must state which tier it means —
a silent wrong-tier read becomes impossible. A single exported `ANY_TIER_SQL` literal
(`'gemma4:key_focus_pipeline','gemini-3.5-flash-lite'`, built from the constants with the same
quote-escaping `curation.js` already uses for `MODEL_LITERAL`) is the one source for
"has analysis in either tier" `IN (…)` clauses.

### 2. New unit — `backend/services/metadataCodebook.js`

Pure module, no DB. Owns `master_metadata_codebook.json` the way `analysis.js` owns
`taxonomy.json`:

- `COMPONENTS` — ordered list of `{ key, column, heading, multi }`:
  `perspective`/Perspective, `lyrical_tone`/Tone, `intensity`/Intensity, `clarity`/Clarity,
  `focus_amount`/Focus, `target_audience`/Audience, `emotions`/Emotions (`multi: true`).
  Short UI headings, not the codebook's long `component_name`s. `column` is the DB column —
  this list is the **whitelist**; no user input ever reaches SQL identifiers.
- `SUPPRESSED` — the four absence codes (decision 6).
- `codeLabel(component, code)` / `codeDefinition(component, code)` — falls back to Title Case
  on an unknown code (defensive; today there are none).
- `optionsFor(component)` — codebook order, suppressed codes removed.

The codebook's emoji `short_tag`s are **ignored** — the brand voice is emoji-free (Phase 3).
`taxonomy.json`'s now-dead scalar lists (`perspectives`, `lyrical_tones`, `intensity_levels`,
`clarity_levels`, `focus_amounts`, `target_audiences`) are left in the file — it's the curator's
artifact — but `analysis.js`'s `scalarLabel()` that read them is deleted.

### 3. `getSongAnalysis` — one query, two LEFT JOINs

```sql
SELECT c.themes, c.topics, c.advocacy, c.tactics, c.moral_frames, c.explanation,
       f.perspective, f.lyrical_tone, f.intensity, f.clarity, f.focus_amount,
       f.target_audience, f.emotions
FROM (SELECT $1::int AS song_id) x
LEFT JOIN song_lyric_analysis c ON c.song_id = x.song_id AND c.model_used = $2
LEFT JOIN song_lyric_analysis f ON f.song_id = x.song_id AND f.model_used = $3
```

Returns `null` only when **both** rows are absent. `attributes` is built from
`metadataCodebook` — `{ label, value, definition }` per component, skipping null and suppressed
values; `emotions` maps to labels, suppressed/empty dropped. Code dimensions and `explanation`
come from the code tier only (flash-lite has no `explanation` at all: 0/679).

Consumers of `getSongAnalysis` (public song page, admin workbench analysis panel) get the split
for free.

### 4. Filtering — `scalarSelectionClauses`

New in `metadataCodebook.js` (it owns the component→column mapping):

```js
scalarSelectionClauses(sel, startIndex) // -> { clauses, params, needsJoin }
```

Per component with a non-empty selection, one clause against the scalar-tier alias:

- single-valued: `sca.<column> = ANY($n::text[])`
- `emotions`: `sca.emotions && $n::text[]` (array overlap)

Suppressed codes are stripped from incoming selections before building clauses, so a
hand-crafted URL can't select them. Clauses are ANDed with everything else by the existing
`buildWhere` accumulation — giving OR-within / AND-across (decision 4).

`services/browseFilters.js`:

- `buildWhere` gains a `scalarAnalysis` join flag and one exclude-self group **per component**
  (`scalar:perspective`, `scalar:emotions`, …), so an open group stays widenable — the same
  behaviour Genre has.
- `has_analysis` becomes `EXISTS (… AND la.model_used IN (ANY_TIER_SQL))`.
- `joinSql` emits the code-tier join as today (alias `sa`) **plus** the scalar-tier join under a
  distinct alias **`sca`**. Distinct aliases are load-bearing: B1 shipped a real alias collision
  (`sa` vs `song_artists`) on exactly this pattern.

`/search` (`routes/spotify.js`) builds its analysis join inline rather than via `joinSql`; it
gains the matching `sca` join under `bw.joins.scalarAnalysis`.

### 5. Facet counts — `/api/spotify/browse-facets`

New `scalarFacets(db, constraint)` — placed in `analysis.js` beside `facetTree`, whose
signature and constraint contract it mirrors, so `metadataCodebook.js` stays DB-free. It
returns, per component:

```json
{ "perspective": { "heading": "Perspective",
                   "options": [{ "code": "...", "label": "...", "count": 12 }] } }
```

Counts are `COUNT(DISTINCT s.id)` over live songs joined to the scalar tier, under the
exclude-self constraint for that component. Codebook order; zero-count options are **included**
so the group's shape is stable — the frontend disables them with the existing `is-zero`
treatment. Emitted as a `scalar_facets` block alongside `facets`.

`/api/spotify/filter-options` (the static endpoint) gets the either-tier `has_analysis` fix for
consistency, but the sidebar reads its options and counts from `/browse-facets`.

### 6. Frontend — sidebar

`SearchAndFilter.jsx` renders the seven groups **directly under the theme facet tree**, using
the existing `filter-group` + checkbox pattern (Language/Length), **not** `ThemeFacetTree` —
these are flat lists, not hierarchies. Each group is collapsed by default with its selected
count in the header.

- `EMPTY_FILTERS` + `ARRAY_KEYS` in `utils/browseUrlState.js` gain the seven keys
  (`perspective`, `lyrical_tone`, `intensity`, `clarity`, `focus_amount`, `target_audience`,
  `emotions`), so selections are shareable, bookmarkable, Back-restorable and survive a Home
  click — inherited from triage 2 with no new mechanism.
- `buildSearchParams` passes them through; `FilterChips` shows one removable chip per selected
  code (label from `scalar_facets`); "Clear all" clears them.

No codebook file is shipped to the frontend — labels arrive from the API, keeping one source of
truth in the backend.

### 7. Frontend — song page

`LyricalAnalysis.jsx` keeps its structure. The attributes card gains the **Audience** row,
renders codebook labels, and puts the definition in a `title` attribute (the convention the
theme chips already use). The emotions row renders labels. Nothing renders for null or
suppressed values.

### 8. Tier per consumer

| Consumer | File | Tier |
|---|---|---|
| Song page + workbench analysis panel | `analysis.getSongAnalysis` | both (split) |
| Theme facet tree + rollup counts | `analysis.facetTree` | code |
| `themeCounts` / `analytics/vegan-themes` | `analysis.js`, `routes/analytics.js` | code |
| `/search` theme filters | `browseFilters`, `routes/spotify.js` | code (`sa`) |
| `/search` scalar filters | `browseFilters`, `metadataCodebook` | scalar (`sca`) |
| `scalar_facets` counts | `analysis.scalarFacets` | scalar |
| `has_analysis` toggle + count | `browseFilters`, `routes/spotify.js` | **either** |
| Admin needs-analysis queue + `hasAnalysis` | `services/curation.js` | **either** |

## Tests

`backend/test/` (node:test), with its **own fixture sentinel prefix** — shared LIKE-prefix
cleanup races under parallel runs.

- **`metadataCodebook.test.js`** (new): labels/definitions resolve; unknown code falls back to
  Title Case; suppressed codes absent from `optionsFor`; `scalarSelectionClauses` emits
  `= ANY` for single-valued and `&&` for emotions, strips suppressed selections, and returns
  `needsJoin: false` for an empty selection.
- **`analysis.test.js`**: `CODE_MODEL`/`SCALAR_MODEL` assertions replace the `DEFAULT_MODEL`
  one; `getSongAnalysis` covers all four coverage cases — both tiers, code-only (chips, no
  attributes), scalar-only (attributes, no chips), neither (`null`).
- **`curation.test.js`**: `hasAnalysis` true from a scalar-only row (the either-tier rule).
- All fixtures INSERT with `model_used` **referencing the constants**, never a literal, so they
  can never desync from a future tier switch.

## Verification

1. Backend `node:test` green (currently 92/92 on the triage-4 branch; this branch is off `main`
   at 90/90).
2. Live read-only smoke (temp backend on :5001 against the same DB, per house practice):
   - A both-tiers song: chips from key_focus + a 7-row attributes card with tooltips.
   - One of the 48 scalar-only live songs: attributes card, no chips, no "Show evidence".
   - One of the 4 code-only live songs: chips, no attributes card.
   - `GET /browse-facets`: `scalar_facets` has 7 components; suppressed codes absent; counts
     move when another filter is applied (exclude-self behaviour).
   - `GET /search?perspective=A&perspective=B` returns the union; adding `&emotions=X` narrows.
   - `has_analysis` count ≈ **665** (was 640).
   - Admin: workbench analysis panel renders; needs-analysis queue reflects either-tier.
3. Frontend live smoke (no test runner — consistent with Phase 3/B2/B3): sidebar groups
   collapse/expand, chips add + remove, selections survive a reload and a Home click.

## Out of scope

- Song-page values linking into browse (considered, declined — YAGNI for now).
- Any write to or cleanup of `song_lyric_analysis`, including the dead `gemini-flash-deductive`
  rows — the table is the curator's, this codebase only reads it.
- The 47% empty `emotions` arrays (pipeline-side observation, reported to the curator).
- Triage 4 (`session-triage-4-browse-polish`, pending merge), triage 5, B4.
- `ArtistSearchAndFilter.jsx` (separate endpoint, still deferred from B3).
