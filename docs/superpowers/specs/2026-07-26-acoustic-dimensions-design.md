# Acoustic dimensions on the song page + browse filters — design

**Date:** 2026-07-26
**Status:** Approved (curator, 2026-07-26)
**Scope:** Public song page display, browse sidebar filters, two heading renames.
**Type:** Display + filter feature. **No migrations, no pipeline changes, no writes to `song_lyric_analysis`.**

---

## 1. What prompted this

The analysis pipeline has added six acoustic dimensions to `song_lyric_analysis`, derived from
audio features. The curator wants them on the song page under **Style & tone** but visually
distinct from the lyrical dimensions, wants them **searchable**, and wants two headings renamed
now that the page carries both lyric and audio analysis.

## 2. The data, as it actually is

Read-only DB probe, 2026-07-26. Six new columns on `song_lyric_analysis`:

| Column | Type | Distinct values across all 717 rows |
| --- | --- | --- |
| `sonic_energy` | varchar | `MODERATE_BALANCED` (717/717) |
| `emotional_mood` | varchar | `BALANCED_NEUTRAL` (717/717) |
| `rhythmic_style` | varchar | `DRIVING_STEADY_PULSE` (717/717) |
| `acoustic_type` | varchar | `ELECTRIC_AMPLIFIED` (717/717) |
| `vocal_delivery` | varchar | `STANDARD_MELODIC_SINGING` (717/717) |
| `tempo_bpm` | integer | `120` (717/717) |

**Zero variance.** Every row carries the same value in every dimension, including the 21 rows
written on 2026-07-26. Each observed value is the *middle* code of its codebook component, which
is what a schema-default fill looks like. Supporting evidence that no derivation ran: the Spotify
audio features these would come from are empty on all 1,333 live songs
(`energy`/`danceability`/`valence`/`acousticness`/`tempo` = 0 populated), and
`manual_audio_features` has 0 rows.

Coverage on the latest pass: **692 of 693** live songs that have any analysis row (the one
exception is the single live song whose latest pass is still `gemma4:deep_pipeline`). 640 live
songs have no analysis row at all and are unaffected.

**Curator decision:** build and ship it as-is, with no degenerate-data guard. The section will
read identically on every analysed song until a varied pass lands. This is a known, accepted
consequence, recorded here so it is not later mistaken for a bug.

## 3. The codebook

`backend/data/acoustic_codebook.json` (curator-owned, already in the repo). Same shape as
`master_metadata_codebook.json`: each component has `component_name`, `description`, and a
`codes[]` array of `{ code, label, short_tag, definition, threshold }`. `tempo_bpm` is the
exception — no `codes`, just `value_type: "INTEGER_BPM"` and `example_values`.

Ignored deliberately: the emoji `short_tag`s (brand voice — the same call taken for the lyrical
codebook) and the `threshold` strings (pipeline internals, meaningless to a visitor).

Full enum sets (only the **bolded** value occurs in the data today):

- **sonic_energy** — `EXPLOSIVE_HIGH_INTENSITY`, `DRIVING_ENERGETIC`, **`MODERATE_BALANCED`**, `SOFT_CALM_ACOUSTIC`
- **emotional_mood** — `SOMBER_MELANCHOLIC`, `SERIOUS_INTENSE`, **`BALANCED_NEUTRAL`**, `UPLIFTING_POSITIVE`
- **rhythmic_style** — `HIGH_DANCEABLE_RHYTHM`, **`DRIVING_STEADY_PULSE`**, `FREEFORM_ATMOSPHERIC`
- **acoustic_type** — `UNPLUGGED_ACOUSTIC`, `HYBRID_SEMI_ACOUSTIC`, **`ELECTRIC_AMPLIFIED`**
- **vocal_delivery** — `SPOKEN_WORD_RAP`, `SPOKEN_SAMPLE_HYBRID`, **`STANDARD_MELODIC_SINGING`**

## 4. Decisions

1. **Placement** — inside the existing "Style & tone" section, which splits into two labelled
   groups: **"In the lyrics"** (the existing attribute grid) and **"In the sound"** (the new one),
   separated by a rule. Rejected: appending only a sound heading without naming the lyric half
   (asymmetric), and rendering the sound values as chips (drops the dimension names, and invents a
   second visual language inside one section).
