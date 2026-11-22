# Data > Arguments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Arguments tab to Explore > Data: a pathway flow (three presets, first-listed code per song) and "Themes that travel together".

**Architecture:** The existing `GET /api/analytics/dataset` payload gains six code fields and their labels. All aggregation is pure and `node --test`-tested in a new `flowModel.js` (flow counts, layout geometry, theme pairs, tables); thin React/SVG components render it inside the existing `SliceLayout`, so the shared slice bar applies. State (`flow`) lives in the URL through `dataUrlState.js`.

**Tech Stack:** Node/Express + PostgreSQL (`node:test`), React 19/Vite, hand-rolled SVG, design tokens only.

**Spec:** `docs/superpowers/specs/2026-11-22-data-arguments-design.md` (parent: `2026-11-22-explore-data-redesign-design.md`).

## Global Constraints

- A song counts under its **first valid code after gating** in each flow column (curator, 2026-11-22). Public copy says "first-listed", never "main" or "primary".
- Live songs only (`status='included' AND published=true`); lyric fields only via `analysis.LATEST_ANALYSIS`; vocal style only via `audioAnalysis.LATEST_AUDIO`; every code gated by its codebook or taxonomy. **The payload carries codes only: never an `evidence` string, lyric text, transcript text or audio samples.**
- Tokens only (`--bg-*`, `--text-*`, `--accent-*`, `--explore-cat-1..6`, `--explore-not-coded`); no emojis; labels from the codebooks and taxonomy; relative `/api/...` URLs only.
- Every chart states its denominator in its caption and has a Table view. Thresholds are named constants: `MIN_GROUP_FOR_SENTENCE` = 30 (exists), `MIN_PAIR_N` = 3, `TOP_NODES` = 6, `TOP_PAIRS` = 10, `TOP_PATHS` = 10, `PHONE_MAX_WIDTH` = 640.
- **Derived-values rule:** no figure in any sentence is typed; the only generated sentence is the strongest-link sentence, built from the data.
- Test commands: `cd backend && node --test --test-concurrency=1`; `cd frontend && node --test`, `npm run lint` (0 errors; 4 pre-existing warnings), `npm run build`. Never `taskkill` all node. Scratchpad scripts must `require` dotenv by absolute path. Commit with `git commit -F <scratchpad file>` and explicit `git add` paths; end messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A slice with one genre selected: the Genre column of preset 1 has a single node and full-height ribbons; nothing divides by zero or draws NaN. (Task 2 test, Task 3 test)
- A slice with no eligible songs, or fewer than a handful: `buildFlow` returns `n: 0` and empty columns; the tab shows an empty message, no chart, no sentence. (Task 2 test)
- A code with no label in the dictionary: the node shows a title-cased code, never `undefined`. (Task 2 test)
- Ties in counts: node and pair order is deterministic (count desc, then label asc), so a refresh never reshuffles. (Task 2 test)
- Fewer than 7 distinct codes in a column: no empty "Other" node is created. (Task 2 test)
- Resizing the window across the phone breakpoint swaps the SVG for the list without losing the pinned selection. (Task 4 browser check)

---

### Task 1: Dataset payload gains the Arguments fields

**Files:**
- Modify: `backend/services/dataset.js`
- Test: `backend/test/dataset.test.js` (append; sentinel `ZZZDSET` already used)

**Interfaces:**
- Consumes: `analysis.LATEST_ANALYSIS`, `analysis.SUBDIM` (keyed by DB column `themes` / `advocacy` / `moral_frames`, each a `Map(code → …)`), `analysis.label(dbColumn, code)`, `metadataCodebook.cleanSelection(key, value)` / `codeLabel(key, code)` for `target_audience` and `emotions`, `acousticCodebook.cleanSelection('vocal_style', arr)` / `codeLabel('vocal_style', code)`, `audioAnalysis.LATEST_AUDIO` (column `sau.vocal_style`).
- Produces: each `songs[i]` gains `aud` (string|null), `frm` (string|null), `act` (string|null), `emo` (string|null), `avoc` (string|null), `thm` (string[], gated, listed order, deduped, `[]` when none). `labels` gains `aud`, `frm`, `act`, `emo`, `avoc`, `thm`, each `{code: label}` for the codes that appear in the payload. The existing `songs[i].tone` and `labels.tone` / `labels.genres` are unchanged.

