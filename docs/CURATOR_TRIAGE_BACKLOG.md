# Curator Triage Backlog

_Curator-reported issues, triaged and tracked for future sessions. Newest triage first._
_See [`PROJECT_STATE.md`](./PROJECT_STATE.md) for current phase/session and the decision log._

---

## Triage — 2026-07-20 (reviewed 2026-07-20)

A batch of curator-noticed issues. **Fixes Round 1** (branch `session-fixes-round-1`, merged to
`main`) resolved the data-integrity + a few UX items; the rest are captured below for future
rounds. Each item notes the **root cause** found during review so a future session can pick it
up cold.

**Order (reprioritised 2026-07-20 by curator):** the unresolved items run **before B4** in this
sequence — **1** `key_focus_pipeline` split-read + scalar-attribute filters → **2** persist browse
state → **3** featured redesign → **4** browse/search polish (sidebar scroll + bidirectional sort) →
**5** lyric highlights from translation + multi-language → **B4** Explore map (with vector "You might
also like") → **6** About analysis-explainer + AI disclosure.

### ✅ Resolved (Fixes Round 1)

- **Admin — editing lyrics stripped the lyrics URL** (also on `+ Add selection`). Fixed:
  `saveLyrics` now writes only the fields provided, so a lyrics-only save no longer null-clobbers
  `source_url`/`translation`; clearing lyrics keeps the row (`lyrics=''`).
- **Admin — Park → "listened – unclear" didn't reflect after selection.** Fixed: the workbench Park
  control is now controlled (reflects/persists the chosen reason); `setProcessing` writes only
  provided fields (was clobbering park/snooze/note).
- **Data quality — false duplicates (same title, different band).** Fixed: duplicate detector now
  gates on **title AND artist** (`services/duplicates.js`), plus a persistent whole-group
  **"Not a duplicate"** reject (migration 008 `duplicate_dismissals`).
- **General admin — couldn't search the full catalogue to fix data** (e.g. song/1
  "Some of My Best Friends Are Meat Eaters" had a Rick Astley video). Fixed: admin Songs area has an
  **"All songs"** scope reaching any song regardless of status; curator corrected song 1's video.
- **"Sort by" overlapping the search field.** Fixed (curator-confirmed 2026-07-20) — Fixes Round 1
  moved Sort-by onto the same row, pinned right of the search input.

### ☐ Unresolved — captured for future rounds

**Featured songs** — ✅ **RESOLVED (triage 3, 2026-07-21 — merged `6718cec`; ⚠ pending curator smoke)**
- ✅ **How featured songs are determined / the missing "select feature" option.** Featured is now
  curated pins with a **deterministic recency fill** (`ORDER BY COALESCE(playlist_added_at, date_added)
  DESC`) instead of random-from-catalogue, and the pinned query **cycles a random 4 when >4 are pinned**
  (`ORDER BY RANDOM() LIMIT 4`). Restored a **"Featured" toggle** in the workbench top bar
  (`curation.setFeatured` + `POST /songs/:id/feature|unfeature`; `getWorkbench` returns `featured`).
- ✅ **Chip in the top-left of some cards but not all (MoodBadge).** Decision: **keep as-is** — it's real
  metadata that shows only when `custom_mood` exists; not a bug. No code change.
- ✅ **Date-added shown on some cards but not all.** Decision: **drop the added-date from `SongCard`**
  entirely (uniform across all card surfaces), rather than a fallback.
- ✅ **Follow-up — hard to see which songs are Featured (triage 3b, 2026-07-21, built on
  `session-triage-3b-featured-manage`, pending merge).** From the triage-3 smoke: added an admin **Featured
  scope** (rail + count + Dashboard tile) that lists all featured songs with a **quick Unfeature** button,
  plus a **Featured badge** on rows in any scope — so the featured set is visible and rotatable without
  opening each workbench. Unfeature-only (turning on stays in the workbench).

**Filter & search** _(→ "browse/search polish" round)_
- **Filter by the lyrical-analysis attribute dimensions.** _(curator clarified 2026-07-20)_ The
  browse sidebar's "Themes & advocacy" facet tree already covers the **five code dimensions**
  (themes / targets / actions / tactics / moral frames). What's **missing** is filtering by the **six
  scalar attributes** shown in the song page's Lyrical Analysis section: **Perspective, Tone,
  Intensity, Clarity, Focus, Emotions**. Root cause: `getSongAnalysis` already *reads and displays*
  these columns (`perspective`, `lyrical_tone`, `intensity`, `clarity`, `focus_amount`, `emotions` in
  `song_lyric_analysis`) but there is **no facet/filter** for them. Needs: facet counts + filter
  clauses for each attribute (enum-valued, from `taxonomy.json`) wired into `/api/spotify/browse-facets`,
  `services/browseFilters`, and the sidebar UI. Allowed values per attribute are in the **key-focus
  data-update section below** (Reference — the six scalar metadata components). **These attributes live
  in `gemma4:deep_pipeline`** (not key-focus), so their facets/filters must read the **deep** tier —
  coordinate with the split-read switch below.
