# Explore > Data > Arguments - design (phase 2 of the Data redesign)

Status: draft for the curator's review (2026-11-22). Extends `2026-11-22-explore-data-redesign-design.md` (the approved parent spec: "Arguments: a three-column flow, preset pathways, plus Themes that travel together"). Everything the parent spec already settles is not repeated; this document settles what the real data forced and how the tab is built. Curator decisions are marked; everything else is the author's call and is listed at the end.

## Intent

Show visitors **how songs argue for animals**: which genres, audiences and voices lead to which tones, moral frames and calls to action, and which themes keep turning up together. It is the second Data tab (after Over time), built the same way: hand-rolled SVG, tokens only, pure tested logic, every chart stating its denominator, every chart with a Table view.

## Decided by the curator

1. **A song counts under its first-listed code only** in each flow column (the spec's "primary code"). A song with several moral frames, emotions or actions is placed by the first one, so a flow's totals add up to the number of songs in it. The caption says the song count and that columns use each song's first-listed code.
2. (Parent spec, unchanged) three presets, "Themes that travel together", click-throughs go to Browse (no song drawer), top 6 nodes per column plus a grey "Other", phone shows a ranked list instead of ribbons.

## What the data forces (checked against the live catalogue, 672 lyric-coded songs)

- **Advocacy action is coded on only 253 songs (38%)**, so the two presets that end in it rest on about 250 songs; the Vocal style > Tone > Emotion preset rests on most of the catalogue. Presets keep the parent spec's order, and each caption states its own denominator ("based on N of M songs in this slice: those with all three").
- "First-listed" is positional: nothing in the data says the first code is the most prominent. The page words it as "first-listed code", never "main" or "primary" in public copy.
- The strongest theme pairs today are animal suffering + slaughter (61 songs), animal suffering + captivity (49), commodification + slaughter (44).

## Goals

- The **Arguments** tab at `/explore/data/arguments` (a tab appears only once built; this build adds it after Over time).
- A **pathway picker** (segmented control) over three presets, each a three-column flow:
  - `genre-tone-action`: Genre > Lyrical tone > Advocacy action
  - `audience-frame-action`: Speaking to > Moral frame > Advocacy action
  - `voice-tone-emotion`: Vocal style > Lyrical tone > Emotion
- The **flow chart**: per column the top 6 codes by song count plus an "Other" node (grey, `--explore-not-coded`); node height is its song count; ribbons between adjacent columns are weighted by exact song count. Only songs carrying a code in all three columns are in the flow. The slice bar (genre, years) applies as everywhere.
- **Interaction:** hover or focus a node to fade every ribbon not touching it; hover a ribbon for a tooltip ("Metal > Defiant: 23 songs, 9% of the pathway songs"); click or press Enter on a node or ribbon to pin a detail line under the chart with its counts and a "Browse songs" link. Nodes and ribbons are keyboard-focusable.
- **Strongest-link sentence** under the chart, only when the flow has at least `MIN_GROUP_FOR_SENTENCE` (30) songs, built from the data ("Strongest link, Genre to Tone: Metal to Defiant, 23 songs (9% of the pathway songs)"). Never typed text (derived-values rule).
- **Themes that travel together:** a ranked list of the 10 most frequent theme pairs in the slice (pairs counted over each song's full set of theme codes, once per song), each row a bar, a count and its share of the slice's theme-coded songs; pairs with fewer than `MIN_PAIR_N` (3) songs are dropped; if none remain the card is absent. Each row links to Browse for its two themes (see Verification).
- **Colour:** first column only (`--explore-cat-1..6`, Other grey); ribbons between columns 1 and 2 take their source node's colour; ribbons between columns 2 and 3 are neutral (`--text-muted`, low opacity) because a column-2 node mixes several first-column colours. The dataviz palette validator is run on the six-plus-grey set (already validated for the map; re-run, do not invent).
- **Phone** (below the width where ribbons cannot be read, a named constant): the SVG is replaced by a ranked list of the top 10 full pathways (A > B > C, count, bar) plus the same detail and Browse links.
- **Table view** on both cards: for the flow, one row per ribbon (Column pair, From, To, Songs); for pairs, Theme A, Theme B, Songs, Share.
- URL state through `dataUrlState.js`: `flow=<preset id>` (invalid or absent = the first preset), alongside the existing `pg`, `yf`, `yt`.

## Non-goals

- No song drawer, no multi-code (weighted or fractional) counting, no custom column builder, no per-song lyric or evidence text, no AI-detected languages.
- No sentence about a pair, node or link unless backed by the data at that moment (derived-values rule from the Stories work).
- No new tab for Stories-style narrative; stories may later reuse the new datasets.

## Anti-goals (a failure even if it runs)

- A flow whose ribbon or node totals disagree with its stated song count.
- A "Browse songs" link that quietly lists a different set than the one clicked, with no note.
- A confident sentence from a handful of songs, or any figure typed by hand.
- A tab that is a wall of ribbons on a phone.

## Constraints

- **Privacy:** the dataset payload carries codes only. It never carries an `evidence` string, lyric text, transcript text or audio samples; `lyrics_privacy.test.js` already scans `services/dataset.js` and the route, and a new dataset test asserts no `evidence` key anywhere in the payload.
- **Live songs only; lyric fields only through `analysis.LATEST_ANALYSIS`** (junk and stale gates); vocal style only through `audioAnalysis.LATEST_AUDIO`; every code gated by its codebook/taxonomy (`metadataCodebook.cleanSelection`, `acousticCodebook.cleanSelection`, the taxonomy gate `analysis.mapDim` uses). **First-listed means first valid code after gating**: a hidden or unknown code (e.g. an absence code) at position 0 is dropped, not counted.
- **Payload:** new fields are added only because this tab uses them: `aud` (speaking-to code), `frm` (first moral frame), `act` (first advocacy action), `emo` (first emotion), `avoc` (first vocal style), `thm` (all theme codes, gated, in listed order, no duplicates). Matching label dictionaries join `labels`. Payload growth is measured and reported (target: still a few hundred KB uncompressed, under 150 ms uncached).
- **Tokens only; no emojis; labels from the codebooks and taxonomy.** No `localhost:5000`.
- **Architecture:** pure DOM-free modules in `dataModel.js` (or a sibling `flowModel.js` if it grows) tested with `node --test`: `buildFlow(songs, preset, labels)` (eligibility, first-listed columns, top 6 + Other, node and link counts), `flowLayout(flow, size)` (node heights, ribbon Bezier paths), `topThemePairs(songs, labels)`, plus `flow` in `dataUrlState.js`. SVG components stay thin.

## Verification items for the plan (facts to confirm, not curator questions)

- How Browse combines **two codes in the same dimension** (themes): the pair link is only offered if it lists songs carrying both; if Browse treats them as either, the pair rows get no link (rather than an overstated one).
- A Browse link built from a flow node or ribbon uses `browseUrlState` vocabulary only (`parent_genres`, `lyrical_tone`, `actions`, `moral_frames`, `target_audience`, `emotions`, `vocal_style`, `themes`), and the detail line says Browse counts songs with a code anywhere, not only as the first-listed one.
- The audio `vocal_style` array order is the stored order of the latest OK row.

## Left to the builder

SVG geometry (node padding, ribbon curvature, label placement), node ordering within a column (by count, or reordered to cut crossings), tooltip behaviour, the phone breakpoint value, wording of captions within the rules above, whether `flowModel.js` is split from `dataModel.js`.

## The author's calls (for the curator to check)

"First-listed" public wording; first valid code after gating; presets keep the parent spec's order even though two end in the thinly coded Advocacy action; ribbons beyond column 2 are neutral; a pair needs at least 3 songs and a sentence at least 30; the top-10 pairs and top-10 phone pathways; the strongest-link sentence is the only generated sentence; the pair link is conditional on Browse semantics; only the six fields listed are added to the payload.