- [ ] **Step 1: Write the failing tests** (append to `dataset.test.js`; add helper `mkLyricFull(songId, {tone, themes, advocacy, moralFrames, emotions, audience})` inserting a `song_lyric_analysis` row with those jsonb/text values, themes/advocacy/frames as `[{code, evidence}]`; add `mkVocal(songId, vocalArray)` inserting a `song_audio_analysis` OK row with `vocal_style`). Take real codes from the taxonomy at test time: `analysis.taxonomy.themes[0].id`, `[1].id`, `analysis.taxonomy.actions[0].id`, `analysis.taxonomy.moral_frames[0].id`.
  - `thm keeps listed order, drops unknown codes and duplicates`: themes `[T0, 'zzz_bogus', T1, T0]` -> `thm` deep-equals `[T0, T1]`.
  - `frm and act are the first valid code`: frames `['zzz_bogus', F0, F1]` -> `frm === F0`; advocacy `[A0]` -> `act === A0`; a song with empty advocacy -> `act === null`.
  - `emo, aud and avoc are the first codebook-valid value`: emotions `['ZZZ_BOGUS','GRIEF','OUTRAGE']` -> `emo === 'GRIEF'`; audience `'COMPLACENT_AND_INDIFFERENT_PUBLIC'` -> `aud` equals it; vocal `['ZZZ_BOGUS','RAW_SHOUTED']` -> `avoc === 'RAW_SHOUTED'`.
  - `a song with no lyric analysis has null codes and an empty thm`.
  - `labels carry a label for each code that appears` (`d.labels.thm[T0]` is a non-empty string, same for `frm`, `act`, `emo`, `aud`, `avoc`).
  - `no song object carries an evidence key`: `JSON.stringify(d.songs).includes('evidence') === false` after inserting evidence strings.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && node --test test/dataset.test.js`
Expected: the six new tests FAIL (fields undefined).

- [ ] **Step 3: Implement in `backend/services/dataset.js`.** Extend the `buildDataset` SELECT with `sla.themes, sla.advocacy, sla.moral_frames, sla.emotions, sla.target_audience, sau.vocal_style`. A small local helper `firstValid(rows, column)` / `validCodes(rows, column)` over `analysis.SUBDIM[column].has(row.code)` produces `thm` (all valid theme codes, deduped, in order), `frm`, `act` (first valid). Scalars/arrays through the codebooks' `cleanSelection`, taking the first. Collect labels into per-field dictionaries as `toneLabels` is collected today. Do not copy `evidence`.

- [ ] **Step 4: Run to verify they pass, then the privacy and legacy guards**

Run: `cd backend && node --test test/dataset.test.js test/lyrics_privacy.test.js test/legacyAudio.test.js`
Expected: all PASS.

- [ ] **Step 5: Measure the payload** (scratchpad script requiring dotenv by absolute path): print `JSON.stringify(await getDataset(db)).length` and uncached `buildDataset` time. Expected: a few hundred KB, under ~150 ms. Record both in the commit message.

- [ ] **Step 6: Commit**

```bash
git add backend/services/dataset.js backend/test/dataset.test.js
git commit -F <scratchpad file>   # "feat(data): Arguments fields in the dataset payload"
```

---

### Task 2: Pure flow, pathway and theme-pair model

**Files:**
- Create: `frontend/src/components/explore/data/flowModel.js`
- Test: `frontend/src/components/explore/data/flowModel.test.js`

**Interfaces:**
- Consumes: payload song fields from Task 1; `MIN_GROUP_FOR_SENTENCE` from `dataModel.js`.
- Produces (exports of `flowModel.js`):
  - Constants `TOP_NODES = 6`, `MIN_PAIR_N = 3`, `TOP_PAIRS = 10`, `TOP_PATHS = 10`.
  - `PRESETS`: array of `{ id, label, columns: [{ field, name, labelKey }, x3], browseKeys: [x3] }` with ids `'genre-tone-action'` (fields `g`,`tone`,`act`; label keys `genres`,`tone`,`act`; browse keys `parent_genres`,`lyrical_tone`,`actions`), `'audience-frame-action'` (`aud`,`frm`,`act`; `target_audience`,`moral_frames`,`actions`), `'voice-tone-emotion'` (`avoc`,`tone`,`emo`; `vocal_style`,`lyrical_tone`,`emotions`). Column names: Genre, Lyrical tone, Advocacy action / Speaking to, Moral frame, Advocacy action / Vocal style, Lyrical tone, Emotion. `label` strings: `Genre, tone, action` / `Audience, frame, action` / `Voice, tone, emotion`.
  - `buildFlow(songs, preset, { labels, firstOrder = [] } = {})` -> `{ preset, n, columns: [{ name, nodes: [{ key, label, n, other, slot }] } x3], links: [[{ from, to, n }], [{ from, to, n }]], paths: [{ keys: [a,b,c], labels: [..], n }] }`. Eligible = songs with a non-null value in all three fields. Per column: top `TOP_NODES` codes by count (ties: label ascending) and one `other: true` node (`key: 'other'`, label `Other`, `slot: null`) folding the rest, absent when no codes remain. `slot` (0-5) applies to column 0 only: a node's index in `firstOrder` when below 6, else the lowest unused slot; columns 1 and 2 nodes have `slot: null`. `links[0]` joins column 0 to 1, `links[1]` column 1 to 2, folded the same way; `paths` lists every distinct folded triple sorted by `n` desc then labels. A label missing from the dictionary falls back to a title-cased code.
  - `strongestSentence(flow)` -> string or `null`: `null` when `flow.n < MIN_GROUP_FOR_SENTENCE`; else the largest link in `links[0]` whose endpoints are both non-Other, as `"Strongest link, <col0 name> to <col1 name>: <from> to <to>, <n> songs (about <p>% of the pathway songs)."`
  - `topPathways(flow, limit = TOP_PATHS)` -> `paths` without any Other, first `limit`.
  - `flowTable(flow)` -> `{ head: ['Columns','From','To','Songs'], rows }`, one row per link (column pair names joined with " to ").
  - `topThemePairs(songs, { labels, minN = MIN_PAIR_N, limit = TOP_PAIRS } = {})` -> `{ n, pairs: [{ a, b, aLabel, bLabel, n, share }] }`: `n` = songs with at least one theme; a pair is two distinct codes of one song (counted once per song, `a < b` by code), kept when its count >= `minN`, ordered by `n` desc then labels, `share = pair n / n`.
  - `pairsTable(result)` -> `{ head: ['Theme','With','Songs','Share'], rows }` (share as whole-percent text).

- [ ] **Step 1: Write the failing tests** (`node:test`, fixtures built inline; `labels = { genres:{metal:'Metal',punk:'Punk'}, tone:{...}, act:{...} }`):
  - `buildFlow counts only songs with all three columns` (5 songs, 2 missing a column -> `flow.n === 3`; each column's node counts sum to 3; each `links[k]` sums to 3).
  - `buildFlow folds codes beyond the top six into one Other node` (8 distinct tones -> column 1 has 7 nodes, last `other: true`, its `n` equals the sum of the two smallest).
  - `buildFlow creates no Other node when a column has six or fewer codes`.
  - `buildFlow orders ties by label` (equal counts -> alphabetical; calling twice yields identical output).
  - `buildFlow slots follow firstOrder` (a code at `firstOrder` index 2 gets `slot 2` whatever its slice rank; a code absent from `firstOrder` gets the lowest unused slot; no two column-0 nodes share a slot).
  - `buildFlow with a single genre has one column-0 node` (all songs `g: 'metal'` -> one node, `n === flow.n`).
  - `buildFlow with no eligible songs returns n 0 and empty columns, links and paths`.
  - `buildFlow falls back to a title-cased code when the label is missing` (`'animal_rights'` -> `'Animal Rights'`).
  - `strongestSentence is null below 30 songs and names the top non-Other link at 30+` (assert the sentence contains the from/to labels, the count, and a percentage computed from the data; construct two fixtures).
  - `topPathways never includes Other`.
  - `flowTable has one row per link`.
  - `topThemePairs counts a pair once per song, drops pairs below minN, and orders by count then label` (including a song with a repeated theme code in `thm`, which must not form a pair with itself).
  - `topThemePairs returns an empty pairs list when no pair reaches minN`.
  - `PRESET ids are exactly the three in the spec, in order`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && node --test src/components/explore/data/flowModel.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `flowModel.js`** to the interfaces above (pure ES module, no DOM; import `MIN_GROUP_FOR_SENTENCE` from `./dataModel.js`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && node --test src/components/explore/data/flowModel.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/explore/data/flowModel.js frontend/src/components/explore/data/flowModel.test.js
git commit -F <scratchpad file>   # "feat(data): pure flow and theme-pair model"
```