- ✅ **RESOLVED (triage 2, 2026-07-20 — built on `session-triage-2-browse-state`, pending merge).**
  **Persist sort & filter state across navigation.** On the homepage, moving to another page and
  coming back **reset** the sort + all active filters (root cause: `SearchAndFilter` held filter/sort in
  component `useState` that unmounts on navigation). Fixed by making the URL query string the single
  source of truth — hydrate-on-mount + mirror-on-change (`useSearchParams`, `replace`), new pure
  `utils/browseUrlState.js`; page persisted via a disjoint second writer. Shareable/bookmarkable.
  Headless smoke 10/10.
- ✅ **RESOLVED (triage 4, 2026-07-21 — built on `session-triage-4-browse-polish`, pending merge).**
  **Filter sidebar won't scroll until the page bottom.** Fixed: `.browse-sidebar` gets
  `max-height: calc(100vh - space-4*2)` + `overflow-y:auto`, so it scrolls internally while staying pinned.
- ✅ **RESOLVED (triage 4, 2026-07-21 — built on `session-triage-4-browse-polish`, pending merge).**
  **Bidirectional sort.** Fixed: a whitelisted `dir` (`asc`/`desc`) param threaded through the URL →
  `/search`, via a pure `browseFilters.buildOrderBy(sort_by, dir)`; a UI direction toggle with contextual
  labels (A–Z/Z–A, Oldest/Newest) that resets on sort-field change; `dir` persisted in the URL.

**Admin song dashboard** _(→ workbench / lyrics enhancements)_ — ✅ **RESOLVED (triage 5, 2026-07-23 —
built + fully reviewed on `session-triage-5-translation-highlights-multilang`; ⚠ awaiting curator smoke + merge)**
- ✅ **Add a lyrics highlight from the English translation.** Done: the workbench Lyrics panel's
  Translation field gets its own **"+ Add selection"** button (disabled until a translation is saved).
  Highlights stay a **flat** newline-joined list — no pairing, no per-line tag, no schema change (curator
  decision).
- ✅ **Multiple / bilingual languages.** Done: `songs.language` migrated **`VARCHAR(40)` → `text[]`**
  (migration 009; the 38 existing values converted, the `Mouri`→`Māori` typo fixed). The workbench
  Details field is now a **chip editor** (removable chips, add-on-Enter, one-click suggestions from a new
  read-only `GET /api/admin/languages`); the browse Language facet `unnest`s so a bilingual song counts
  under **each** of its languages and the `&&` filter finds it under either; the public song page shows a
  **"Sung in"** hero cell. Chose a real array over the semicolon-string option (parsing lives in one
  place, no phantom-language typos). Backend 130/130; final opus whole-branch review **READY TO MERGE**
  (0 Critical/0 Important). Spec/plan:
  [`specs/2026-07-23-triage-5-translation-highlights-and-multi-language-design.md`](./superpowers/specs/2026-07-23-triage-5-translation-highlights-and-multi-language-design.md),
  [`plans/2026-07-23-triage-5-translation-highlights-and-multi-language.md`](./superpowers/plans/2026-07-23-triage-5-translation-highlights-and-multi-language.md).

**About / transparency** _(→ "About / AI-disclosure page" round)_
- **New page explaining the analysis** — what types of analysis we do (thematic taxonomy, vector
  spaces, moods/genres) and **how** they're produced.
- **AI-use disclosure** — disclose where AI is used in the analysis (the `gemma4:latest` lyric coding,
  embeddings, etc.).

**Song pages** _(→ B4 / vector work)_
- **"You might also like" determination.** Root cause: `GET /api/spotify/songs/:id/similar` currently
  matches on **genre + audio features (energy/danceability/valence)** — but audio features are **NULL
  for every song** (dropped in Phase 0, unobtainable from Spotify), so it's effectively genre-only.
  Curator's instinct is right: move this to **vector similarity** (`song_embeddings` / `vector_space.json`)
  as part of the B4 vector work.

---

## Data update — 2-stage qualitative coding (`key_focus_pipeline`) — 2026-07-20