2. **Row labels are short** — Energy · Mood · Rhythm · Instruments · Vocals · Tempo — matching the
   terse lyrical headings ("Tone", "Speaking to") rather than the codebook's long
   `component_name`s, which wrap to three lines in a grid cell. The full component name reaches the
   reader through the hover tooltip.
3. **Display is ungated; selections are gated.** The lyrical path drops any code absent from its
   codebook. Per the curator's "show it as-is" call, the acoustic display shows whatever the
   pipeline emits, title-casing an unknown code. Filter *selections*, however, run through
   `cleanSelection`, so a hand-typed URL cannot select an invented code. **Accepted consequence:**
   an off-codebook value appears on the song page but cannot be filtered by — the reverse of the
   lyrical rule.
4. **Filters mirror the scalar metadata filters exactly** — one collapsible **"Sound"** sidebar
   group nesting five checkbox components, OR within a component and AND across, with exclude-self
   counts. Rejected: folding them into the existing "Lyric metadata" group (wrong name for them),
   and five new top-level groups (sidebar bloat).
5. **Tempo filters as a From/To BPM pair**, styled like the existing Year range control. Rejected:
   invented tempo bands (Slow/Mid/Fast boundaries would be a curatorial act the codebook does not
   authorise — it gives example values, not thresholds), and leaving tempo unfilterable.
6. **Renames** (public song page only): "Key lyrics" → **"Lyric highlights"** (sentence case to
   match every other heading on the page; plural because the section renders each stored passage
   as its own block), "Lyrical analysis" → **"Song analysis"**. The sidebar's "Has lyrics analysis"
   becomes **"Has song analysis"** — it already counts any analysis row, of either kind.
   Untouched: the admin Lyrics panel ("Key lyrics (public highlights)"), `SongSubmissionForm` and
   `SubmissionsManager` — curator/submitter surfaces, not this page.

## 5. Architecture

### 5.1 `backend/services/acousticCodebook.js` (new, pure)

Mirrors `services/metadataCodebook.js`: no DB access, no writes, owns
`data/acoustic_codebook.json`.

```js
COMPONENTS = [                              // the five enum components, in display order
  { key: 'sonic_energy',   column: 'sonic_energy',   heading: 'Energy' },
  { key: 'emotional_mood', column: 'emotional_mood', heading: 'Mood' },
  { key: 'rhythmic_style', column: 'rhythmic_style', heading: 'Rhythm' },
  { key: 'acoustic_type',  column: 'acoustic_type',  heading: 'Instruments' },
  { key: 'vocal_delivery', column: 'vocal_delivery', heading: 'Vocals' },
]
TEMPO = { key: 'tempo_bpm', column: 'tempo_bpm', heading: 'Tempo' }
```

`column` doubles as the SQL identifier whitelist — user input never reaches an identifier, the
same discipline `metadataCodebook` uses.

Exports: `COMPONENTS`, `TEMPO`, `componentName(key)`, `componentDescription(key)`,
`codeLabel(key, code)` (codebook label, title-cased fallback), `codeDefinition(key, code)`,
`optionsFor(key)`, `cleanSelection(key, values)`, `acousticSelectionClauses(sel, startIndex, alias)`.

No `SUPPRESSED` set — the acoustic codebook has no absence codes.

### 5.2 `getSongAnalysis` gains an `acoustic` array

It already selects from the latest-pass row (`LATEST_ANALYSIS`); it selects the six new columns
from that same row and returns:

```js
acoustic: [ { label: 'Energy', value: 'Moderate & Balanced',
              definition: 'Sonic Energy & Intensity — Mid-tempo, balanced volume, …' }, … ]
```

— the **identical cell shape** already returned for `attributes`, so the frontend renders it with
the same loop rather than a new data shape. `definition` is composed as
`` `${component_name} — ${code_definition}` `` so the full component name is reachable on hover
without crowding the cell. Null columns are skipped. Tempo becomes a cell like any other, valued
`120 BPM`. `hasContent` gains `acoustic.length > 0`, so a song with sound data but no lyric coding
still renders a section rather than 404ing.

### 5.3 `analysis.acousticFacets(db, constraints)` (new)

A direct parallel to `scalarFacets`: per-component option counts over live+published songs joined
to `LATEST_ANALYSIS`, keyed by component, each with its own exclude-self constraint so an open
group never shrinks its own options. Returns `{ [key]: { key, heading, description, options: [{ code, label, count }] } }`.