---

### Task 3: Flow layout geometry, Browse links and the `flow` URL param

**Files:**
- Modify: `frontend/src/components/explore/data/flowModel.js` (add `flowLayout`, `browseSelectionFor`)
- Modify: `frontend/src/utils/dataUrlState.js`
- Test: `flowModel.test.js`, `frontend/src/utils/dataUrlState.test.js` (append)

**Interfaces:**
- Consumes: `buildFlow` output; `applyFilterState`, `EMPTY_FILTERS` from `browseUrlState.js`; existing `browseHref(state, bounds)`.
- Produces:
  - `flowLayout(flow, { width, height, nodeWidth = 14, gap = 10, labelPad })` -> `{ nodes: [{ col, key, label, n, other, slot, x, y, w, h }], ribbons: [{ fromCol, from, to, n, d, thickness }], scale }`. One `scale` (pixels per song) for all columns so equal totals give equal column heights; node `h = n * scale`; nodes in a column are stacked top to bottom in `flow` order with `gap` between and the stack vertically centred; each ribbon is a cubic Bezier centre line from the right edge of its source node to the left edge of its target node with `thickness = n * scale`, attached at stacked offsets inside both nodes (ribbons leave a node in link order, enter in link order), so ribbon thicknesses on a node's right side sum to its `h` and on its left side sum to its `h`. `labelPad` reserves left/right room for node labels. Returns empty `nodes` and `ribbons` for `n === 0` (never NaN).
  - `browseSelectionFor(preset, parts)` -> `{ [browseKey]: [code] }` for the given `parts` (`[{ col, key }]`, Other and missing parts skipped); used with the extended `browseHref`.
  - `dataUrlState.js`: `FLOW_IDS = ['genre-tone-action','audience-frame-action','voice-tone-emotion']`; `deriveDataState` adds `flow` (invalid or absent -> `FLOW_IDS[0]`); `formatDataState` writes `flow` only when not the default; `OWNED` includes `flow`; `browseHref(state, bounds, extra = {})` where `extra` is `{ browseKey: [codes] }` merged into the filters (arrays unioned and de-duplicated with the slice's own `parent_genres`).

- [ ] **Step 1: Write the failing tests.**
  - flowModel: `flowLayout node heights use one scale` (two columns with equal totals have equal stacked heights, within a pixel); `flowLayout ribbon thicknesses sum to each node height on both sides`; `flowLayout keeps every node and ribbon inside the given width and height`; `flowLayout of a single-node column has no NaN anywhere` (JSON of the layout contains no `NaN`/`null` coordinates); `flowLayout of an empty flow is empty`; `browseSelectionFor skips Other` (`[{col:0,key:'metal'},{col:1,key:'other'}]` on preset 1 -> `{ parent_genres:['metal'] }`); a middle-column pick maps to `lyrical_tone`, a third-column pick on preset 1 maps to `actions`.
  - dataUrlState: `flow defaults to the first preset and an invalid value falls back`; `flow round-trips and the default is omitted from the URL`; `formatDataState keeps params it does not own`; `FLOW_IDS equal the PRESETS ids` (imports `PRESETS`); `browseHref with extra codes adds them in Browse vocabulary and keeps the slice years`; `browseHref extra parent_genres is de-duplicated against the slice genre`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && node --test src/components/explore/data/flowModel.test.js src/utils/dataUrlState.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement** `flowLayout`, `browseSelectionFor`, and the `dataUrlState.js` changes to the interfaces above.

- [ ] **Step 4: Run the whole frontend suite**

Run: `cd frontend && node --test`
Expected: all PASS (existing data URL tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/explore/data/flowModel.js frontend/src/components/explore/data/flowModel.test.js frontend/src/utils/dataUrlState.js frontend/src/utils/dataUrlState.test.js
git commit -F <scratchpad file>   # "feat(data): flow layout, Browse links and the flow URL param"
```

---

### Task 4: The Arguments tab (components, route, styles, browser check)

**Files:**
- Create: `frontend/src/components/explore/data/ArgumentsTab.jsx`, `FlowChart.jsx`, `PathwayList.jsx`, `FlowDetail.jsx`, `ThemePairs.jsx`
- Modify: `frontend/src/App.jsx` (route `arguments` inside the `SliceLayout` route, after `over-time`), `frontend/src/pages/DataPage.jsx` (add tab `{ to: 'arguments', label: 'Arguments' }` after Over time; slice tabs keep the current query string so the slice persists between them, Stories carries none), `frontend/src/styles/components.css` (`data-arg-*` classes, tokens only)

**Interfaces:**
- Consumes: outlet context `{ songs, allSongs, labels, state, setState, bounds }` from `SliceLayout`; `ChartFrame` (`title, controls, legend, caption, table, empty, children(width)`), `useWidth`, `flowModel` exports, `browseHref`.
- Produces: the tab at `/explore/data/arguments`.

Behaviour to build (the spec's Goals, restated as checkable rules):
- **Picker:** segmented buttons over `PRESETS` (`aria-pressed`), writing `flow` through `setState({ flow })`.
- **Colour follows the entity:** `firstOrder` is the column-0 code ranking of `buildFlow(allSongs, preset)` (whole catalogue), so a genre or code keeps its colour as the slice changes. Column-0 nodes and their ribbons use `var(--explore-cat-<slot+1>)`; Other uses `var(--explore-not-coded)`; ribbons between columns 1 and 2 are `var(--text-muted)` at low opacity. Node labels use text tokens (never the series colour).
- **Flow caption** (derived): `Based on {n} of {sliceCount} songs in this slice: those with a first-listed code in all three of {col0}, {col1} and {col2}. Each column uses a song's first-listed code.` where `sliceCount` is the slice's song count. Empty slice: `empty` message "No songs in this slice carry all three." and no chart, no sentence.
- **Interaction:** hover or focus a node -> ribbons not touching it fade; hover or focus a ribbon -> tooltip `"{from} to {to}: {n} songs, {p}% of the pathway songs"` (p computed); click or Enter on a node or ribbon pins `FlowDetail` (counts and a "Browse songs" link built with `browseHref(state, bounds, browseSelectionFor(...))` plus the note "Browse counts songs with this code anywhere, not only as the first-listed one."; Other has no link). Nodes and ribbons are `tabIndex=0` with an `aria-label`. The pinned selection is held by preset-independent keys and is cleared when the preset changes.
- **Strongest-link sentence** under the chart from `strongestSentence`, absent when `null`.
- **Phone:** when the measured width is below `PHONE_MAX_WIDTH` render `PathwayList` (top `TOP_PATHS` pathways as `A > B > C`, count, and a bar scaled to the largest) instead of the SVG; selecting a row pins the same `FlowDetail`.
- **Table view:** `flowTable(flow)`.
- **Themes that travel together** card (`ThemePairs`): from `topThemePairs(songs, { labels: labels.thm })`; rows are a label "A + B", a bar, the count and the share; caption `Based on {n} theme-coded songs in this slice. A pair is counted once per song. Pairs with fewer than {MIN_PAIR_N} songs are left out.`; each row links to Browse with both theme codes (`browseSelectionFor`-style `{ themes: [a, b] }`; Browse ANDs individual codes within a dimension, confirmed in `analysis.facetSelectionClauses`), with the same "anywhere" note once under the list; the card is absent when no pair qualifies; Table view via `pairsTable`.

- [ ] **Step 1: Re-validate the palette.** Run the dataviz `scripts/validate_palette.js` on the six `--explore-cat-1..6` values plus `--explore-not-coded` (values in `components.css` ~line 2544) in dark mode against the chart surface `--bg-surface`; record the output in the commit message. Expected: no FAIL (the set is already validated for the map). If it FAILs for the grey-against-hues pair, stop and report; do not invent colours.

- [ ] **Step 2: Build the five components, route, tab entry and CSS** to the behaviour above. Hand-rolled SVG only; every colour a token; `useWidth` drives the phone switch.

- [ ] **Step 3: Static checks**

Run: `cd frontend && node --test && npm run lint && npm run build`
Expected: all tests PASS, lint 0 errors (4 pre-existing warnings), build succeeds.

- [ ] **Step 4: Browser check** (Chrome via the extension, dev servers on :5173 and :5000; if the page shows a stale blank, touch the edited file and reload). Confirm and note each:
  1. `/explore/data/arguments` shows after Over time in the tab row and the slice bar is present; switching to Over time and back keeps `pg`/`yf`/`yt`.
  2. The three presets switch and `flow` appears in the URL (default omitted); reload keeps it; `?flow=bogus` shows the first preset.
  3. Flow draws three columns, six nodes plus grey Other, colours only on column 0, labels readable, caption denominator matches the Table view total.
  4. Hover a node fades others; hover a ribbon shows the tooltip; click pins the detail line with a Browse link; the link lands on Browse with the expected filter (check one for each preset, and that Other has no link).
  5. The strongest-link sentence appears and its numbers match the Table view; pick a narrow slice (one genre, a short year range) and confirm it disappears below 30 songs and the empty message shows when nothing qualifies.
  6. Themes card: top pairs match the recon (animal suffering + slaughter first, 61 songs, in the full slice); a pair link lists songs carrying both themes.
  7. Resize to 390 px: the list replaces the SVG, the pinned selection survives the swap, no horizontal overflow, tabs scroll.
  8. No console errors; `prefers-reduced-motion` not needed (no animation).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/explore/data/ArgumentsTab.jsx frontend/src/components/explore/data/FlowChart.jsx frontend/src/components/explore/data/PathwayList.jsx frontend/src/components/explore/data/FlowDetail.jsx frontend/src/components/explore/data/ThemePairs.jsx frontend/src/App.jsx frontend/src/pages/DataPage.jsx frontend/src/styles/components.css
git commit -F <scratchpad file>   # "feat(data): Arguments tab (flow and theme pairs)"
```

---

### Task 5: Docs, verification and hand-off

**Files:**
- Modify: `CLAUDE.md` (dataset service payload fields; Arguments frontend line), `docs/PROJECT_STATE.md` (Current State, Next Tasks with the smoke steps, Decision Log for the author's calls, Changelog), `docs/PROJECT_PLAN.md` (Explore > Data redesign section: phase 2 marked built/awaiting smoke), `docs/PRD.md` (inventory row `/explore/data/arguments`)

- [ ] **Step 1: Update the docs** to describe what was built (payload fields `aud`, `frm`, `act`, `emo`, `avoc`, `thm` and the first-valid-code rule; `flowModel.js`; the `flow` URL param; the Browse "anywhere" caveat; the thin Advocacy action coverage stated in captions), keeping their existing style (newest first in Decision Log and Changelog; prepend a Current State bullet). Insert with a Python script that preserves line endings and asserts each anchor is unique; check `git diff` shows only added lines and no mojibake.

- [ ] **Step 2: Full verification**

Run: `cd backend && node --test --test-concurrency=1` then `cd frontend && node --test && npm run lint && npm run build`
Expected: all green; record the counts.

- [ ] **Step 3: Commit and push the branch**

```bash
git add CLAUDE.md docs/PROJECT_STATE.md docs/PROJECT_PLAN.md docs/PRD.md
git commit -F <scratchpad file>   # "docs: Data > Arguments (state, plan, PRD, CLAUDE.md)"
git push -u origin session-data-arguments
```

- [ ] **Step 4: Hand off.** Write the curator's smoke steps in chat (not only a pointer to PROJECT_STATE.md), then wait for "Merge". Do not merge before it.