> **☑ RESOLVED 2026-07-22 — and the analysis below is superseded by the data itself.** The curator's
> reanalysis added a new tier, `gemini-3.5-flash-lite`, carrying all seven scalar components as clean
> codebook enums (`backend/data/master_metadata_codebook.json`), and the site now reads **two** tiers:
> code dimensions from `gemma4:key_focus_pipeline`, scalars from `gemini-3.5-flash-lite`. The
> `deep_pipeline` scalar premise below is obsolete (its scalars were free-text, and identical to
> key-focus's). **Item 1b — "filter by lyrical analysis" — shipped with it**: all seven components are
> now browse filters. See
> [`specs/2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters-design.md`](./superpowers/specs/2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters-design.md).
> The section is kept as the record of what the handoff assumed.

_Supersedes the terse "thematic `key_focus_pipeline` switch" backlog line. Handoff received from
the analysis pipeline; goal: **surface the refined "key focus" analysis on the website.**_

### What changed in the data
The `song_lyric_analysis` table now holds **two analysis tiers**, distinguished by the `model_used`
column (the site currently reads a third, older value — see below):

| Tier | `model_used` | Purpose | Codes per dimension |
|---|---|---|---|
| Stage 1 — Deep | `gemma4:deep_pipeline` | Exhaustive exploratory coding: every mentioned concept, analogy, quote, background reference (672 songs) | many (10+) |
| Stage 2 — Key focus **(use for site)** | `gemma4:key_focus_pipeline` | Refined: strictly **1–3 primary codes per dimension** — what the song is actually *about*; filters out side comparisons / figures of speech / passing mentions | 1–3 |

**The two tiers split by data type** _(curator-confirmed 2026-07-20)_:
- The **five code dimensions** (`topics`=Targets, `advocacy`=Actions, `tactics`, `moral_frames`,
  `themes`) — JSONB arrays of `{code, evidence}` — exist in **both** tiers; the site should read the
  **refined key-focus** version.
- The **six scalar metadata components** (`perspective`, `lyrical_tone`, `intensity`, `clarity`,
  `focus_amount`, `emotions`) live **only in `gemma4:deep_pipeline`** — the key-focus rows do **not**
  carry them. So the site must read scalars from the **deep** tier.

DB→taxonomy mapping is unchanged and already handled in code; all `code` strings match
`taxonomy.json` ids. `explanation` = focus reasoning.

### The core change — a SPLIT read, not a one-constant flip
`backend/services/analysis.js` currently reads everything from one model via
**`DEFAULT_MODEL = 'gemma4:latest'`** (line 6): song-page analysis (`getSongAnalysis`), browse facet
tree + counts (`facetTree`), `/search` facet filtering (`facetFilterConditions`), the workbench
Analysis panel, and `vegan-themes`. Because the two tiers now split by data type, this must become a
**two-source read**:
- **Code dimensions** (facet tree, `/search`, `vegan-themes`, the chips on the song page) →
  `gemma4:key_focus_pipeline`.
- **Six scalar metadata components** (the song page's Perspective/Tone/Intensity/Clarity/Focus/Emotions
  block, and their future browse filters) → `gemma4:deep_pipeline`.

`getSongAnalysis` currently pulls both code dims + scalars from one row (one query, one `model_used`);
it will need to read the code dims from the key-focus row and the scalars from the deep row (two
queries, or one join keyed on `song_id` with the two `model_used` values) and merge.

### Work to scope
1. **Split `getSongAnalysis`** to read code dims (key-focus) + scalars (deep) and merge.
2. **Repoint the code-dimension consumers** (`facetTree`, `facetFilterConditions`, `vegan-themes`,
   workbench Analysis panel) to `gemma4:key_focus_pipeline`.
3. **Coverage / counts will shift** (`gemma4:latest` ≈ 685 → key-focus 672). Curator notes this is
   likely from recent playlist edits, not a concern — just re-check the "Has lyrics analysis" count,
   facet rollups, `vegan-themes`, and the workbench "needs-analysis" queue after the switch.
4. ~~Deep-dive view~~ **Not needed** (curator confirmed 2026-07-20) — no exhaustive-quote view; the
   deep tier is used only as the source for the six scalar metadata components.

### Why it matters
Clean, high-precision tags on cards/badges/filters (1–3 focused codes instead of 10+), analogy/satire
noise filtered out of the primary tags, and accurate filtering (e.g. *Species: Whales* returns songs
genuinely about whales, not passing mentions).

### Reference — the six scalar metadata components (allowed values)
_Source for the scalar-attribute browse filters (§"Filter & search") **and** the analysis-explainer
About page. Values should match `taxonomy.json` (`perspectives` / `lyrical_tones` / `intensity_levels`
/ `clarity_levels` / `focus_amount` / `emotions`)._

- **Perspective** (`perspective`) — narrative point-of-view:
  `first_person_activist` (advocate's direct voice), `animal_pov` (an exploited animal's voice),
  `human_observer` (third-person observation of society), `metaphorical_symbolic` (allegory/fable),
  `philosophical_abstract` (conceptual ethical discourse, no character narrator).
- **Lyrical Tone** (`lyrical_tone`) — emotional delivery / rhetorical posture:
  `confrontational_militant`, `mourning_elegiac`, `didactic_educational`, `satirical_ironical`,
  `narrative_storytelling`, `utopian_visionary`.
- **Intensity** (`intensity`) — energy / level of confrontation:
  `high_confrontational`, `moderate_appeal`, `gentle_implicit`.
- **Clarity** (`clarity`) — how explicitly it names animal exploitation:
  `highly_explicit`, `subtle_metaphorical`, `implicit_empathy`.
- **Focus Amount** (`focus_amount`) — how central animal advocacy is:
  `central_focus`, `major_theme`, `minor_mention`.
- **Emotions** (`emotions`) — **multi-value** array of affective states, e.g.:
  `anger_indignation`, `grief_sorrow`, `hope_determination`, `disgust_revulsion`,
  `compassion_empathy`, `defiance_rebellion`.
