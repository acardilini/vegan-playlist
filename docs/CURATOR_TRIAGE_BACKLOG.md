# Curator Triage Backlog

_Curator-reported issues, triaged and tracked for future sessions. Newest triage first._
_See [`PROJECT_STATE.md`](./PROJECT_STATE.md) for current phase/session and the decision log._

---

## Triage — 2026-07-20 (reviewed 2026-07-20)

A batch of curator-noticed issues. **Fixes Round 1** (branch `session-fixes-round-1`, merged to
`main`) resolved the data-integrity + a few UX items; the rest are captured below for future
rounds. Each item notes the **root cause** found during review so a future session can pick it
up cold.

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

**Featured songs** _(→ "featured-songs redesign" round)_
- **How featured songs are determined / the missing "select feature" option.** Root cause found:
  `GET /api/spotify/songs/featured` returns songs with `songs.featured = true` (currently **2** songs,
  ordered by `playlist_added_at DESC`), then **fills the remaining slots up to 4 with random**
  included+published songs — hence "two always show, the rest look random." The `featured` DB column
  and backend still work, but **there is no admin UI to set it anymore** — the Phase 4 admin rebuild
  deleted the old Manage Songs tab (which had the featured toggle) and no control replaced it
  (confirmed: no `featured` reference anywhere in `frontend/src/components/admin/`). **Decision needed:**
  the featured model (curated pins vs. rotation vs. hybrid) + restore a pin control (natural home: the
  workbench top bar or Details panel).
- **Chip in the top-left of some featured cards but not all.** Root cause: that chip is the
  **MoodBadge** (`SongCard.jsx` → `.mood-badge-overlay`), which renders only when the song has a mood
  (~654 of ~1,800 songs). It's the same on every song card, not just featured — it just looks
  featured-specific. **Decision needed:** consistent treatment (always show a placeholder, or only when
  present, or drop it).
- **Date-added shown on some cards but not all.** Root cause: `SongCard` shows
  `song.playlist_added_at` when present; only songs that came from the Spotify playlist have it — the
  ~534 Apr-2026 batch and manual-only songs don't. **Decision needed:** fall back to `date_added`
  (import date), or show nothing, consistently.

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
- **Persist sort & filter state across navigation.** On the homepage, moving to another page and
  coming back **resets** the sort + all active filters. The curator wants the browse state maintained
  for the duration of the visit. Root cause: `SearchAndFilter` holds filter/sort in component
  `useState` that unmounts on navigation. Fix: lift the state to persist across route changes
  (e.g. URL query params — also makes browse states shareable/bookmarkable — or a shared store /
  `sessionStorage`). URL-param approach is preferred (shareable + back-button friendly).
- **Filter sidebar won't scroll until the page bottom.** The sidebar is sticky and only the results
  column scrolls; the curator wants to scroll the sidebar independently at any time. Root cause:
  sticky `.browse-sidebar` with no independent scroll region. Fix: give the sidebar its own
  `overflow-y:auto` + a bounded height (e.g. `max-height: calc(100vh - <header>)`), or make it a
  non-sticky column.
- **Bidirectional sort.** The Sort-by select has 4 options (Title / Artist / Year / Date added), each
  **single-direction** only. Curator wants both directions (A–Z / Z–A, Newest / Oldest). Needs a
  direction toggle in the UI + an `order`/`dir` param threaded through `/search` (backend
  `services/browseFilters` / the `/search` ORDER BY).

**Admin song dashboard** _(→ workbench / lyrics enhancements)_
- **Add a lyrics highlight from the English translation.** Today the highlights picker
  (`+ Add selection`) works only on the main lyrics textarea. Curator wants to select-and-add from the
  translation field too.
- **Multiple / bilingual languages.** Some songs are bilingual; the curator wants to record more than
  one language for `songs.language` (e.g. semicolon-separated). Needs a UI + storage/display decision
  (multi-value language on the workbench Details panel and song page).

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