Tempo is **not** part of `acousticFacets` — a range control has no option counts. The response
carries a separate `tempo_range: { min, max }` for the input placeholders, matching how
`year_range` feeds the Year inputs.

### 5.4 `browseFilters.buildWhere`

- One exclude-self group per acoustic component, tagged `acoustic:<key>`, via
  `acousticCodebook.acousticSelectionClauses`.
- `tempo_from` / `tempo_to` → `sca.tempo_bpm >= $n` / `<= $n` (parsed as integers). **Not**
  exclude-self tagged — it has no facet counts to protect, so it is always applied, exactly like
  the existing `year_from` / `year_to`.
- **Reuses the existing `sca` join alias.** The acoustic columns live on the same latest-analysis
  row the scalar filters already join, so `joins.scalarAnalysis` covers both and **no new join is
  added**. A comment records that the flag now serves two component families.

### 5.5 Routes (`routes/spotify.js`)

- `GET /browse-facets` — builds one exclude-self constraint per acoustic component (same loop
  shape as the scalar one), calls `acousticFacets`, and returns `acoustic_facets` and
  `tempo_range` alongside `scalar_facets`.
- `GET /search` — accepts the five acoustic code params (repeatable) plus `tempo_from` /
  `tempo_to`. No route-level validation beyond what `buildWhere` and `cleanSelection` already do.

### 5.6 Frontend

- **`LyricalAnalysis.jsx`** — the Style & tone section renders two `.la-group` blocks with
  `.la-group-title` headings ("In the lyrics", "In the sound"), the second separated by a rule.
  Each group renders only when it has cells, but keeps its heading when it is the only one, so the
  reader always knows which half they are looking at. Sound values get the same `InfoTip` hover
  treatment as lyric attribute values. The section description becomes **"The voice and mood of
  the lyrics, and how the recording sounds."**
- **`SongDetailPage.jsx`** — the two heading renames.
- **`browseUrlState.js`** — a new exported `ACOUSTIC_KEYS` array added to `EMPTY_FILTERS` and
  `ARRAY_KEYS`; `tempo_from` / `tempo_to` added to `EMPTY_FILTERS` and `STRING_KEYS`. They then
  ride the existing URL + sessionStorage machinery with no further change.
- **`SearchAndFilter.jsx`** — a new `<FilterSection title="Sound">` after "Lyric metadata",
  wrapping **`ScalarFacetGroups` unchanged** (it is already generic over
  `{ key: { heading, options } }`; only its comment needs widening) plus a From/To BPM pair reusing
  the `.range-inputs` markup from Year range. Acoustic selections join the removable chip row via
  the existing label-map mechanism. The "Analysis" group's checkbox label becomes "Has song
  analysis".
- **`components.css`** — `.la-group` / `.la-group-title` in the existing lyrical-analysis block.
  Design tokens only, no raw colors.

## 6. What this does not do (YAGNI)

- No admin/workbench display of acoustic values.
- No About-page explainer copy — that is triage 6, which will need an acoustic section.
- No "has acoustic analysis" availability toggle.
- No `song_lyric_analysis` writes, no migration, no pipeline change.
- No new `has_analysis` semantics — it stays "any analysis row exists".

## 7. Verification

**Backend (`node:test`, unique fixture prefix per file):**

- `acousticCodebook`: label lookup, definition lookup, unknown-code title-case fallback,
  `optionsFor` ordering, `cleanSelection` dropping invented codes, clause/param shape from
  `acousticSelectionClauses`.
- `getSongAnalysis`: returns acoustic cells with composed definitions; tempo formatted `N BPM`;
  null columns skipped; a sound-only row still yields content.
- `buildWhere`: acoustic clauses land on `sca`, tempo bounds parse as integers, exclude-self
  tagging works, and **no second analysis join is added**.
- `acousticFacets`: per-option counts and exclude-self behaviour.

**Live smoke:** a real song page showing both groups; the Sound sidebar group with its counts;
a filter round-trip (select → URL → reload → still applied → chip removes it); a BPM range that
matches and one that excludes.

**Expected under today's data:** one option per group at count 692, every other option at (0) and
disabled; a BPM range including 120 returns the 692, one excluding it returns 0. That is correct
behaviour on degenerate data, not a defect.
