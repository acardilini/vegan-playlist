# The Vegan Playlist — Project State

_This is the **living document**. Read it at the start of every session; update it at the end._
_See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full roadmap._

---

## Current State

- **Phase:** **Phase 4 — Admin Rebuild (in progress).** Phases 0–3 complete (Phase 3 —
  Brand & UI Rebuild merged 2026-07-12, merge `48a4529`). Deployment Hardening moved to
  **Phase 5**.
- **Current session:** _**Triage 1a + 1b (2026-07-22) — two-tier analysis read + scalar browse filters —
  DONE, merged to `main` (merge `a6eb05a`), curator-smoke-confirmed.** Merged main re-verified: backend
  **114/114**, frontend build clean. The curator's smoke confirmed labels, filter behaviour, both sidebar
  counts and the admin surfaces; its two follow-ups (uniform collapsible sidebar sections with
  descriptions, and faster tooltips) were **not** treated as defects but specced and planned as a separate
  presentation batch — see Next session. The DB-cleaning gate
  that parked triage 1a is **resolved**: the curator's reanalysis added `gemini-3.5-flash-lite` (679 rows /
  661 live), whose seven scalar components are **100% valid codebook enums** (0 unknown values), alongside a
  vendored `backend/data/master_metadata_codebook.json`. That made the work a **genuine two-tier split** —
  code dimensions from `gemma4:key_focus_pipeline`, scalars from `gemini-3.5-flash-lite` — and **un-deferred
  item 1b**, which the 2026-07-20 spec had kicked back to the pipeline as unbuildable on free-text scalars.
  Shipped: `DEFAULT_MODEL` split into `CODE_MODEL`/`SCALAR_MODEL` (removed, not aliased, so every consumer
  states its tier); a new pure `services/metadataCodebook.js`; `getSongAnalysis` reading both tiers in one
  query (returns whatever exists — 613 live songs have both, 4 code-only, 48 scalar-only); **all seven
  components as browse filters** (OR within a component, AND across) with exclude-self counts via
  `analysis.scalarFacets` + a `scalar_facets` block on `/browse-facets`; seven collapsed sidebar groups
  riding the existing URL/sessionStorage state; the song-page attributes card gaining an **Audience** row,
  codebook labels and definition tooltips. **"Has analysis" is now either-tier: 640 → 665 live songs** —
  a net figure, not a pure gain: **+32 songs gain a section and 7 lose one** (they had a `gemma4:latest`
  row but are in neither new tier). The final review checked all seven: every one is an empty row — zero
  codes in all five dimensions, explanation _"No lyrics were provided for analysis."_ — so their
  disappearance is a correction, not a loss (ids 4846, 5493, 5539, 5540, 5541, 5570, 5571).
  Backend **114/114**; frontend lint/build clean; live puppeteer smoke on the sidebar (129→203 OR, →87 AND)
  and on all three coverage cases of the song page. Prior session: **Triage 3b (Featured management view) —
  DONE, merged to
  `main` (merge `f3936b1`), curator-confirmed working** (branch `session-triage-3b-featured-manage`; a
  follow-up to triage 3 from the curator's
  smoke): a **"Featured" scope** in the admin Songs area (rail item + count + Dashboard tile) listing every
  `featured=true` song, each with a **quick "Unfeature" button** (reuses `POST /songs/:id/unfeature`), plus
  a **Featured badge** on rows in any scope — so the curator can see the whole featured set and rotate it
  without opening each workbench (curator chose unfeature-only; turning on stays in the workbench). Backend
  **90/90** (new featured-queue test); backend API smoke all-pass (counts/scope/row-field/unfeature/badge
  on a temp :5001, original featured set restored); admin UI click-through left for curator smoke.
  **Triage 3 (featured-songs redesign) — DONE, merged to
  `main` (merge `6718cec`), curator-confirmed working** (smoke-tested with triage 3b): featured model is
  now curated pins with a
  deterministic recency fill (`ORDER BY COALESCE(playlist_added_at, date_added) DESC`) instead of
  random-from-catalogue, and **cycles a random 4 when >4 are pinned** (pinned query `ORDER BY RANDOM()
  LIMIT 4`); restored a **"Featured" toggle** in the workbench top bar (`curation.setFeatured` +
  `POST /songs/:id/feature|unfeature`, mirroring publish/unpublish; `getWorkbench` returns `featured`);
  **dropped the inconsistent added-date from `SongCard`** (mood chip kept as-is per decision). Backend
  **89/89** (new `setFeatured` node:test); featured-endpoint + routes smoke all-pass (ran a temp backend
  on :5001 against the same DB, original featured set restored); card-date puppeteer check 0/24. **Triage
  1a (`key_focus_pipeline` adoption) — spec + plan written, EXECUTION
  PARKED** pending the curator's DB-cleaning signal (branch `session-triage-1a-key-focus`; spec+plan
  `faf1818`/`0e15bc9`). A pre-design DB check invalidated the handoff's premises: the six scalars are
  populated **identically across all tiers** and are **free-text, not the taxonomy enums**
  (intensity/focus_amount **0/637** match) — so the planned two-tier "split read" is **unnecessary**
  (key_focus already carries everything) and the **scalar browse filters (1b) can't be built as
  specced** (deferred + kicked to the analysis pipeline). Scope narrowed to a one-constant flip
  `analysis.DEFAULT_MODEL` → `gemma4:key_focus_pipeline` (clean 1–3 codes/dim; the code dims are
  near-perfectly clean in key_focus vs noisy prompt-leak codes in `gemma4:latest`; ~23 live songs lose
  their analysis section, no fallback — accepted). **Triage 2 (persist browse state) — DONE, merged to
  `main` (merge `bf2f1da`), curator-confirmed:** homepage browse filters/sort/search/page now live in the
  URL (react-router v7 `useSearchParams`; hydrate-on-mount + mirror-on-change with `replace`; new pure
  `utils/browseUrlState.js`) — shareable/bookmarkable — with a **sessionStorage layer under the URL** so a
  param-less nav to `/` (the Home link/site title) restores the last browse state (curator-caught).
  Headless (puppeteer) smoke **15/15**; caught + fixed a StrictMode page-reset bug (value-signature ref).
  Also committed a refreshed `vector_space.json` (key-focus coding, B4 input, `2a22e37`). Prior: Fixes
  Round 1 merged to `main` 2026-07-20 (merge `2a07339`)._
- **✅ NO BRANCHES PENDING — the whole triage backlog 1–4 is merged and curator-confirmed.** Triage 4
  (browse/search polish) merged 2026-07-22 (`d3887ad`) and was smoke-confirmed on all three checks
  (direction toggle, independent sidebar scroll, and the two branches coexisting). It could not be
  smoked from `main` — it wasn't there — so rather than smoke a stale branch the merge was prepared on
  an integration branch and the curator smoked **exactly what landed**; `main` then fast-forwarded.
  The three conflicts were all **additive, resolved by keeping both sides**:
  `frontend/src/utils/browseUrlState.js` (triage 4's `dir` string key alongside 1a+1b's seven array
  keys), `backend/test/browseFilters.test.js` (both suites appended), and this file.
  `SearchAndFilter.jsx` and `components.css` auto-merged. Merged `main`: backend **117/117**, lint 0
  errors, build clean. Branches `session-triage-4-browse-polish`, `session-triage-1a1b-analysis-tiers`
  and `integration-triage-4` deleted (local + remote).
- **⚠ PENDING CURATOR SMOKE — the filter/analysis presentation batch**, BUILT on
  **`session-presentation-polish`** (pushed, unmerged; all six tasks done, backend 121/121, lint/build
  clean). It is the follow-up to the curator's 1a+1b smoke: eight uniform collapsible sidebar sections
  each with a description, the five theme dimensions and seven metadata components nested as the same
  unit, fast `InfoTip` tooltips with "i" icons on the song page, emotions on one line separated by `;`,
  and the five dimension blocks two-up. **What to look at:** the sidebar starts almost fully collapsed
  (only Genre & style open) — a deliberate call that is one line to change; and the theme tree's inner
  scroll box is gone, so a long expanded dimension now scrolls the sidebar itself.
- **Next session:** curator smoke + merge `session-presentation-polish`, then **Triage 5 — lyric
  highlights from the translation + multi-language `songs.language`** (needs a brainstorm).
  _Triage 1a's DB-cleaning gate is closed — the reanalysis landed 2026-07-22 and 1b shipped with it._
- **Reprioritised order (2026-07-20):** triage **1a+1b** (analysis tiers + scalar filters — ☑ **merged `a6eb05a`, confirmed
  2026-07-22**) · **2** (persist
  browse state — ☑ **merged `bf2f1da`**) · **3** (featured redesign — ☑ **merged `6718cec`**, confirmed) ·
  **3b** (Featured management view — ☑ **merged `f3936b1`**, confirmed) · **4** (browse/search polish — ☑
  **merged `d3887ad`**, confirmed) → **5**
  (lyric highlights from translation + multi-language) → **B4** (Explore vector map, with the vector "You
  might also like") → triage **6** (About analysis-explainer + AI disclosure) → sub-projects **C–F**.
- **Last updated:** 2026-07-22 _(triage **1a+1b** merged `a6eb05a` and triage **4** merged `d3887ad`,
  both after curator smoke — **the curator-triage backlog 1–4 is now fully merged with no branches
  pending**. Merged `main`: backend 117/117. The **filter/analysis presentation batch** is then BUILT in
  full on `session-presentation-polish` (backend 121/121) — uniform collapsible sidebar sections with
  descriptions, fast `InfoTip` tooltips, two-up song-page dimensions — and is the one thing now awaiting
  curator smoke.)_

### Next Tasks (start here)
1. **~~A1~~ + ~~A2~~ + ~~A3~~ + ~~A4~~ — DONE. Sub-project A (Curation Workbench & lifecycle) is
   complete.** A1 merged (`145efbb`); A2 (`b5ec26f`, 2026-07-14); A3 (`8579b4e`, 2026-07-16). **A4
   (`session-A4-dashboard`, merged to `main` 2026-07-17 — merge `77ea3b5`, pushed):** the `/admin`
   Dashboard — action tiles → Songs queues, catalogue-health line, recent-activity feed → workbench,
   Add-a-song; read-only `GET /curation/catalogue-stats` + `/curation/recent`; deleted the old admin
   `DataCompletionDashboard` + `/completion-stats` route + `DashboardStub`.
2. **Sub-project B — Analysis integration (in progress). ~~B1~~ + ~~B2~~ + ~~B3~~ DONE.** B1
   (`session-B1-analysis-backend`, merged `4d5d6ee`, 2026-07-18): backend foundation. **B2**
   (`session-B2-song-page-analysis`, merged 2026-07-19): `LyricalAnalysis` on the song page + workbench;
   `subDimensionPalette.js`; mock categorisation UI deleted. **B3 — Browse & Search overhaul**
   (`session-B3-browse-search`, merged 2026-07-20, four rounds): effective-genre fix (492→~1,003 coverage),
   thematic facet tree with **selectable groups/sub-dimensions** (AND-of-terms via `facetSelectionClauses`),
   new filters (length/availability/analysis/language), removable chips, **left-sidebar layout** (mobile
   drawer), **dynamic exclude-self counts** (`/api/spotify/browse-facets` + shared
   `services/browseFilters.buildWhere`), Date-added sort (`COALESCE(playlist_added_at, date_added)`),
   colour-forward theme-tree hierarchy restyle; Popularity sort dropped. **B4 — Explore vector map**
   (2D/3D scatter over `vector_space.json`, space/colour toggles, spotlight filter) is the last B build,
   but is now sequenced **after** curator-triage items 1–5 (see the reprioritised order above). Design
   spec: [`specs/2026-07-17-B-analysis-integration-design.md`](./superpowers/specs/2026-07-17-B-analysis-integration-design.md).
3. **Remaining sub-projects:** C (submissions moderation / Inbox — the dashboard's disabled **Inbox**
   tile lights up here), D (YouTube search), E (lyrics fetch), F (Spotify push). Design:
   [`specs/2026-07-12-admin-workbench-design.md`](./superpowers/specs/2026-07-12-admin-workbench-design.md).
4. **Phase 5 — Deployment Hardening** (was Phase 4): externalise config/secrets, input
   validation, admin access control. Known items in Watch-outs: public pages hardcode
   `http://localhost:5000` (deployment breaks them until proxied/env-based),
   submissions-admin auth, real admin auth.
**Curator-triage backlog** (detailed, with root causes): see
[`CURATOR_TRIAGE_BACKLOG.md`](./CURATOR_TRIAGE_BACKLOG.md) — the 2026-07-20 batch (Fixes Round 1 +
the sort-overlap fix resolved 5). **Reprioritised 2026-07-20 — items 1–5 run before B4:**
1. **`key_focus_pipeline` split-read** (code dims ← key-focus; six scalar components ← deep tier;
   two-tier `getSongAnalysis`) **+ scalar-attribute browse filters** (deep tier).
2. **Persist browse sort/filter state** across navigation (lift out of component `useState`; prefer
   URL params).
3. **Featured-songs redesign** (restore a set-featured control; rethink the random-fill).
4. **Browse/search polish** — independent sidebar scroll + bidirectional sort.
5. **Lyric highlights from the translation** + multi-value/bilingual `songs.language`.
_Then **B4** (with vector "You might also like"), then_ **6. About analysis-explainer + AI disclosure.**

**Still-open optional curator to-dos** (non-blocking, carried forward):

- The **Bandcamp/Website artist button** ships empty — populate `artists.website_url` per
  artist via the admin Artists tab whenever ready.
- **149 included songs are not on the Spotify playlist** — add by hand if desired
  (`GET /api/admin/spotify-playlist-mismatch` lists them). _(Sub-project F later makes this a
  one-click push from the workbench.)_
- 1.3 leftovers in [`SESSION_1.3_CURATOR_DECISIONS.md`](./SESSION_1.3_CURATOR_DECISIONS.md):
  6 attach typos to fix then re-run `enrichFromSpotify.js --attach --apply`; 3 unmatched rows;
  2 unclassified Processed values — enrichment only, not blocking.
- The two source spreadsheets at `docs/playlist/` are fully imported and can retire after a
  site spot-check (keep as archive; still gitignored — lyrics).

### Known Context / Watch-outs
- **Truth source is live (1.1) + publication staging (1.2b):** the public site shows
  `status='included' AND published=true` — **1,341 live / 39 to-finalise / 177 to-process
  (pending) / 243 rejected** (1,380 included total; 1,800 songs after the 1.3 dedup).
  Publishing is an explicit curator click (admin endpoints
  `POST /api/admin/songs/:id/publish|unpublish`); the 1.4 admin UI presents the three
  queues. Full lyrics for 947 songs live in the **local-only** `song_lyrics` table — no API
  route may ever SELECT it (grep before deploy), and Phase 4 production dumps must use
  `--exclude-table-data=song_lyrics`. `backups/` and `backend/logs/` are gitignored because
  they can contain lyrics.
- ~~The 190 new manual songs have no album/spotify data yet~~ **Solved (1.2):** 151 attached
  to Spotify (full album/artist enrichment); 39 remain manual-only (5 confirmed not on
  Spotify, 34 in review for typos). Public queries use `LEFT JOIN albums` so non-Spotify
  songs render; keep it that way.
- **Schema check constraints matter for enrichment:** `artists`/`albums` require
  `data_source='spotify'` whenever `spotify_id` is set (so attaching an id flips
  `data_source`); `songs` may stay `manual` with a spotify_id (provenance preserved).
- ~~Frontend is a ~2,000-line `App.jsx` monolith with inline pages~~ **Solved (2.1):**
  `App.jsx` is a 49-line router shell; pages live in `src/pages/`, shared pieces in
  `src/components/`. Dead `ArtistsPage` + `DescriptionSection` deleted.
- ~~Backend has duplicate route files (`admin.js` / `admin_simple.js`)~~ **Solved (2.2):**
  `admin_simple.js`, `lyrics.js`, 17 dead admin routes, 2 DDL-over-HTTP routes and ~14 other
  dead endpoints deleted; `admin.js` reads as six named domains. The ~40 one-off scripts
  remain — Session 2.3 target.
- **`/api/submissions/admin*` endpoints have no auth** (found in 2.2): the whole submissions
  router is mounted without the admin password middleware. Since 2.2b the frontend sends
  `X-Admin-Password` on every admin call (including submissions, via the shared
  `adminFetch` helper), so the backend can start enforcing it without frontend changes —
  fold submissions-admin auth into the Phase 4 real-auth work (local-only until then).
- **Staging queue counts drift as the curator works them** — smoke tests should treat the
  totals as informational, not fixed expectations (2.2 observed 172 pending / 42 to-finalise /
  1,342 live vs 1.4's 177/39/1,341).
- **Vegan-themes analysis is future work, not a bug:** `analytics/vegan-themes` reports 0
  because the thematic coding of songs hasn't been done yet. Plan it as its own workstream
  once the truth source is in place.
- Deployment must be cheap and GitHub-driven — decided in Phase 4.
- **The DB holds no curatorial data** (all categorisation/review/rating fields empty across
  1,208 songs) — the curated dataset lives in the curator's external files. Protecting "the
  650-song dataset" means protecting those files + the DB's enrichment (671 YouTube videos,
  654 moods, 493 genres, 10 lyric links). See `DATABASE_AUDIT.md`.
- ~~The `songs` table holds 1,208 rows, not ~650~~ **Solved (0.2/0.3):** 674 from the 2025
  imports + 534 synced 2026-04-06 after the Spotify playlist grew (curator: a vetted batch).
  ~~18 true duplicate pairs to merge~~ **merged (1.3):** kept the 2025 canonical each time.
  A 19th dup (CLEARxCUT 80/5804, surfaced by the 1.2 diff) was merged after the curator's
  "default to include" ruling. Songs 1,819 → **1,800**.
- ~~2 orphan artists + 14 orphan albums~~ **Solved (1.3):** swept 19 orphan albums (13 old +
  6 freed by the merge) + 1 orphan artist (Flaex); Queen V had already been re-linked in 1.2.
  0 orphans remain.
- ~~450 songs are missing album covers~~ **Solved (1.2):** every album with a spotify_id now
  has images + release date (1,359/1,398 included songs have covers; the 39 without are the
  manual-only songs). Artists with genres 218 → 432 (the rest have no genres on Spotify's
  side).
- The old DB password remains in public GitHub history (rotated 2026-07-06, so harmless for the DB) — **user to change it anywhere else it was reused**.
- Admin auth is still a shared password shipped in the frontend bundle (env var now, but visible to any visitor once deployed) — real auth is a Phase 4 requirement before the admin routes go public.
- **Known cosmetic debt for the Phase 4 admin pass** (found in the 3.3 final review, not
  fixed — admin is out of scope until Phase 4): the admin loading spinner has a 3px
  cascade shift, and 8 pre-existing undefined legacy vars are used in admin `App.css`
  blocks (`--color-card-bg`, `--color-primary-dark`, `--shadow-sm/md/lg`,
  `--border-radius-full`, `--color-bg-quaternary`, `--color-text-light`) — fold into the
  Phase 4 admin restyle.
- **`DataDashboard.jsx`, `spotifyService.js`, `playlistService.js` hardcode
  `http://localhost:5000`** (2.2b only fixed admin code, per the changelog above) — Phase
  4 deployment (Session 4.2) breaks every public page until these go through the Vite
  proxy or an env-based base URL; name it explicitly for 4.1/4.2 planning.

---

## Decision Log

Newest first. Each entry: date · decision · why.

- **2026-07-22 — Filter/analysis presentation: two shared primitives rather than more one-off markup,
  and the description text lives in the curator's own files.** The curator's 1a+1b smoke produced two UI
  complaints — only some sidebar sections expanded, and tooltips took about a second to appear. Both had
  the same root cause: no shared primitive. Every sidebar group built its own header (`GenreFilterTree`
  and `ThemeFacetTree` each had an `<h3>`, four groups were inline `<div>`s, only `ScalarFacetGroups`
  collapsed), and hover help was the native `title` attribute, whose ~1s delay is browser-controlled and
  unstylable. Decisions: (1) one **`FilterSection`** — collapsible header, selected-count badge,
  description revealed on expand — used by **all eight** top-level groups and, nested, by the five theme
  dimensions and seven metadata components, so those two families finally read as the same unit;
  (2) one **`InfoTip`** (~120ms hover, immediate on keyboard focus, Escape to dismiss) replacing every
  native `title`, plus **"i" icons on headings only** — one per chip would be noise; (3) **descriptions
  are served by the API**, not hardcoded: component text from the codebook, and five new dimension
  descriptions **written into `taxonomy.json`** as `hierarchy.<dim>.description` after curator approval,
  keeping all vocabulary in the curator's artifacts; (4) **only Genre & style opens by default** — the
  sidebar starts compact; (5) the theme tree's inner `scrollable` box was **dropped** — with every
  dimension collapsible it nested a 200px scroll area inside the sidebar's own scroll (which triage 4
  had just restored); (6) the tooltip bubble renders **below its trigger with no flip logic** — flipping
  needs runtime measurement and a below-positioned bubble cannot collide with the viewport top.
  **Refined after the curator's smoke of this batch:** always-on descriptions under every expanded
  group read as clutter, so `FilterSection` now separates **`description`** (what the filter *is* —
  hover-only, behind an "i" on the heading) from **`note`** (how to *use* it — caveats and what the
  options mean, still visible). Every definitional sentence, including all twelve dimension/component
  descriptions, moved to hover; the coded-count caveat, the group/sub-dimension instruction, the
  parent-selects-children hint and the short/long definition stayed visible. The icon is a **sibling**
  of the toggle button, not a child — a `<button>` inside a `<button>` is invalid, and this codebase
  has shipped that bug before; verified 0 nested buttons.
  **Caught in the live check:** the bubble is nested inside its trigger, so inside the uppercase,
  letter-spaced `.la-attr-label` it rendered a whole sentence as shouting; it now resets
  `text-transform`/`letter-spacing`/weight/style. Song page also: emotions span the full attributes grid
  joined with `; ` (they were wrapping inside a 160px cell), and the five dimension blocks sit two-up
  above 700px. Verified: backend **121/121**; lint 0 errors; headless checks of the sidebar structure,
  every tooltip surface, the two-up layout at both widths, and a full filter regression
  (genre 1332→357, +perspective→47, sort direction coexisting, reload restoring, Clear all returning to
  1332). Spec/plan: `specs/2026-07-22-filter-and-analysis-presentation-design.md`,
  `plans/2026-07-22-filter-and-analysis-presentation.md`.

- **2026-07-22 — Triage 1a+1b: the analysis read becomes a genuine two-tier split (a different split than
  the handoff assumed), and the scalar browse filters are un-deferred because the data got clean.** The
  curator's reanalysis landed two new passes; a read-only DB check settled which to use.
  `gemini-3.5-flash-lite` (679 rows / 661 live) carries all seven scalar components as **100% valid
  codebook enums — zero unknown values** — but **empty code dimensions**; `gemini-flash-deductive` is a
  dead run (378 null + 160 `ERROR` perspectives, also no code dims) and is **ignored, not deleted** (the
  table is the curator's). Decisions: (1) **two constants, `CODE_MODEL` = `gemma4:key_focus_pipeline` and
  `SCALAR_MODEL` = `gemini-3.5-flash-lite`; `DEFAULT_MODEL` removed rather than aliased**, so each of the
  eight consumer sites must state its tier — a silent wrong-tier read becomes impossible. (2) **"Has
  analysis" = either tier** (live 640 → **665**): 613 songs have both, 4 are code-only (chips, no
  attributes card), 48 are scalar-only (card, no chips) — a song shows whatever it has. (3) **All seven
  components become browse filters**, collapsed by default, **OR within a component, AND across** — six of
  them are single-valued per song, so ANDing within would always return zero; `emotions` (the one `text[]`)
  follows the same rule for consistency. (4) **The four absence codes are hidden everywhere, display and
  filters** (`THEMATIC_ABSENCE`, `ABSENCE_OF_FOCUS`, `INSUFFICIENT_DATA`, `UNSPECIFIED`) — curator's call;
  they read as bugs on a public page. (5) The codebook is vendored as the **backend-only** label source (a
  new pure `services/metadataCodebook.js`); labels reach the frontend through the API, and the codebook's
  emoji `short_tag`s are never used (brand voice). `taxonomy.json`'s now-dead scalar lists stay in the file
  but `scalarLabel` was deleted. **(6) Display drops off-codebook values instead of Title-Casing them** —
  added same-day after the pipeline proved it can emit them. The scalar tier was re-run twice on 2026-07-22:
  the 11:25 pass fixed the empty-`emotions` problem (321/679 empty → **4**) but briefly shipped **10 rows
  with values absent from the codebook** — typos of real codes (`VISVERAL_HORROR_AND_ABJECTION`,
  `DETACHED_CYCINISM_AND_RESIGNATION`), a wrong stem (`VIOLENT_RETRIBUTION` for `…RETALIATION`), and prompt-
  template artifacts (`EXACT_ENUM_CODE_KEY`, `EXCLUDED`) across perspective/intensity/target_audience. The
  curator corrected all ten immediately (re-verified: **0 unknown across all seven components**), but the
  episode exposed a real asymmetry: filters and counts are built from the codebook and silently ignored
  those values, while the song page would have rendered them as prose ("Intensity — Detached Cycinism And
  Resignation"). `getSongAnalysis` now gates display through the same `cleanSelection` the filters use, so
  **the page can only show a value you could also filter by**. _Trade-off accepted: a code added to the DB
  before the codebook JSON is updated will be invisible until the JSON catches up._ **Caught by the final
  review:** the
  theme facet tree's caption was fed the either-tier count (665) while the tree itself counts only
  code-tier songs, overstating its own set by ~61 and contradicting the number rendered directly below it;
  `/browse-facets` now returns a separate `coded_count` (617) for that caption. Verified: backend
  **114/114**;
  reviewers independently re-ran the suite, mutation-tested the facet-count parameter arithmetic (removing
  a `+1` makes both tests fail), and re-hit the live endpoints; puppeteer smoke on the sidebar (129→203 OR,
  →87 AND) and all three song-page coverage cases. Spec/plan:
  `specs/2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters-design.md`,
  `plans/2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters.md`. **Supersedes** the parked
  2026-07-20 triage-1a spec and its branch `session-triage-1a-key-focus`, now abandoned.

- **2026-07-21 — Triage 4: bidirectional sort via a whitelisted `dir` + a pure `buildOrderBy`; sidebar
  scrolls independently (merged).** The Sort-by control was single-direction and the sticky
  filter sidebar (no bounded height) hid its own overflow. Decisions: (1) sort direction is a whitelisted
  `dir` (`asc`/`desc`, else the field default) threaded through the URL → `/search`; the ORDER BY moved
  out of an inline `switch` into a **pure, unit-tested `services/browseFilters.buildOrderBy(sortBy, dir)`**
  (which also **dropped the dead `energy`/`danceability`/`valence` sort cases** — audio features are NULL
  and the UI never offered them; unknown fields fall back to the popularity default). (2) A **direction
  toggle** beside the select shows the *effective* direction with **contextual labels** (A–Z/Z–A for
  text fields, Oldest/Newest for date fields) and flips `filters.dir`; **changing the sort field resets
  `dir`** to that field's natural default (least-surprising). (3) `dir` rides item 2's URL-state model
  (added to `EMPTY_FILTERS`/`STRING_KEYS`) so direction is shareable/restored. (4) The sidebar gets
  `max-height: calc(100vh - space-4*2)` + `overflow-y:auto` so it scrolls internally while staying pinned
  (the app-header isn't sticky, so viewport-bounding is safe); the mobile drawer rule is untouched.
  Verified: backend 92/92 (3 new pure tests); full-stack smoke all-pass (temp :5001 `dir` reverses order;
  headless :5173 toggle→URL + field-reset + sidebar overflow 10/10). Scope: homepage browse only (the
  Artists page keeps its own separate sort — deferred, as in B3). Spec/plan:
  `specs/2026-07-21-triage-4-browse-search-polish-design.md`, `plans/2026-07-21-triage-4-browse-search-polish.md`.

- **2026-07-21 — Triage 3b: a Featured management view (admin scope + quick unfeature), unfeature-only
  (built, pending merge).** The curator's triage-3 smoke surfaced that the per-song workbench toggle gave
  no catalogue-wide view of the featured set, making rotation tedious. Decision: reuse the derived-queue
  system — a **`featured` scope** (`queueWhere` `s.featured=true`, added to `QUEUE_NAMES`/`queueCounts`;
  `listCurationQueue` returns a per-row `featured`) surfaced as a rail item + a `/admin` Dashboard tile,
  with a **per-row quick Unfeature** button (reusing `POST /songs/:id/unfeature`) and a **Featured badge**
  on rows in any scope. Curator chose **unfeature-only** (no inline Feature toggle in other scopes —
  turning songs *on* stays in the workbench) — YAGNI. The list row was refactored into a flex wrapper so
  the action isn't a nested `<button>`. Verified: backend 90/90 (1 new test) + API smoke all-pass
  (counts/scope/row/unfeature/badge; original featured set restored). Spec/plan:
  `specs/2026-07-21-triage-3b-featured-management-design.md`, `plans/2026-07-21-triage-3b-featured-management.md`.

- **2026-07-21 — Triage 3: featured = curated pins with a deterministic recency fill, cycling a large
  pin set; restored a workbench Featured toggle; dropped the card date.** The homepage Featured filled
  empty slots with `ORDER BY RANDOM()` over the whole catalogue ("the rest look random"), and the
  Phase-4 admin rebuild had deleted the featured toggle with no replacement. Decisions (curator):
  (1) **fill by recency** — `ORDER BY COALESCE(playlist_added_at, date_added) DESC NULLS LAST` — so
  under-pinned slots are the most-recently-added, deterministic; (2) **cycle when over-pinned** — the
  pinned query becomes `ORDER BY RANDOM() LIMIT 4`, so >4 pins rotate a random 4 per load (random
  *within the curated set* is wanted; random from the catalogue was the problem); (3) **restore the
  toggle** in the workbench top bar via `curation.setFeatured` + `POST /songs/:id/feature|unfeature`
  (mirrors publish/unpublish; `getWorkbench` now returns `featured`) — kept the messy legacy
  `PUT /update-song/:id` featured path untouched (out of scope); (4) **drop the added-date from
  `SongCard`** (shown only for playlist songs — inconsistent) uniformly across all card surfaces; (5)
  **keep the mood chip as-is** (shows only when `custom_mood` exists — real metadata, not a bug). Verified
  with backend 89/89 (+`setFeatured` test) and an API smoke on a temp :5001 backend (cycle/recency-fill/
  routes/404), original featured set restored. Spec/plan:
  `specs/2026-07-21-triage-3-featured-redesign-design.md`, `plans/2026-07-21-triage-3-featured-redesign.md`.

- **2026-07-20 — Triage 2: browse state persisted in the URL (built, pending merge).** The homepage
  browse reset filters/sort on navigation because all state lived in `SearchAndFilter`'s `useState`
  (+ `currentPage` in `HomePage`), which unmount on route change. **Decision:** the URL query string is
  the single source of truth (curator's prior "prefer URL params" call — shareable + bookmarkable),
  implemented as **hydrate-on-mount + mirror-on-change** (react-router v7 `useSearchParams`, `replace`
  writes) rather than a context/`sessionStorage` store. A new pure `frontend/src/utils/browseUrlState.js`
  (`readFilterState`/`applyFilterState`, defaults omitted) is the isolated serialization unit; page is
  persisted by a **second, disjoint URL writer** in `SearchSection` (only the `page` key) so the two
  writers never clobber. Removed `SearchSection`'s redundant initial mount-fetch. **Verified by headless
  puppeteer smoke (10/10)** — which caught a real bug: the "reset page to 1 on filter change" effect
  fired on mount and wiped a URL-hydrated `?page=N`; a boolean skip-mount ref then failed under
  **StrictMode's double mount-invoke**, so the fix compares the query/filters **signature** against a ref
  (both mount-invokes see no change → no reset). `parent_genres` persisted explicitly (not reconstructed
  from the async genre tree). **Follow-up (curator smoke):** a param-less nav to `/` (the **Home** link /
  site title) still reset filters (Back worked; Home didn't, because a clean `/` has no params). Fixed by
  layering **sessionStorage under the URL** — the URL wins when it carries any browse param (deep
  link/share/Back), else a clean `/` restores the last state saved this visit and repopulates the URL;
  "Clear all" stores empty state so Home stays fresh (the deliberate path to a clean home). Live-smoke-only
  (no frontend test runner — consistent with Phase 3/B2/B3); headless smoke **15/15**.
  Scope: HomePage browse only (Artists browse + `/search` + admin untouched). Spec/plan:
  `specs/2026-07-20-triage-2-persist-browse-state-design.md`, `plans/2026-07-20-triage-2-persist-browse-state.md`.

- **2026-07-20 — Triage 1a: the `key_focus_pipeline` adoption is a ONE-CONSTANT flip, not a split read;
  scalar browse filters (1b) are blocked by free-text data and kicked to the pipeline.** A pre-design DB
  check (read-only) overturned the handoff's two premises. (1) **The six scalars are NOT deep-only** —
  they are populated in every tier and are **byte-identical** between `key_focus` and `deep` for the same
  song (8/8 sampled), so `getSongAnalysis` needs no two-tier merge; `key_focus_pipeline` already carries
  both the refined code dims and the scalars. (2) **The scalars are free-text, not the `taxonomy.json`
  enums** (`intensity`/`focus_amount` **0/637** exact match; perspective 15/637; hundreds of distinct
  values; one `emotions` mojibake row), so enum facets as specced would match ~nothing → **item 1b
  deferred and kicked to the analysis pipeline** (emit clean enum scalars or ship a mapping first). (3) The
  **code dimensions are the real win**: `key_focus` is near-perfectly clean (0–1 stray codes/dim, ~1–3
  codes/dim) vs `gemma4:latest` which leaks prompt-garbage codes (`clarity_levels`, `N/A`,
  `…summary_note_to_user`) and averages ~5 themes/song. So the change is a single flip of
  `analysis.DEFAULT_MODEL` → `gemma4:key_focus_pipeline` (all consumers follow). **Accepted:** live coverage
  `latest` 640 → `key_focus` 617, i.e. ~23 live songs lose their analysis section, **no fallback** (one
  tier everywhere, fully consistent). Scalar **display** kept as-is (free-text). **EXECUTION PARKED** until
  the curator confirms DB cleaning (may reactivate 1b). Spec/plan:
  `specs/2026-07-20-triage-1a-key-focus-adoption-design.md`, `plans/2026-07-20-triage-1a-key-focus-adoption.md`.

- **2026-07-20 — Curator-triage review: the `key_focus_pipeline` adoption is a SPLIT read, and
  the six scalar metadata components come from the DEEP tier.** A curator issue batch was reviewed
  against the code and captured in [`CURATOR_TRIAGE_BACKLOG.md`](./CURATOR_TRIAGE_BACKLOG.md).
  Key findings/decisions: (1) The new 2-stage analysis (`song_lyric_analysis.model_used`) means the
  site should read the **five code dimensions** (targets/actions/tactics/moral_frames/themes) from the
  refined **`gemma4:key_focus_pipeline`** (1–3 codes/dimension, analogy/satire noise filtered), but the
  **six scalar metadata components** (`perspective`/`lyrical_tone`/`intensity`/`clarity`/`focus_amount`/
  `emotions`) live **only in `gemma4:deep_pipeline`** — so `getSongAnalysis` must become a two-tier
  read, NOT a one-constant flip of `analysis.js` `DEFAULT_MODEL` (`gemma4:latest`). **No deep-dive/
  exhaustive-quote view** (curator: not needed — the deep tier is only the scalar source). The
  ~685→672 coverage change is attributed to recent playlist edits, not a bug. (2) "Filter by lyrical
  analysis" is **not** done: the theme facet tree (B3) covers the five code dimensions, but the **six
  scalar attributes are display-only** on the song page and need their own browse facets/filters
  (read from the deep tier) — the allowed enum values are recorded in the backlog. (3) New captured
  requests: **persist browse sort/filter state across navigation** (lift out of component `useState`,
  prefer URL params); **add lyric highlights from the English translation**; **multi-value/bilingual
  `songs.language`**; **featured-songs redesign** (backend still fills to 4 with random after 2
  `featured=true` pins — and the "set featured" admin UI was removed in the Phase-4 rebuild, no
  replacement); **card chip = MoodBadge** (only when a mood exists) and **date-added** (only when
  `playlist_added_at` exists) inconsistencies; **About analysis-explainer + AI disclosure** page;
  **vector "You might also like"** (current `/similar` is genre + dead NULL audio-features). All
  sequenced after B4. Fixes Round 1 + the sort-overlap fix resolved 5 of the batch.

- **2026-07-20 — Fixes Round 1: a curator-triage bug round found a second data-loss bug and settled the
  duplicate-reject model.** A batch of curator-reported issues was triaged into a sequenced backlog
  (bug-fix round first; then thematic `key_focus_pipeline`, browse/search polish, featured redesign,
  About/AI page, B4); the first round shipped four fixes + UX polish. Key decisions/findings: (1) the
  reported lyrics-URL loss (#1) was `saveLyrics`'s `ON CONFLICT` null-clobbering `source_url`/`translation`
  on a lyrics-only save; the fix writes only provided fields, and **clearing lyrics now keeps the row**
  (curator choice — preserves URL/translation) using `lyrics=''` because the column is `NOT NULL`, so
  every "has lyrics" check became non-empty (`btrim<>''`). (2) **Planning surfaced a second, unreported
  data-loss bug of the same class:** `setProcessing` overwrote park/snooze/note from `EXCLUDED` on every
  call, so toggling a lyrics-avenue silently wiped a park reason — the spec's "display-only #2" was
  expanded to fix it. (3) **Duplicate detection gates on title AND artist** (not a weighted score that
  title could dominate) — behaviour-preserving extraction to pure `services/duplicates.js`; duration/album
  signals dropped (confidence was already group-size only). (4) Because no heuristic is perfect, added a
  **persistent whole-group "Not a duplicate" reject** (migration 008 `duplicate_dismissals`, canonical
  `a<b`; the pure detector takes a dismissed-pair set; `getDismissedPairKeys` routed through the same
  `pairKey` so the key format has one source of truth) — curator chose whole-group + reject-only (no
  heuristic tightening; only 22 groups total). (5) The stateless "reach any song" gap (song 1 had a
  Rickroll video) was closed by exposing the **already-existing** backend `queue='all'` scope in the Songs
  UI + a `queueCounts.all` total. (6) UX: Sort-by beside the search box; filter chips relocated to the top
  of the results column; the redundant HomePage "Filters applied:" summary deleted (chips are the single
  source of truth). Spec/plan: `specs/2026-07-20-fixes-round-1-design.md`,
  `plans/2026-07-20-fixes-round-1.md`.

- **2026-07-20 — B3 grew into a four-round browse/search rebuild via live curator smoke; several
  cross-filter/semantics decisions locked in.** The planned "faceted browse" became a full overhaul because
  each smoke round reshaped it. Key decisions: (1) **Genre is an "effective genre"** =
  `COALESCE(songs.genre, primary artist's first genre)`, computed **at query time** (no stored migration —
  protects the dataset invariant), because only 492/1,332 live songs had a song-level genre but ~1,003 have
  one via their artist; facet counts and the `/search` filter share the exact same expression so a count
  always equals what clicking returns (hardened later with `TRIM` + a short-length lower bound for parity).
  (2) **Filters live in a left sidebar** (curator rejected the two-column drop-panel as "breaks up the
  page"), collapsing to a mobile drawer. (3) **Dynamic counts are exclude-self** (each group's counts apply
  all *other* filters but not its own, so a group stays widenable) — a new `/api/spotify/browse-facets`
  endpoint + a shared `services/browseFilters.buildWhere` that both `/search` and the counts use, so
  filtering and counts can never drift. (4) **Theme facet logic stays AND for individual codes** (curator
  kept narrowing), but a **group or sub-dimension is a single OR-term** over its codes (any code inside),
  all terms AND across — the "act like genres" ask realised without flipping the whole dimension to OR;
  ancestor-select covers+clears descendants. (5) **Date-added sort** uses
  `COALESCE(playlist_added_at, date_added)` (Spotify curation date first, else import date) so the ~534
  Apr-2026 batch that was never on the Spotify playlist still surfaces as recent. (6) **Popularity sort
  removed** (already display-suppressed since Phase 3). (7) The theme tree was **restyled colour-forward**
  (nested rails, level-distinct type) after two alignment-bug rounds — the real cause was `<button>`
  dimension headers defaulting to `text-align:center` (flex positioned the label but not its inner text);
  the earlier "still broken" smoke was a **stale-HMR artifact** (a full component + CSS-deletion rewrite
  doesn't hot-reload cleanly — restart the dev server fresh after such changes). Deferred (non-blocking):
  `ArtistSearchAndFilter.jsx` still has its own hardcoded genre hierarchy (different endpoint, a later
  backend-driven pass); the now-unused public `getFilterOptions`/`getFacets` service methods (kept, later
  removal); a cosmetic parent-genre-checkbox-stays-checked-on-single-subgenre-untick. Specs/plans:
  `specs/2026-07-19-B3-browse-search-design.md` (+ rework, facet-selection, restyle specs) and their plans.

- **2026-07-18 — B1 executed; taxonomy went hierarchical mid-flight; migration had to drop a dead
  view; several self-referential plan bugs caught by review.** (1) **The curator restructured
  `taxonomy.json` into a 4-level hierarchy** (Dimension → Sub-dimension → Group → Code) partway through
  B1 — the code ids are unchanged so `song_lyric_analysis` needed no re-coding, but the presentation
  refactored: browse = a collapsible hierarchical facet tree with **distinct-song rollup counts**
  (`facetTree`), song-page chips **colour-coded by sub-dimension** with an inline mini-legend (curator's
  "Option A"), map default colour = sub-dimension; one shared FE sub-dimension palette (built with the
  `dataviz` skill in B2/B4). `getSongAnalysis` enriches each code with `sub_dimension`/
  `sub_dimension_label`/`group`. (2) **Migration 007 was blocked** by a dead legacy view
  `songs_with_manual_categories` (from `manual_additions_schema.sql`) that COALESCEs the mock columns
  with a 0-row `manual_categorizations` table — verified dead (0 rows, 0 dependents, no app-code refs)
  and dropped by the migration before the columns (controller decision). (3) **Three of my own plan
  snippets were self-referential bugs the implementers/review caught and fixed:** a router comment and a
  SQL alias (`songs_with_vegan_focus`) that literally contained the guarded strings/mock-column names
  (would false-trip the lyrics-privacy grep / the mock-removal grep), and a mislabel of the `/search`
  endpoint's `/filter-options` as `/categorization-options` (blanking it would've broken the live genre/
  year browse filters — kept the non-mock keys instead). (4) **A real `/search` alias collision**
  (`song_artists` was aliased `sa`, colliding with the facet join's `song_lyric_analysis sa`) was caught
  and fixed by renaming to `sart`. **Deferred minors** (logged for later): add a 2-codes-same-group
  `facetTree` test in B3; `PUBLIC_DIMS`/`DIM_TO_TAXONOMY` are byte-identical (desync trap); retire the
  now-vestigial admin bulk-upload endpoint in B2; DDL drift in `schema.sql`/`manual_additions_schema.sql`/
  `playlist_sync_schema.sql` (still declare the dropped columns/view — harmless, future cleanup).

- **2026-07-17 — Sub-project B (Analysis Integration) design decided (brainstorm + visual companion).**
  Replace the mocked, always-empty 5-array categorisation (`vegan_focus`/`animal_category`/`advocacy_style`/
  `advocacy_issues`/`lyrical_explicitness` — verified 0 non-empty rows across all 1,821 songs) with the
  real `song_lyric_analysis` coding (**`gemma4:latest` only**; 685 songs) + `vector_space.json`, across
  five **display-only** surfaces. Key choices: **song page** = "Option C" (compact attributes card + all
  chips per non-empty dimension; explanation + one evidence quote per code behind a "Show evidence"
  toggle; emoji-free; short evidence fragments shown publicly — distinct from the local-only full
  `song_lyrics`); **faceted browse** = full (all 5 dimensions + tone/intensity), **always-AND** everywhere
  (within and across groups), only-coded with a visible note; **vector map** = its own top-nav "Explore"
  page, 2D + 3D, space toggle (semantic/thematic/acoustic), colour-by dominant-theme default, theme/animal
  **spotlight filter**; **mock removal** = UI + drop the 5 DB columns (migration 007); **`analytics/vegan-themes`
  repointed** at the real theme aggregation (feeds the public DataDashboard). `taxonomy.json` codebook
  **vendored into the repo** as the label/definition/facet-option source. One spec → four plans: **B1**
  (backend/data), **B2** (song page + workbench panel + mock-UI deletion), **B3** (faceted browse), **B4**
  (Explore map). YAGNI out of scope: the `gemini-3.5-flash` model + any switcher, the monthly regeneration
  pipeline, and the `songs.rating` field. Spec:
  [`specs/2026-07-17-B-analysis-integration-design.md`](./superpowers/specs/2026-07-17-B-analysis-integration-design.md).

- **2026-07-17 — A4 dashboard = "blend of both" (action tiles + compact health), recent activity
  from `updated_at`, deletions done surgically (curator-approved at brainstorm + one plan erratum
  caught mid-build).** The `/admin` landing answers both "what should I work on" (clickable queue
  tiles → the Songs area) and "how healthy is the catalogue" (a one-line totals strip) — deliberately
  lean, **no** completion-percentage bars or "priority action" nagging, so it doesn't regrow into the
  old wall. "Recent activity" is the last 10 songs by `songs.updated_at` (every workbench save +
  lifecycle change bumps it — reliable) linking to the workbench; the heavier "what changed" audit
  feed was rejected (YAGNI — no event log exists). Two new endpoints are **read-only** aggregation
  (`catalogueStats` pure SELECT; `recentlyEdited` parameterised `LIMIT`), so the dataset-safety
  invariant holds. **Two implementer deviations from the plan were accepted as correct fixes:**
  (1) `recentlyEdited`'s limit clamp uses an `isNaN` check, not the plan's literal `parseInt||10` —
  `0||10`→10 would have failed the plan's own `limit=0` test (JS falsy-zero); the clamp now correctly
  maps 0→1, non-numeric→10, range `[1,50]`. (2) **Plan erratum:** the plan's Task-5 CSS DELETE list
  wrongly listed `.stat-value` as exclusive to the deleted admin dashboard — it is actually **shared**
  via `.stat-badge .stat-value` by the public HomePage/About/DataDashboard and is the sole source of
  their badge margin; both implementer and reviewer caught it and it was **kept** (deleting it would
  have visually regressed three live public pages). The Inbox tile ships disabled (sub-project C lights
  it up). **Sub-project A (Curation Workbench & lifecycle) is complete with A4.**

- **2026-07-16 — Phase 3 + admin manual smoke-test findings resolved as one polish pass
  (curator-approved).** After the curator manually verified the Phase 3 public site and the A2/A3
  admin, seven small issues were fixed now rather than deferred: (1) the admin **login page** was
  broken by a **dead legacy `.admin-login` rule in `App.css`** (from the removed AdminInterface)
  that forced `display:flex`+`min-height:100vh` onto the new login card, making it full-height with
  row-flex "squished" text — the whole dead login CSS block was deleted so only `admin.css` applies
  (a first width-only fix didn't work because it never overrode `display`/`min-height`). (2) The
  browse **genre filter chips** duplicated the dropdown checkboxes → chips row + its two feeder
  functions removed; the checkboxes are the sole control (a panel-closed "active filters" summary
  can return later if wanted). (3) **Playlist cards** now show a cover derived from the first member
  song's album art via a read-only subquery on the public `GET /api/playlists` (the `playlists`
  table has no cover column; one representative image, a mosaic is future work). (4) Workbench
  **Remind-me date** input widened (150→175px). (5) **Attach Spotify by search** moved directly
  under the Spotify URL input. (6) One-click **"Set English"** language quick-pick (free-text still
  covers other languages). Plus two curator feature requests: **quick-search links** (Search YouTube
  in the Video panel, Search Bandcamp in Links — the same link-launch MVP as the lyrics quick-search,
  i.e. the realistic form of sub-projects D/E) and **"Open ↗"** buttons beside saved Spotify /
  Bandcamp / SoundCloud URLs. Frontend-only except the one read-only playlists subquery; no
  curatorial data touched; committed straight to `main` (small, curator-verified).
- **2026-07-16 — A3 Curation Workbench design choices + four mid-build hardening decisions
  (all curator-approved during subagent-driven execution).** The workbench is one two-column
  screen (main = Lyrics; side = Details/Video/Links/Analysis/Notes) with a sticky top bar;
  fields autosave on blur via a shared `AutoText`/`SaveTag` primitive (`SavedField.jsx`); the
  Key-lyrics highlights picker is interactive (select-in-textarea → "+ Add selection");
  within-page Prev/Next pages through the queue via `location.state` (absent on a direct-URL
  open). **Four defects surfaced by the per-task reviews were fixed rather than shipped, each a
  curator call at the time:** (1) a shared-primitive **race** — the container swaps `wb` before
  `AutoText`'s save resolves and React 18 batches both, so the `[initial]` re-seed effect stomped
  the "Saved" tag before paint; fixed with a `savedByUs` ref that gates *only* the status reset
  (re-seed still unconditional). (2) A **false "Saved"** — A1's backend silently no-ops a
  translation/source-URL save when no lyrics row exists yet but returns success; fixed by
  **disabling** those two fields (additive `disabled` prop on `AutoText`) with an "add lyrics
  first" hint until lyrics exist. (3) **Highlights** stored newline-joined fragmented on a
  multi-line selection and were keyed by string content (a repeated chorus line couldn't be added
  twice; Remove deleted all copies); fixed by collapsing internal newlines to a space and keying
  by index. (4) **Save-failure feedback made a class standard** — several plan-pseudocode saves
  were fire-and-forget (silent on failure); now the highlights picker, avenues checkboxes, the
  whole Video panel (add/set-primary/delete), Links' attach-spotify, and the top-bar Park/Remind
  controls all await and surface failure via `SaveTag`, and every `adminFetch` mutation is wrapped
  in try/catch (it *rejects* on network-level failure before reaching `r.ok`). A final
  whole-branch review also caught that `savePanel`/`saveProcessing` bypassed Task 8's
  stale-response token guard (save-then-Next could render the previous song's data under the new
  URL); fixed by extending the same token guard to both helpers. Playlist-membership indicator on
  the workbench is deferred to sub-project F (Spotify push). No backend file changed in A3 — the
  copyright guardrail (`lyrics`/`translation` are admin-path-only) is intact by construction.
- **2026-07-12 — Admin layer to be rebuilt as a dedicated phase, decomposed A–F
  (brainstorm session).** The curator flagged the 10-tab admin as clunky/disjointed and a
  stagnation risk ("if I can't easily add/update songs, the playlist goes stale"). Rather than
  more incremental audit-cleanups, we designed a **workflow-oriented admin**: a single
  full-page **Curation Workbench** (everything about one song on one screen) fed by
  **derived queues**, reorganising 10 tool-tabs → 5 job-areas. Scoped as **6 sub-projects**
  (A workbench+lifecycle · B analysis display / delete the mock categorisation · C submissions
  moderation · D YouTube search · E lyrics fetch · F Spotify push), each with its own
  spec→plan→build cycle. **Admin Rebuild becomes Phase 4; Deployment Hardening moves to
  Phase 5.** Design: [`specs/2026-07-12-admin-workbench-design.md`](./superpowers/specs/2026-07-12-admin-workbench-design.md).
  Key sub-decisions: workbench is one screen for _both_ processing and editing; autosave-on-blur;
  reject-with-confirm; the mocked 5-array categorisation is **deleted in B** and replaced by
  the external `song_lyric_analysis` table (read-only in admin — the main app only displays it);
  new `song_processing` table holds only the non-derivable workflow state (snooze / park reason /
  lyrics avenues tried); `songs.language` (sung-in) is public metadata, `song_lyrics.translation`
  stays local-only (copyright); publish-incomplete is supported with to-do queues tracking gaps;
  the "Submit a song" page stays public (community submissions, moderated into the Inbox);
  Spotify becomes a push target (website is truth), needing a one-time write-auth OAuth in F.
- **2026-07-11 — Public playlists made read-only (Session 3.3, curator decision at
  design time).** Anyone-can-create/anyone-can-remove was never a real feature — it had
  no auth story and no spam protection (see the Backlog entry). Rather than leave dead
  or misleading controls in the restyled UI: the Create-playlist button/modal was
  **deleted, not hidden** (`CreatePlaylistModal` and its trigger removed from
  `PlaylistsPage.jsx`), `AddToPlaylistModal.jsx` was deleted outright (26 → 25
  components), the remove-song control was removed from the playlist-detail row, and
  the dead "coming soon" play-button alert was removed from `SongCard`. Backend
  playlist routes (`playlists.js`) were **not touched** — the admin Manage Playlists
  tab still consumes the same API. Playlist creation returns to the public site once
  there's real auth (Phase 4+); browsing curated playlists is unaffected.
- **2026-07-11 — The 3.2-era "site-wide 390px overflow" no longer reproduces (Session
  3.3 planning).** Verified headlessly on all 11 routes with real data at planning time
  (2026-07-11): no route overflowed at 390px. It's evidently fixed by 3.2's own
  same-day follow-up (nav-wrap fix + `width: 100%` container fixes) — no dedicated
  shell-fix task was needed, and the task planned for it in the 3.3 brief was dropped.
  Re-confirmed in the Task 10 full-route smoke test (all 11 routes × 2 viewports, no
  overflow).
- **2026-07-11 — About-page copy: curator edits merged onto the kit structure
  (Session 3.3, curator-approved "merge" option).** The curator had uncommitted
  working-tree edits to `AboutPage.jsx` (care/appreciation framing, "critique animal
  exploitation" wording, a revised animal-focus line, themes described without an
  environment mention) that conflicted with the kit's About copy queued for this
  session. Curator chose to merge: kit structure + curator's content, with typos fixed.
  The curator's same-session Submit-page copy tweaks were committed as-is (`11a2760`,
  curator-authored, care/connection framing).
- **2026-07-11 — Admin light-touch scope confirmed by inspection, not rebuild (Session
  3.3, Task 8).** A headless walk of all 10 admin tabs after the public restyle found
  **no breakage**: `ManagePlaylistsTab` uses the namespaced `admin-playlist-card` class,
  so it doesn't collide with the public `.playlist-card` restyle. Zero admin fixes were
  needed — the task produced no diff and no code review.
- **2026-07-11 — Public-page restyle choices (Session 3.2).** (1) **Restyle preserved
  behaviour; only the two detail pages changed structure** — Song Detail and Artist
  Detail were rebuilt to the kit's scrim-hero layouts (`ui_kits/website/song.html` /
  `artist.html`); Home/Browse/Artists kept their component structure and got token CSS
  (the kit's browse-filters sidebar mockup was *not* adopted — the existing toggle
  filter panel keeps the hierarchical genre tree, which the flat mockup can't express).
  (2) **Advocacy section renamed and gated (curator request):** "Vegan Advocacy
  Analysis" → **"Animal advocacy analysis"** (kit sentence case), rendered only when at
  least one of the five categorisation arrays is non-empty — today that's no songs, by
  design. (3) **Dead code removed with the restyle:** song-page audio-features panel +
  technical details (fields NULL for all songs; Phase 0 drop), preview-play buttons
  (`preview_url` dead), energy/danceability/valence sort options, the artists-grid
  "View Artist" hover overlay, all `via.placeholder.com` fallbacks (striped placeholder
  instead), and dead CSS (`.song-tags`, `.view-all-results`, `.coming-soon`,
  audio-feature badge variants). (4) **Generic vocabulary lives once in
  components.css** — `.songs-grid`, `.section-header`, messages/empty states,
  `.page-container`/`.page-header`, search+filter suite — so Playlists/Submit/About and
  admin inherit the brand look before their 3.3 restyle. (5) **Flexbox gotcha fixed and
  documented:** page containers are flex items of the column-flex `.app-container`, and
  `margin: 0 auto` disables flex stretch (container collapses to content width) — every
  centered page container now sets `width: 100%` explicitly. (6) Two "Filters applied"
  guards fixed (empty `year_range` object / default `min_songs: 1` made the empty label
  render).
- **2026-07-11 — Popularity metrics off the public site; artist website link added
  (Session 3.2 follow-up, curator-requested).** Popularity "sets up a comparison we're
  not interested in": removed from song cards, the song-page hero, artist cards, artist
  song rows, and the artist-page stat boxes (the letter of the request covered songs +
  artist-card followers; popularity was removed from artist surfaces too under the same
  rationale — easy to restore if wanted). Followers stay only on the artist page,
  relabelled **"Spotify followers"**. Sorting by popularity still works (display-only
  change). Artist-page songs are grouped by album (newest release first, "Other songs"
  last; per-album numbering under a cover + year · count header). New curator-owned
  `artists.website_url` (migration `005_artist_website.sql`) renders as a
  "Bandcamp"/"Website" hero button (label by URL host); editable in the admin Artists
  tab; never touched by sync/enrichment.
- **2026-07-10 — Design-system layering: bridge + override, not a rewrite (Session 3.1).**
  (1) Brand tokens live in new `frontend/src/styles/tokens/` (kit's colors/typography/
  spacing verbatim; fonts via a Google Fonts `<link>` in `index.html` instead of the
  kit's CSS `@import`); global element styles in `styles/base.css`; the core-component
  classes in `styles/components.css`, imported **after** `App.css` so the design system
  wins the cascade over the 7,900-line legacy monolith (whose bare-class duplicate
  blocks otherwise "last-rule-wins" everything). (2) The monolith's legacy `:root`
  variables were **re-pointed at the brand tokens** (a documented BRIDGE block) — every
  page, admin included, picks up the palette at once without touching page CSS; the 56
  hardcoded Spotify-green values and 4 gradients were swept to tokens/flat fills
  (brand: flat, no gradients). 3.2/3.3 delete legacy blocks + bridge entries page by
  page. (3) Also mapped five legacy variables that were used but **never defined**
  (`--color-border`, `--color-surface`, `--color-primary`, `--color-vegan-primary/
  secondary`) — borders silently fell back to `currentColor` before. (4) Brand-voice
  rules applied to core components: no emoji (🔥 popularity, mood emojis removed),
  mood badge became a neutral scrim pill (two intentional accent hues only), missing
  covers render the kit's striped placeholder — the dead `via.placeholder.com` fallback
  is gone.
- **2026-07-10 — "Cover API broken" was a CSS bug, now fixed (Session 3.1).** The brand
  kit (and the curator) believed the album-cover API was broken. Root cause found while
  smoke-testing 3.1: an old cleanup in `App.css` deleted a `@media (max-width: 768px)`
  opener but left its body, leaking mobile artist-page rules — including
  `.song-artwork { display: none }` — into **global** scope. Song cards therefore never
  showed covers on any viewport even though the DB has had them since Session 1.2. Fix:
  restored the media-query wrapper and scoped the hide rule to `.song-item .song-artwork`
  (artist-page rows only). Covers now render on desktop and mobile cards; the kit's
  striped-placeholder guidance stays for the 39 manual-only songs.
- **2026-07-10 — Script keep-list revised at execution time (Session 2.3).** The Phase 0
  inventory's keep-list was written before Phase 1 existed; by 2.3 two of its five keeps
  were superseded and one was misnamed. **Kept 4:** `consolidateSpreadsheets.js` +
  `enrichFromSpotify.js` (the Phase 1 truth-source/enrichment pipeline, both dry-run by
  default), `auditDatabase.js` + `exportAllSongsData.js` (read-only utilities). **Dropped
  from the keep-list:** `importSpotifyDataEnhanced.js` and `syncSpotifyPlaylist.js`
  (enrichFromSpotify.js is explicitly the "single replacement for the three legacy import
  paths"; the inventory kept sync only "until the Phase 1 pipeline replaces it") and
  `runMigration.js` (despite the name it was hardcoded one-off ALTER TABLEs — half of them
  the dropped audio-features columns — not a migration runner; schema changes are SQL
  files in `database/migrations/` applied via psql). Deleted rather than archived (user
  choice; git history preserves all 37 — `git log --diff-filter=D -- backend/scripts`).
  Verified before deleting: no script is referenced by package.json, server code, the
  launcher .bat files, or another script.
- **2026-07-09 — Admin UI consolidation choices (Session 2.2b).** (1) **Approve = approve +
  queue**: the Submissions "Approve" button became "Approve & add to pending" — one action
  that sets the status and calls the authed 2.2 bridge (per the audit decision that approval
  must stop being a status-only dead end); a separate "Add to pending queue" button covers
  submissions approved before the bridge existed (the bridge is idempotent, so double-clicks
  are safe). (2) **The shared categorisation form uses toggle buttons** (the Bulk workflow's
  interaction), replacing the Manage Songs modal's ctrl-click multi-selects — same five
  fields, same endpoints, one component (`CategorizationFields.jsx`); the workflow also
  stops rendering genre lists as category buttons (it used to render *every* key of
  `categorization-options`, including the 149 subgenres). (3) **`adminFetch` sends the
  password header everywhere, including unauthenticated `/api/submissions/admin*`** —
  harmless today, and it means Phase 4 can turn auth on server-side without touching the
  frontend. (4) **Audio-features form fields kept** in the two song-edit forms (only the
  analytics endpoint + dashboard chart were in the Phase 0 drop; removing form fields is a
  curator call for later). (5) **Fixed rather than preserved:** the genre/parent-genre
  selects in both song forms were broken no-ops (a multi-select whose onChange never fired) —
  rebuilt as real single selects, and the modal now actually submits `genre`/`parent_genre`. (1) **`admin.js` stays one
  file with six banner-named domain sections** rather than splitting into per-domain modules
  — the audit allowed either; a single file with banners is the smallest change that makes
  the file read as its domains (YAGNI; revisit if a domain grows). (2) **The
  submissions→pending bridge matches Spotify conservatively first** (same normalised
  title-AND-artist rule as 1.2's attach) and imports via the staging candidate intake for
  full enrichment; with no confident match it creates a minimal `manual` pending song —
  preserving the submitted YouTube link as the song's play link — and never guesses. Either
  way the submission row's `existing_song_id` is pointed at the catalogue song, making the
  bridge idempotent. (3) **Catch-up migrations document applied state, not the routes'
  literal DDL** — `004` records `artists.data_source` as the live `VARCHAR(20)` (the
  deleted route's `VARCHAR(50)` ADD COLUMN was always a no-op against the existing column).
- **2026-07-08 — Frontend folder convention (Session 2.1).** Route-level screens live in
  `src/pages/` (one file per route); anything used by more than one page or section lives in
  `src/components/`. Single-consumer helpers stay local to their page file (YAGNI — e.g.
  `CreatePlaylistModal` inside `PlaylistsPage.jsx`, `AudioFeatureBar`/`CategoryBadges` inside
  `SongDetailPage.jsx`). Extraction was verbatim (same behaviour); the only code removed was
  dead: `ArtistsPage` (never routed, Phase 0 drop) and the unused `DescriptionSection`.
- **2026-07-08 — Admin consolidation decisions (audit → [`ADMIN_AUDIT.md`](./ADMIN_AUDIT.md),
  curator-confirmed).** (1) **Sync moves into the Staging tab** — the Duplicate Manager Sync
  button and Staging's Add candidates do the same import-as-pending job on the same backend
  (`utils/playlistSync.js`); one intake surface, and Duplicate Manager becomes pure
  data-quality. (2) **One shared categorisation form, both entry points kept** — the Manage
  Songs modal and the Bulk Categorization workflow duplicate the same form against the same
  endpoints; extract one component, lose no workflow. (3) **Submissions→pending bridge built
  in 2.2** (curator chose build over defer): approving a community submission will add the
  song to the pending queue via the existing staging candidate-intake service, instead of
  being a status-only dead end. Audit also fixed the scope of 2.2: of `admin.js`'s 47 route
  definitions only 28 are live; 17 are dead (6 test, 5 playlist endpoints unused because the
  tab uses the public API — two of them duplicate definitions in the same file, 3 sync-era
  reports on a column nothing writes since 1.2, 3 misc) and 2 are DDL-over-HTTP to convert
  to migrations.
- **2026-07-08 — Staging UI ships without lyrics paste / categorisation (Session 1.4).** The
  `PROJECT_PLAN.md` line for 1.4 mentioned lyrics paste + categorisation in the To-process
  view, but `PUBLICATION_STAGING_DESIGN.md` §4 rules categorisation explicitly *non-essential*
  for going live (requiring it would empty the site; vegan-themes coding is its own future
  workstream). Curator confirmed **ship as-is** (YAGNI): the To-process view exposes Attach
  Spotify / Add play link / Include / Include&Publish / Reject — enough to take a pending song
  live end-to-end. Local-only lyrics paste and categorisation editing are deferred to a later
  session when the thematic-coding workstream starts.
- **2026-07-07 — Duplicate merge keeps the 2025 canonical (Session 1.3).** For all 18 true
  dup pairs the 2025-import row was kept: it carries the curatorial enrichment (genre / mood),
  the YouTube video, and the playlist-added date; the 2026 row was bare except a fresher
  `popularity`. Merge backfills **only NULL enrichment scalars** (never curator-owned fields;
  `popularity` takes the max) and re-points child refs before deleting the loser — so nothing
  is lost (the one case where the loser also had a YouTube video re-pointed it, demoted to
  non-primary). To The Grave's two both-2026 pairs had no richer side; curator chose the
  "Still" release. Orphan albums/artists are pure Spotify enrichment with no songs pointing at
  them → safe to delete. Sheet-vs-DB status conflicts and attach typos stay curator calls
  (`SESSION_1.3_CURATOR_DECISIONS.md`), consistent with the 1.1 "import never overrides
  curator state" rule.
- **2026-07-07 — Publication staging added (Session 1.2b, approved).** Being in the
  catalogue (`status`, curator's inclusion decision — unchanged from 0.4) and being
  presentable are separate facts: a new `published` boolean marks included songs as live.
  Essentials for publishing: a play link (Spotify/Bandcamp/SoundCloud/YouTube) + album
  artwork + curator verification — verification IS the Publish click (never automatic;
  categorisation deliberately not required, or the site would empty). Migration
  grandfathered the 1,359 complete included songs as published; 39 incomplete wait in
  "To finalise". Workflow queues: To process = pending, To finalise = included+unpublished,
  Live = included+published. Spec: `PUBLICATION_STAGING_DESIGN.md`.
- **2026-07-07 — Enrichment is provably curatorial-safe (Session 1.2).** The pipeline writes
  only enrichment-class fields (audit §7); verified with an md5 checksum over all
  curator-owned columns + `song_lyrics` before/after the run — byte-identical for every
  pre-existing row. Attach matching is conservative (normalised title AND artist must both
  match) — 34 unmatched go to review rather than guessing. Sync endpoints are now
  import-only: playlist tracks missing from the catalogue become `pending`; nothing is ever
  flagged removed or auto-changed (`removed_from_playlist` is no longer written by anything).
- **2026-07-07 — Import conflicts never change curator state (Session 1.1).** Where a
  spreadsheet row said reject/pending but the matched DB song is `included` (18 rows), the
  import reports it and leaves the song untouched — sheet vs DB disagreements are for the
  curator, not the script. Rejected rows are imported minimally and stay minimal on re-runs
  (no lyrics/URLs). Unclassifiable `Processed` values become `pending` with the raw value in
  `status_notes` rather than being guessed at.
- **2026-07-07 — Public catalogue queries use `LEFT JOIN albums` (Session 1.1).** Non-Spotify
  songs have no album row; the old inner joins made them invisible while still counted.
  First-class non-Spotify songs are a core truth-source requirement, so album data is
  optional everywhere public.
- **2026-07-07 — Truth-source model decided (Session 0.4, approved).** A song is in the
  catalogue because the curator says so: `songs.status` (`pending`/`included`/`rejected`) is
  curator-owned; Spotify is optional enrichment, **import-only** (no push, no auto-removal);
  non-Spotify songs are first-class (Bandcamp/YouTube/SoundCloud); full lyrics live in a
  **local-only** `song_lyrics` table (never git/API/production — copyright); undecided
  spreadsheet rows become an in-website pending queue; rejected candidates are kept as
  `rejected` rows. Full spec: `TRUTH_SOURCE_DESIGN.md`. Spreadsheets at `docs/playlist/`
  gitignored same day.
- **2026-07-07 — Curator data decisions (from the 0.2 audit questions).** (1) The Apr-2026
  534-song batch is a vetted batch of new songs. (2) Curatorial coding lives in a couple of
  spreadsheets → they are the Phase 1 import source. (3) Mood/genre tags are **regenerable
  enrichment**, not curation — a more robust generation approach is future work. (4) **Drop
  audio features** (UI panels + analytics endpoint) — data is NULL and Spotify no longer
  provides it.
- **2026-07-07 — Sync endpoints re-pointed at the correct playlist.** The hardcoded default
  in `sync-spotify-playlist` / `spotify-playlist-mismatch` was an unrelated 500-track Lofi
  Girl playlist; one click of the admin Sync button would have flooded the DB and flagged the
  whole catalogue as removed. Default now `5hVygGomw9zax38quC6mhi` ("Animal Lib & Vegan
  Songs", verified live). Dataset-protection fix shipped mid-audit rather than waiting for
  the Phase 1 sync rebuild.
- **2026-07-07 — Curator confirmed the flagged inventory decisions.** Public playlist
  creation/mutation is **deferred** until a real auth story (Phase 4+); the two pre-auth
  admin test routes were **removed immediately** (`admin.js` — one wrote `songs.featured`
  with no password). Verified post-fix: both return 401; public API unaffected.
- **2026-07-07 — Feature Inventory decisions recorded** in
  [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md): all public screens and curation tooling
  **keep**; Spotify sync **rebuild** in Phase 1 (truth-source boundary); ~20 debug/superseded
  endpoints, `admin_simple.js`, dead `ArtistsPage`, and 3 DDL-over-HTTP endpoints **drop**
  (Phase 2); public playlist creation **defer** pending auth (⚑ user to confirm the flagged
  items). Rationale: preserve every behaviour the curator relies on; remove only what nothing
  calls.
- **2026-07-06 — Security cleanup before Phase 0.** Rotated the Postgres password (old one was
  committed to public GitHub history via `.claude/settings.local.json`); untracked and
  gitignored that file; moved the admin password out of frontend source into env vars
  (`ADMIN_PASSWORD` / `VITE_ADMIN_PASSWORD`) and rotated it; removed password logging from the
  admin auth middleware. Proper admin authentication deferred to Phase 4 (YAGNI — env-var
  shared password suffices while local-only).
- **2026-07-06 — One living state doc.** Current-state and decision log live together in this
  file (not split) — simplest thing that works (YAGNI). Revisit if it grows unwieldy.
- **2026-07-06 — Modernise, don't rewrite.** Preserve backend + PostgreSQL + 650-song dataset;
  rebuild frontend and ops layer. A greenfield rewrite risks losing subtle, hard-won logic and
  curation. Feature Inventory (Phase 0) is the safety net.
- **2026-07-06 — Truth source becomes the curated dataset; Spotify becomes enrichment.** A song
  exists because the curator says so, not because it's on a Spotify playlist. Spotify fills
  details where a match exists and never overwrites curatorial data. Enables multi-platform
  songs (Bandcamp, YouTube, etc.).
- **2026-07-06 — Retain the tech stack** (React/Vite, Node/Express, PostgreSQL). The pain is
  architecture/brand/deployment, not the stack itself.
- **2026-07-06 — Phased approach adopted** (Phases 0–4). Code-changing sessions end with a
  smoke test.

---

## Changelog

Newest first. What actually happened each session.

- **2026-07-22 (Filter/analysis presentation — built + verified, pending curator smoke)** — On
  `session-presentation-polish`, six tasks from the curator's 1a+1b smoke follow-ups. New shared
  `FilterSection` (every sidebar group collapses identically, with a description on expand) and
  `InfoTip` (~120ms tooltip replacing the native `title`). The sidebar is now eight uniform top-level
  sections — Genre & style, Themes & advocacy, Lyric metadata, Year range, Song length, Available on,
  Analysis, Language — with the five theme dimensions and seven metadata components nested as the same
  visual unit, each carrying its own description. Descriptions are API-served: component text from the
  codebook, five new dimension descriptions added to `taxonomy.json`. Song page gained "i" icons on the
  seven component labels and five dimension headings, emotions on one full-width line separated by `;`,
  and a two-column dimension layout. After the curator's smoke of the batch, sidebar descriptions moved to
  hover ("i" on each heading) while usage notes stayed visible. Backend **121/121** (4 new); lint 0
  errors; headless verification
  of structure, tooltips, layout at two widths, and a full filter regression. Not yet merged — awaiting
  the curator's look at the restructured sidebar.

- **2026-07-22 (Triage 1a+1b — two-tier analysis read + scalar browse filters, MERGED `a6eb05a` after
  curator smoke)** — On `session-triage-1a1b-analysis-tiers`, seven tasks, subagent-driven with a review gate each.
  A start-of-session DB check found the curator's reanalysis had landed (`gemini-3.5-flash-lite`, 100%
  clean codebook enums), closing the gate that parked triage 1a and un-deferring 1b. Shipped:
  `services/metadataCodebook.js` (pure — labels, definitions, the suppressed-code set, scalar WHERE
  clauses); `CODE_MODEL`/`SCALAR_MODEL` replacing `DEFAULT_MODEL` across eight consumer sites;
  `getSongAnalysis` reading both tiers in one query; scalar filters in `/search` (alias `sca` beside the
  code tier's `sa`); `analysis.scalarFacets` + `scalar_facets` exclude-self counts on `/browse-facets`;
  seven collapsed sidebar groups on the existing URL/sessionStorage state; the song-page attributes card
  with an Audience row, codebook labels and definition tooltips. Also fixed a stale admin string
  (`AnalysisPanel.jsx` still said "Coded with gemma4:latest"), found by a reviewer outside the plan's
  scope. Backend **114/114** (+24 over the branch); frontend lint 0 errors + clean build; `has_analysis`
  640 → **665**. **Merged no-ff to `main` (`a6eb05a`) after the curator's smoke**; merged main
  re-verified 114/114 + clean build. The smoke also produced a scalar-data episode worth recording: the
  curator re-ran the tier mid-session, which fixed empty `emotions` (321/679 → 4) but briefly shipped 10
  off-codebook values (typos, prompt-template artifacts). They were corrected immediately, and the
  episode drove a durable guard — `getSongAnalysis` now gates display through the same `cleanSelection`
  the filters use, so the public page can only render a value you could also filter by. The smoke's two
  UI follow-ups (uniform collapsible sidebar sections with descriptions; faster tooltips) became their
  own spec + plan rather than scope creep, gated on triage 4 merging first.

- **2026-07-21 (Triage 4 — browse/search polish, MERGED)** — On
  `session-triage-4-browse-polish`: bidirectional sort via a whitelisted `dir` param + a pure
  `browseFilters.buildOrderBy` (replaced the inline `/search` switch, dropped the dead audio-feature
  sorts); a frontend direction toggle with contextual labels that resets on sort-field change; `dir`
  persisted in the URL (item-2 model); and an independently-scrolling filter sidebar (`max-height` +
  `overflow-y:auto`). Backend 92/92 (3 new `buildOrderBy` tests); full-stack smoke all-pass (temp :5001
  `dir` reverses order; headless :5173 sort/sidebar 10/10). Merged to `main` with triage 1a+1b already in place; the three-file conflict (browseUrlState keys, browseFilters tests, this file) was additive and resolved by keeping both sides.

- **2026-07-21 (Triage 3b — Featured management view, built + verified, pending merge)** — On
  `session-triage-3b-featured-manage` (follow-up to triage 3 from the curator's smoke): an admin **Featured
  scope** (rail + count + Dashboard tile) lists every featured song with a **quick Unfeature** button
  (reuses `/unfeature`), plus a **Featured badge** on rows in any scope. Backend `featured` queue +
  `queueCounts.featured` + per-row `featured` field. Curator-chosen unfeature-only. Backend 90/90 (1 new
  test); API smoke all-pass (counts/scope/row/unfeature/badge; featured set restored). Not yet merged.

- **2026-07-21 (Triage 3 — featured-songs redesign, merged `6718cec`; ⚠ pending curator smoke)** — On
  `session-triage-3-featured` (merged no-ff to `main`): featured fill switched from random-from-catalogue to deterministic
  most-recently-added, with the pinned query cycling a random 4 when >4 are pinned; restored a "Featured"
  toggle in the workbench top bar (`curation.setFeatured` + `POST /songs/:id/feature|unfeature`;
  `getWorkbench` returns `featured`); dropped the inconsistent added-date from `SongCard` (mood chip kept).
  Backend 89/89 (new `setFeatured` test); featured endpoint + routes smoke all-pass on a temp :5001
  backend (original `songs.featured` set restored); card-date puppeteer 0/24. Merged `6718cec` at the
  curator's request (option 1) while they were away; **in-browser smoke still owed** (see the pending-smoke note near the top).

- **2026-07-20 (Curator-triage build session — triage 2 built, triage 1a parked)** — Two items advanced
  while the curator cleans the DB. **Triage 2 (persist browse state) — BUILT** on
  `session-triage-2-browse-state` (pending curator review/merge): homepage browse filters/sort/search/page
  now persist in the URL (react-router `useSearchParams`, hydrate-on-mount + mirror-on-change with
  `replace`; new pure `frontend/src/utils/browseUrlState.js`; page via a disjoint second writer; removed
  `SearchSection`'s redundant initial fetch). Headless puppeteer smoke **10/10**; caught + fixed a
  StrictMode page-reset bug (value-signature ref). Frontend build + eslint clean (0 errors). **Triage 1a
  (`key_focus_pipeline` adoption) — spec + plan written, EXECUTION PARKED** on `session-triage-1a-key-focus`
  pending the DB-cleaning signal: a read-only DB check showed the six scalars are identical across tiers
  and free-text (not the taxonomy enums, intensity/focus 0/637), so the "split read" is unnecessary and
  the scalar filters (1b) are deferred to the pipeline; scope narrowed to a one-constant flip of
  `analysis.DEFAULT_MODEL` → `gemma4:key_focus_pipeline`. Also committed a refreshed
  `frontend/public/vector_space.json` (key-focus coding, B4 input, `2a22e37`). Neither triage branch is
  merged yet.

- **2026-07-20 (Curator-triage review + capture — docs only, no code changed)** — Reviewed a batch of
  curator-reported issues against the current code and captured them in a new
  [`CURATOR_TRIAGE_BACKLOG.md`](./CURATOR_TRIAGE_BACKLOG.md) (with per-item root causes), plus a pointer
  from this file. Confirmed **5 already resolved** (Fixes Round 1's lyrics-URL strip, Park-reason
  persistence, title+artist duplicate gate, All-songs admin search; and the sort-overlap layout).
  Remaining items scoped + sequenced after B4: the **`key_focus_pipeline` split-read** switch (code
  dims from key-focus, six scalar components from the deep tier) **+** scalar-attribute browse filters;
  persist browse state across navigation; featured-songs redesign; browse/search polish (sidebar
  scroll, bidirectional sort); lyric highlights from the translation + multi-language `songs.language`;
  About analysis-explainer + AI-disclosure page; vector "You might also like". No smoke test (no code).
  **Curator then reprioritised: triage items 1–5 run before B4. Next: triage item 1 —
  `key_focus_pipeline` split-read + scalar-attribute browse filters.**

- **2026-07-20 (Fixes Round 1 — curator data-integrity & UX fixes; merged to `main`)** — Branch
  `session-fixes-round-1` (base `5ec1566`), executed via subagent-driven development (fresh implementer +
  spec/quality review per task; two opus whole-branch reviews — both "ready to merge = yes", 0 Critical/0
  Important). **Backend:** `saveLyrics` writes only provided fields (stops wiping `source_url`/`translation`;
  clearing lyrics keeps the row via `lyrics=''`; all has-lyrics checks → non-empty); `setProcessing` writes
  only provided fields (stops clobbering park/snooze/note); duplicate detector extracted to pure
  `services/duplicates.js` gated on title AND artist; migration **008** `duplicate_dismissals` +
  `services/duplicateDismissals.js` + `POST /api/admin/duplicate-dismiss` (whole-group reject) with the
  detector skipping dismissed pairs; `queueCounts` gained an `all` total. **Frontend:** workbench Park
  control controlled (reflects/persists reason); DuplicateManager **"Not a duplicate"** button; Songs area
  **"All songs"** scope; homepage Sort-by beside the search box; filter chips moved to the top of the results
  column; redundant "Filters applied:" summary removed. **Data:** curator fixed song 1's video
  (`dQw4w9WgXcQ` Rickroll → `RbvTfvUaBxM`) via the new All-songs path. **Verification:** backend
  `npm test` **88/88**; frontend build + eslint clean; live read-only smoke (queueCounts.all 1778, song 1
  reachable, 22 dup groups / 0 cross-artist across 1,778 songs); **curator smoke-confirmed** #1/#2/#3/#5 +
  the reject button + all three UX tweaks. Merged no-ff to `main`; pushed. **Next: B4 — Explore vector map**
  (then the rest of the triaged queue: thematic `key_focus_pipeline`, browse/search polish, featured
  redesign, About/AI page).

- **2026-07-20 (B3 — Browse & Search overhaul; four rounds; merged to `main`)** — Branch
  `session-B3-browse-search` (base `bd33ab2`), 33 commits, +2,999/−610 across 19 files, executed via
  subagent-driven development (fresh implementer + spec/quality review per task; opus whole-branch review
  per round — all clean; round-4 polish inline). **Round 1 — overhaul** (10 tasks): `services/genres.js`
  effective-genre + length helpers; `/filter-options` + `/search` rebuilt onto effective genre (492→~1,003
  coverage); thematic facet tree; length/availability/analysis/language filters; removable chips; year-range
  sizing; deferred 2-codes-same-group `facetTree` test; + a parity fix (`LOWER(TRIM(...))` on the genre
  expr, short-length `>=1` bound) so counts always equal filter results. **Round 2 — sidebar + dynamic
  counts** (8 tasks): shared `services/browseFilters.buildWhere` (tagged clauses); `/search` refactored onto
  it (dead audio-feature/`parent_genres` branches dropped); `facetTree` optional constraint;
  `GET /api/spotify/browse-facets` exclude-self counts; `getBrowseFacets`; left-sidebar layout +
  mobile drawer (SearchAndFilter takes results as `children`); dynamic-count wiring (debounced +
  stale-guard) + zero-count greying; Popularity sort dropped (default → Year); fix wave (scrim token,
  last-good facet guard, greying parity). **Round 3 — selectable facet groups** (5 tasks):
  `analysis.facetSelectionClauses` (code=exact term, group/sub-dimension=OR-term over its codes, AND
  across) + taxonomy reverse maps; `buildWhere` consumes `facet_groups`/`facet_subdims`; `/search`
  `date_added` sort; `ThemeFacetTree` three-level checkbox rows (ancestor-covers-descendants);
  SearchAndFilter wiring (ancestor-select clears descendants, group/subdim chips). **Round 4 — restyle +
  date fallback**: colour-forward theme-tree hierarchy (nested rails, level-distinct type, bigger text) +
  dimension-header left-align fix (button `text-align:center` was the root cause); date sort →
  `COALESCE(playlist_added_at, date_added)`. **Verification:** backend `node --test` **75/75**; frontend
  `npm run build` + `npx eslint src/` clean; live exclude-self smoke consistent (genre sum 1,003, killing
  358 ≤ violence group 473 ≤ cruelty sub-dim 540, browse-facets self-exclusion holds); **curator
  smoke-confirmed every round** (final: theme hierarchy + dimension alignment). Two whole-branch opus
  reviews returned "ready to merge = yes". Merged no-ff to `main`; pushed. **B4 (Explore map) + C–F
  remain.**

- **2026-07-19 (B2 — Song page + workbench panel + mock-UI deletion; merged to `main`)** — Resumed after
  an improper machine shutdown (battery reset). **First verified nothing was lost:** `git fsck` clean
  (only normal dangling merge objects), working tree clean, all 9 B2 commits intact; DB alive and healthy
  (**1,778 songs / 1,366 included / 1,332 live / 167 pending / 245 rejected**; `song_lyric_analysis` 1,853;
  local `song_lyrics` 909 — counts drifted from B1's snapshot via the curator's own analysis/curation work,
  not the crash). B2's code was fully committed on `session-B2-song-page-analysis` (base `4d4f602`); the
  crash had interrupted only the End-Session wrap-up. **B2 delivered (7 tasks):** (1) enriched
  `getSongAnalysis` / `GET /api/analysis/song/:id` with per-code `definition` + resolved scalar **attribute
  labels** (`attributes[{label,value}]`) + `analysis.test.js`; (2) shared **dataviz-validated
  sub-dimension palette** (`styles/subDimensionPalette.js`); (3) the **`LyricalAnalysis`** Option-C
  component (attributes card + sub-dimension-coloured chips + inline mini-legend + "Show evidence" toggle,
  emoji-free); (4) rendered on the **public song page** (`SongDetailPage`, dropping the mock advocacy
  section); (5) **read-only in the admin workbench Analysis panel**; (6) **DataDashboard** theme chart
  labelled from real `analytics/vegan-themes`, dead theme filter removed; (7) **deleted the mock
  categorisation UI** — `CategorizationFields`, `BulkCategorizationWorkflow`, `BulkEditModal` + all
  remaining mock-array reads in HomePage/DataDashboard/ArtistDetailPage/SearchAndFilter. **Verification:**
  backend `node --test` **56/56**; `npm run build` clean, eslint 0 errors (8 pre-existing warnings);
  **live smoke** on fresh backend :5000 + frontend :5173 — `/api/analysis/song/1` returns the full
  enriched payload, `/api/admin/workbench/1` returns `analysis`, `vegan-themes` real (suffering 446 /
  killing 358 / brutality 306), the 3 mock components gone with **zero** references; **curator visually
  confirmed all three surfaces**. Net across the branch: **17 files, +1,005 / −967** (mostly mock-UI
  deletion). Merged no-ff to `main`, pushed. **B3 (faceted browse) + B4 (Explore map) remain.**

- **2026-07-18 (B1 — Analysis Backend & Data Foundation; merged to `main`)** — Executed the 14-task B1
  plan via **subagent-driven development** (fresh implementer + per-task spec/quality review each, then an
  **opus whole-branch review** — all clean) on branch `session-B1-analysis-backend` (base `25f41d5`).
  **Delivered:** `backend/services/analysis.js` (vendored 4-level `taxonomy.json` + loader; `getSongAnalysis`
  with per-code `sub_dimension`/`sub_dimension_label`/`group` enrichment; `facetTree` — the hierarchical
  `Dimension→Sub-dimension→Group→Code` facet tree with **distinct-song** rollup counts; `facetFilterConditions`
  AND-logic `@>` builder; `themeCounts`); a shared `DEFAULT_MODEL='gemma4:latest'` constant (curation.js
  re-pointed at it); public **`routes/analysis.js`** (`GET /api/analysis/song/:id` + `/facets`) mounted +
  added to the lyrics-privacy guard; **`/search`** analysis-facet AND filtering (with a `song_artists`
  `sa`→`sart` alias-collision fix); `curation.getWorkbench` now returns the full `analysis` object;
  `analytics/vegan-themes` + `summary` + `filter-options` repointed off the mock arrays onto
  `song_lyric_analysis`. **Migration 007** (self-guarded) dropped the five empty mock columns + the dead
  `songs_with_manual_categories` view; every reference stripped from `spotify.js`/`analytics.js`/`admin.js`
  (incl. a 33→28-column INSERT renumber) and the `exportAllSongsData.js`/`auditDatabase.js` scripts.
  **Mid-session the curator restructured `taxonomy.json` into the 4-level hierarchy** → spec + B1 plan
  updated (Task 4 `facetCounts`→`facetTree`; song-page/browse/map presentation redesigned around
  sub-dimensions — see Decision Log). **Verification:** backend `node --test` **54/54**; whole-backend grep
  for the 5 mock columns clean (routes+services+scripts); live headless smoke (fresh backend on :5001, the
  curator's :5000 untouched): facet tree with rollup counts, sub-dimension-enriched `/song/:id`, 404 on
  missing, `/search` AND-narrowing 361→58→21, real `vegan-themes` (suffering 447/killing 361/brutality 308),
  workbench `analysis` present. **18 commits merged no-ff to `main` (`4d5d6ee`, 54/54 re-verified on merged
  main), pushed.** Net across the branch: +1,860/−482 (backend). **B2–B4 remain.**

- **2026-07-17 (B — brainstorm + spec + B1 plan; planning only, no smoke test)** — Started sub-project B
  (Analysis Integration). Verified the shared DB holds the real analysis data: `song_lyric_analysis` 685
  songs on `gemma4:latest` (508 gemini, unused) with GIN indexes on all five JSONB dimensions;
  `song_embeddings` 1,748; `frontend/public/vector_space.json` 658 songs. Located + read the
  `taxonomy.json` codebook (five evidence dimensions themes/targets/actions/tactics/moral-frames as
  `{id,label,definition}` + scalar categories) at
  `C:\Users\Owner\.gemini\antigravity\scratch\vegan-playlist-analysis\data\taxonomy.json`. Brainstormed
  the design with the curator using the **visual companion** (three song-page layouts → "Option C"
  expanded/emoji-free; browse facet scope → full/all-AND with a coded-only note; vector-map concept → own
  "Explore" page, 2D+3D, colour-by theme, spotlight filter). Confirmed the five mock categorisation columns
  are empty across all 1,821 songs (safe to drop). Wrote & committed the design spec (`139a1cc`) and the
  **B1** implementation plan (`ae2f826`, 14 TDD tasks). No production code changed. **Next:** execute B1
  via subagent-driven development.
- **2026-07-17 (A4 — Admin Dashboard landing + cleanup; closes sub-project A)** — Brainstormed →
  spec ([`specs/2026-07-16-admin-dashboard-A4-design.md`](./superpowers/specs/2026-07-16-admin-dashboard-A4-design.md))
  → plan ([`plans/2026-07-16-admin-dashboard-A4.md`](./superpowers/plans/2026-07-16-admin-dashboard-A4.md))
  → executed 6 tasks via **subagent-driven development** (fresh implementer + per-task spec/quality
  review each, then an **opus whole-branch review** — all clean) on branch `session-A4-dashboard`
  (base `28e44e0`). **Delivered:** the `/admin` `DashboardStub` replaced by a real **`Dashboard.jsx`** —
  **"Needs your attention"** action tiles (To be processed / Needs lyrics / Needs cover / Needs video /
  To finalise, each a link to `/admin/songs?queue=<key>`; **Inbox** tile disabled for sub-project C),
  a compact **"Catalogue health"** line, a **"Recent activity"** feed (last 10 edited songs → their
  Curation Workbench), and **Add-a-song** (reuses `AddSongPanel`). **Two read-only backend endpoints
  (TDD):** `curation.catalogueStats` → `GET /api/admin/curation/catalogue-stats`; `curation.recentlyEdited`
  → `GET /api/admin/curation/recent`. New dashboard styles in `admin.css` (tokens only) + a
  `.queue-status.rejected` rule. **Cleanup:** deleted the old **admin** `DataCompletionDashboard.jsx`
  (523 lines, unmounted since A2), its orphaned `GET /completion-stats` route (229 lines), its exclusive
  `App.css` block, and `DashboardStub.jsx` — **preserving** the shared `.stat-card`/`.action-buttons`
  and (plan-erratum catch) `.stat-value`. **The public `DataDashboard.jsx` was NOT touched.** Net
  **+228 / −1127** (mostly dead-code removal). **Two implementer deviations accepted as correct fixes**
  (isNaN limit clamp; keeping shared `.stat-value` — see Decision Log). **Verification:** backend
  `node --test` **45/45** (pristine, incl. 3 new tests); `npm run build` clean, eslint 0 errors; **live
  headless smoke** (endpoints correct, `completion-stats` → 404, all tiles navigate, Inbox inert,
  Add-a-song round-trip, DB baseline restored) **plus the curator's manual walk (13/13)**. Merged to
  `main` no-ff (`77ea3b5`, 45/45 re-verified on merged main), feature branch deleted, **pushed to
  `origin/main`** (this push also carried the earlier unpushed A4 spec+plan doc commits). **Sub-project
  A (Curation Workbench & lifecycle) is complete — B is next.**

- **2026-07-16 (Phase 3 + admin manual smoke test + polish)** — Between-phases verification session
  (the curator's call, to avoid accumulating un-clicked work before A4). The curator manually walked
  the **Phase 3 public site** (Home, Browse/Search, Song Detail, Artists, Playlists, Submit,
  Dashboard, About, responsive) and the **Phase 4 admin so far** (A2 nav shell + A3 Curation
  Workbench). **Result: all core flows work** on both surfaces. Seven polish items surfaced and were
  fixed in one pass (see Decision Log): admin **login layout** (root cause = a dead legacy
  `.admin-login` block in `App.css` deleted — a first width-only attempt didn't fix it), redundant
  **genre filter chips** removed, **playlist-card covers** derived from member album art (read-only
  `GET /api/playlists` subquery), Remind-me **date field** widened, **Attach-Spotify** button
  repositioned under the Spotify URL, and a **"Set English"** language quick-pick. Two curator
  feature requests also landed: **Search YouTube** (Video panel) + **Search Bandcamp** (Links)
  quick-search links, and **"Open ↗"** buttons on saved Spotify/Bandcamp/SoundCloud URLs. Net
  **10 files, +92/−196** (mostly dead-CSS removal). **Verification:** eslint 0 errors, `npm run
  build` clean, playlists route returns real derived `cover_images`; **curator manually re-confirmed
  every fix**. No curatorial data touched (backend change is a single read-only public subquery).
  Committed + pushed straight to `main`. **A4 remains next.**
- **2026-07-16 (A3 — the Curation Workbench)** — Executed plan
  [`plans/2026-07-14-admin-workbench-A3-page.md`](./superpowers/plans/2026-07-14-admin-workbench-A3-page.md)
  (spec [`specs/2026-07-14-admin-workbench-A3-page-design.md`](./superpowers/specs/2026-07-14-admin-workbench-A3-page-design.md))
  via **subagent-driven development** on branch `session-A3-workbench` (base `72b45a8`) — a fresh
  implementer per task + per-task spec/quality review, then a whole-branch review. **Delivered:**
  the full-page workbench at `/admin/song/:id` replacing the A2 stub — a sticky **top bar**
  (`WorkbenchTopBar`: status badges, five-item completeness row, lifecycle buttons
  Include/Include&publish/Reject-with-confirm/Publish/Unpublish/Re-include + Park/Remind, and
  within-page **‹ Prev / Next ›** paging the queue via `location.state`), a **container**
  (`Workbench.jsx`) that fetches the single assemble-read `GET /workbench/:id` and swaps whole-`wb`
  on panel PUTs / merges partials / `reload()`s after video+lifecycle routes, a shared
  autosave-on-blur primitive (`SavedField.jsx`: `AutoText` + `SaveTag`), and six panels — **Details**
  (title/language autosave, read-only meta, cover paste), **Lyrics** (paste, status, source, avenues,
  quick-search links, translation, + an **interactive highlights picker**), **Video** (add-by-URL/id,
  set-primary, delete), **Links** (Spotify/Bandcamp/SoundCloud + attach-Spotify), **Analysis**
  (read-only), **Notes**. Deleted 5 superseded components (`WorkbenchStub`, `StagingQueue`,
  `LyricsLookupManager`, `YouTubeVideoManager`, `ManageSongsTab`) after a clean parity check +
  importer grep. **Frontend-only — no backend file changed.** Four review-surfaced defects were
  fixed rather than shipped (curator-approved each): the `SavedField` save-tag race, a false
  "Saved" on translation-before-lyrics (fields now disabled until lyrics exist), highlights
  fragmentation + content-identity (newline-collapse + index keys), and a save-failure feedback
  **class standard** (all mutations await + surface via `SaveTag`, `adminFetch` calls wrapped in
  try/catch). The whole-branch review additionally caught that `savePanel`/`saveProcessing`
  bypassed Task 8's stale-nav token guard (save-then-Next could render the previous song) — fixed
  by extending the guard to both helpers (provably race-free: token capture + increment are both
  synchronous). **Verification:** backend `node --test` **42/42** pristine; `npm run build` clean,
  eslint 0 errors; **headless workbench smoke 10/10** (lyrics→Saved+completeness, highlight add,
  video add→primary, Spotify URL→play-link, Include&publish→live, Prev/Next + direct-URL hides them,
  Reject-confirm cancel, reload persistence); throwaway probe songs used throughout and cleaned up,
  DB queue counts identical before/after (4 leftover test songs from earlier A3 sessions also swept).
  **Merged to `main`** via no-ff merge `8579b4e` (42/42 re-verified on merged main), feature branch
  deleted, and **pushed to `origin/main`** — the same push carried the earlier unpushed A2/3.x
  backlog (main had been 16 commits ahead of origin).
- **2026-07-14 (A2 — admin nav shell + Songs area)** — Brainstormed → spec
  ([`specs/2026-07-13-admin-workbench-A2-shell-songs-design.md`](./superpowers/specs/2026-07-13-admin-workbench-A2-shell-songs-design.md))
  → plan ([`plans/2026-07-13-admin-workbench-A2-shell-songs.md`](./superpowers/plans/2026-07-13-admin-workbench-A2-shell-songs.md))
  → executed 7 tasks via **subagent-driven development** (fresh implementer + per-task spec/quality
  review each, then a final whole-branch review — all clean) on branch `session-A2-shell-songs`
  (base `0e8ce62`). **Delivered:** the old 10-tab `AdminInterface` replaced by a **5-area
  nested-route shell** (`AdminLayout` = client-side login gate + horizontal top-bar nav + `<Outlet>`;
  routes `/admin` Dashboard-stub · `/admin/songs` · `/admin/artists` · `/admin/playlists` ·
  `/admin/data-quality` · `/admin/song/:id` Workbench-**stub**); the **Songs area** (`QueueRail`
  off `/curation/counts` grouped Capture/Needs-work/Parked/Publish with Inbox + Needs-analysis
  disabled as C/B stubs; `SongQueueList` off `/curation/queue` with missing-item chips, debounced
  search, Prev/Next paging that never misuses `total`, `?queue=` URL sync + sanitize→`to-process`
  for disabled/unknown keys, row-click → Workbench stub); a working **Add a song** modal (quick
  capture + Spotify paste); Artists/Playlists/Data-quality **re-parented untouched**. **Two small
  backend additions (TDD):** a `live` key in `curation.queueCounts`; `curation.quickCapture` +
  `POST /api/admin/curation/quick-capture` creating a **pending** manual song (the legacy
  `manual-songs` endpoint defaults `status='included'`, wrong for fresh captures). New
  `frontend/src/styles/admin.css` (design tokens only). `AdminInterface.jsx` deleted; 7 superseded
  tool components **unmounted** (files retained for A3/A4). **Verification:** backend `node --test`
  **42/42**; `npm run build` clean, `eslint` 0 errors; **headless smoke 17/17** (login gate,
  5-area top-bar nav, rail with live count 1342, disabled slots, 50-row list + friendly header +
  chips, add-a-song bumping to-process 193→194, search, row→stub `/admin/song/6573`, all areas
  render; test rows cleaned, to-process back to 192). Two console errors observed are
  **pre-existing, in re-parented untouched components** (ArtistsManager's stray
  `via.placeholder.com` → `ERR_CONNECTION_CLOSED`; a `<style jsx>` non-boolean-attr warning),
  flagged since 3.3 — not A2 regressions. Final review deferred a handful of Minors to A3
  (non-transactional quickCapture upsert; debounce delays paging + no AbortController; a11y
  backdrop-close). **Merged to `main` 2026-07-14** (merge head `b5ec26f`); a same-day
  curator-requested follow-up moved the 5-area nav from a left sidebar to a **horizontal top
  bar** (queue rail stays the left column in Songs).
- **2026-07-13 (A1 — data & backend foundation; incl. power-outage recovery)** — Executed plan
  [`A1`](./superpowers/plans/2026-07-12-admin-workbench-A1-backend.md) — all 7 TDD tasks:
  **migration 006** (`song_processing` table, `songs.language`, local-only
  `song_lyrics.translation` — applied via psql); **`backend/services/curation.js`** (processing
  state upsert with `park_reason`/snooze; derived queues `to-process` / `awaiting-community` /
  `remind-later` / `needs-lyrics` / `needs-cover` / `needs-video` / `needs-analysis` /
  `to-finalise` + `queueCounts` incl. submissions `inbox`; `getWorkbench` assemble-read; per-panel
  saves details/lyrics/highlights/links/cover); **`backend/services/videos.js`** (the
  "exactly one primary per song" invariant — add/update/setPrimary/delete with promotion);
  **lyrics-privacy guardrail** (`lyrics_privacy.test.js` asserts no public route references
  `song_lyrics`/`translation`). Routes added to `admin.js` under a "Curation workbench" banner,
  all behind `authenticateAdmin`. Reuses `staging.js` lifecycle unchanged. **The session was cut
  off by a power outage** after the work was committed + merged to `main` (`145efbb`, plus a
  parallel-race test fix `35a632a`) but before End-Session ran. **Recovered 2026-07-13:** re-ran
  the full suite (**40/40 green**), live-route smoke against a fresh backend ✅
  (`curation/counts` → 200 real data [192 to-process, 603 needs-lyrics, 715 needs-video, 43
  to-finalise, 2 inbox]; `curation/queue` → rows with computed `missing[]`; `workbench/541` →
  full assembled object, completeness all true, full lyrics returned on the admin path;
  `workbench/-999` → 404; no-header → 401), updated these docs, and pushed the 9 backlogged
  commits. **No frontend yet** — A2–A4 consume these endpoints (A2 plan still to be written).
- **2026-07-12 (Admin brainstorm + A1 planning)** — Design/planning session, **no production
  code changed** (no smoke test). Brainstormed the admin-layer rebuild with the curator via
  user stories; wrote and committed the design spec
  [`superpowers/specs/2026-07-12-admin-workbench-design.md`](./superpowers/specs/2026-07-12-admin-workbench-design.md)
  (`45a5566`) — admin reorganised 10 tabs → 5 job-areas around a single full-page Curation
  Workbench + derived queues, decomposed into sub-projects A–F (see Decision Log). Then wrote
  and committed the first implementation plan
  [`superpowers/plans/2026-07-12-admin-workbench-A1-backend.md`](./superpowers/plans/2026-07-12-admin-workbench-A1-backend.md)
  (`c1ac727`) — A1 = data + backend foundation, 7 TDD tasks (migration 006:
  `song_processing` / `songs.language` / `song_lyrics.translation`; `curation.js` service:
  processing state · derived queues + counts · workbench assemble-read · per-panel saves;
  `videos.js`: one-primary invariant; a lyrics-privacy guardrail test), reusing the existing
  `staging.js` lifecycle. Also created `docs/LYRICS_ANALYSIS_INTEGRATION.md` (curator-supplied)
  documenting the shared `song_lyric_analysis` table + `taxonomy.json` codebook that B will
  consume. `PROJECT_STATE.md` + `PROJECT_PLAN.md` updated: admin rebuild = **Phase 4**,
  deployment → **Phase 5**. Frontend plans A2–A4 to be written against A1's real endpoints.
- **2026-07-11 (Session 3.3)** — Remaining pages & polish (closes Phase 3). On branch
  `session-3.3-remaining-pages` (base `4627464`, plan committed at `c272c1d`), 9 code
  tasks + full smoke test, all review-approved: **(1) Playlists made read-only**
  (curator decision — see Decision Log): kit playlist cards, Create-playlist button/
  modal and `AddToPlaylistModal.jsx` deleted (26 → 25 components), remove-song control
  gone from playlist detail, dead "coming soon" play button removed from `SongCard`;
  backend playlist routes untouched (still serve the admin Manage Playlists tab).
  **(2) Playlist Detail** restyled to artist-page row conventions, fixing the 3.2-era
  40px-thumbnail clash. **(3) Submit** — kit form + guidelines sidebar. **(4) Dashboard**
  — kit layout, Chart.js recolored to brand tokens (ember line, moss bars — rainbow
  palette gone). **(5) About** — kit structure with the curator's merged copy (care/
  appreciation framing, "critique animal exploitation" wording — see Decision Log),
  live stat badges via new shared `frontend/src/utils/stats.js`. **(6) Accessibility
  pass**: keyboard access (Enter + Space + `aria-label`) on every clickable card,
  `aria-label`s on icon-only controls, an alt-text audit, exactly one `<h1>` per route
  (the app-shell heading became `.site-title` — a home link — freeing each page to own
  its `<h1>`), focus-visible rings on cards. **(7) Admin light touch**: headless walk of
  all 10 tabs found zero breakage from the public restyle (no diff, no task review —
  see Decision Log). **(8) App.css bridge cleanup**: legacy monolith **6,287 → 5,187
  lines** this session (dead public blocks + unused bridge `:root` vars removed); both
  pre-existing esbuild CSS warnings eliminated. **Incident:** a PowerShell 5.1
  whole-file rewrite corrupted BOM-less UTF-8 into mojibake in
  `ArtistSearchAndFilter.jsx` (Task 7) — repaired byte-identical in a follow-up commit
  (`58393cb`); root cause + fix now a standing watch-out (per-hunk `Edit`, never a
  whole-file PowerShell rewrite, for any file with non-ASCII glyphs like → or box-
  drawing characters). **Smoke test ✅ (Task 10):** full headless walk of all 11 routes
  at 1280 **and** 390 (22 checks) — real data renders, zero horizontal overflow, zero
  console/page errors, zero emoji in visible public text (the only unicode hits are
  intentional `←`/`→`/`↗` navigation glyphs); `grep via.placeholder frontend/src` = 1
  match, but it's in admin-only `ArtistsManager.jsx`, untouched since before this
  session (pre-existing, out of scope — flagged for a future admin pass). Admin login +
  all 10 tabs walked at 1280: clean except two **pre-existing, admin-only, untouched-
  this-session** issues surfaced for the record — a `net::ERR_CONNECTION_CLOSED` on the
  Manage Artists tab's stray `via.placeholder.com` fallback image, and a `<style jsx>`
  non-boolean-attribute React warning in `DataCompletionDashboard.jsx` (last touched in
  3.2, not 3.3). `npm run build` clean (2.3s); `npx eslint src/` → **0 errors**
  repo-wide (13 pre-existing `react-hooks/exhaustive-deps` warnings remain, none new).
  Branch pushed; **not merged to `main`** — awaiting curator click-through. **Phase 3
  exit criteria met pending that click-through.**
- **2026-07-11 (Session 3.2)** — Public pages restyle. On branch
  `session-3.2-public-pages` (3.1 merged to `main` first, curator-confirmed), from the
  brand-kit mockups (`ui_kits/website/index|browse-filters|song|artists|artist.html`
  via DesignSync): **(1) Home** — kit hero (display headline + "1,300+ songs, tagged by
  theme, genre, artist, and date" + `.stat-badge` cards fed by live stats rounded down
  to the hundred), "Featured songs" / "Browse the collection" sentence-case headers,
  emoji stripped. **(2) Browse/Search** — token restyle of the whole SearchAndFilter
  suite (pill search input, secondary Filters button with count chip, ember filter
  chips, kit select, surface filters panel, moss parent-genre labels); dead audio
  sort options + debug logs removed. Shared with the artists page's twin component.
  **(3) Song Detail** — rebuilt to the kit layout: 760px column, ghost Back / secondary
  Share, 16:9 cover hero with scrim (title, ember artist, italic album, Year/Duration/
  Popularity stat cells, Open in Spotify + View lyrics buttons), "Music video",
  "Key lyrics" ember-border quote card, **"Animal advocacy analysis"** (renamed per
  curator request; whole section hidden unless one of the five categorisation arrays
  has data — currently no songs), "You might also like" compact cards. Audio-features
  panel + preview-play deleted (dead data). **(4) Artists** — kit cards (72px circular
  photo, meta row, genre pills, moss advocacy label) and Artist Detail rebuilt to the
  kit photo-hero (overlay Back/Spotify/Share buttons, genre tags + 4 translucent stat
  boxes in the scrim) over numbered song rows with moss popularity bars. **(5) CSS** —
  all styles token-based in `styles/components.css` (+~1,100 lines incl. shared
  page-shell/messages/search vocabulary); legacy App.css blocks deleted (~2,700 lines:
  hero/stats, featured/search sections, song-card leftovers, whole search+filter
  region, both song-detail layouts, video-section width hacks + 🎥, artist pages ×2
  regions, dead `.song-tags`/`.view-all-results`/`.coming-soon`). Bug fixes en route:
  page containers collapsing to content width inside the column-flex app shell
  (`width: 100%` + documented in Decision Log), two always-on "Filters applied" labels,
  admin `.artist-info` row rule leaking into public artist cards, nav now wraps on
  narrow viewports. Net ≈ **+1,600/−2,900 lines**. Smoke test ✅ (headless-Chrome walk,
  desktop 1280 + mobile 390): home (hero copy + stat badges + covers), song/541
  (scrim hero, video embed, no advocacy section — correct, no data), artists grid,
  artist/83 (hero + popularity bars), playlists unchanged; `npm run build` clean
  (2.1s); eslint **0 errors** on all six touched files (5 pre-existing errors in them
  also fixed; 6 deliberate hook warnings remain). Known-remaining: site-wide 390px
  horizontal overflow (pre-existing, verified on untouched About page) → 3.3
  responsive pass. Branch pushed, awaiting curator click-through + merge.
  **Same-day follow-up (curator-requested, same branch):** (1) popularity displays
  removed site-wide (song cards, song hero, artist cards/rows/stat box — see Decision
  Log) and artist-card followers removed; artist-page followers relabelled "Spotify
  followers". (2) Artist-page songs grouped by album, newest first (56px cover +
  "year · N songs" header, per-album row numbering, rows slimmed to title + duration).
  (3) `artists.website_url` added (migration `005_artist_website.sql`, applied):
  selected by the public artist route + admin all-artists, writable via
  `PUT /api/admin/artists/:id`, new "Website / Bandcamp URL" field in the admin
  Artists edit modal, rendered as a "Bandcamp"/"Website" hero button. Backend
  restarted; verified end-to-end (set URL via admin API → button renders → reverted
  to empty). Build clean; eslint 0 errors on touched files.
- **2026-07-10 (Session 3.1)** — Design system foundation (opens Phase 3). On branch
  `session-3.1-design-system`, from the brand kit (Claude Design project "Website brand
  kit development", read via DesignSync): **(1)** new `frontend/src/styles/` —
  `tokens/colors.css` (warm-dark oklch neutrals + Ember/Moss accents), `tokens/
  typography.css` (Manrope display / Public Sans body scale), `tokens/spacing.css`
  (4px scale, radii, shadows, motion), `base.css` (element defaults: canvas bg, display
  headings, ember links, focus ring), `components.css` (app shell, song card, striped
  artwork placeholder, pagination, mood badge, plus kit Button/Input/Select/Tag/Badge
  classes as `.btn/.input/.select/.tag/.stat-badge` for 3.2/3.3); `index.css` now just
  imports these; Google Fonts link + real `<title>` in `index.html`. **(2)** `App.css`:
  legacy `:root` re-pointed at tokens (bridge), 13 hex + 43 rgba() Spotify greens and 4
  gradients swept, 5 never-defined variables now defined. **(3)** JSX: `App.jsx` imports
  components.css after App.css; `SongCard` lost the 🔥 emoji and the dead
  `via.placeholder.com` fallback (striped placeholder instead); `MoodBadge` rewritten as
  a token pill (no emoji, no per-mood ad hoc colors). **(4)** Two cascade bugs fixed in
  legacy CSS: restored the deleted `@media` opener that had leaked
  `.song-artwork{display:none}` globally (this — not a broken API — is why cards never
  showed album covers; see Decision Log), and added `min-width:0` to cards so long
  nowrap titles can't blow out grid columns. Net ≈ +900/−120 lines, all frontend.
  Smoke test ✅: headless-Chrome walk of home (desktop 1280 + mobile 390), song/541,
  artists, playlists — all render on-brand (warm dark canvas, ember nav/stats/actions,
  moss genre labels, covers visible on cards for the first time); `npm run build` clean
  (2.2s); eslint 0 errors on changed files. Known-remaining: mobile hero-stats overflow
  (pre-existing, → 3.3 responsive pass); hero copy still old voice (→ 3.2). Branch
  pushed, awaiting curator click-through + merge.
- **2026-07-10 (Session 2.3)** — Script cleanup (closes Phase 2). On branch
  `session-2.3-script-cleanup`: **deleted 37 of the 41 files in `backend/scripts/`**
  (all `test*`/`check*`/`debug*`/`diagnose*` one-offs, the `add*`/`create*`/`setup*`
  one-off DDL, genre-migration scripts, the three legacy import/sync paths
  superseded by 1.2, the dead `removed_from_playlist` pair, `restartServer.js`,
  `youtubeApiServer.js`, and `runMigration.js` — see Decision Log for the keep-list
  deviations). **Kept 4** documented in a new `backend/scripts/README.md`:
  `consolidateSpreadsheets.js`, `enrichFromSpotify.js`, `auditDatabase.js`,
  `exportAllSongsData.js`. Verified first that nothing references any script (no
  package.json entries, no requires from server code, no .bat callers, no
  cross-requires). Rewrote the stale sync documentation: `README.md`'s "Spotify playlist
  is the source of truth" section replaced with the truth-source model (import-only sync
  via Staging tab or `enrichFromSpotify.js`), scripts-reference table cut to the 4 keeps,
  admin-workflow table updated (Staging row added, dead removed-from-playlist row gone);
  `CLAUDE.md` import/scripts lines corrected (had pointed at a nonexistent
  `importSpotifyData.js`). Net **≈ −4,900 lines**. Smoke test ✅: retained
  `auditDatabase.js` ran clean (read-only), backend started and public routes serve real
  data (featured song OK, search `vegan` = 198, unchanged from 2.1/2.2). **Observed:**
  DB now holds 1,821 songs = 1,800 + the 21 mismatch tracks — the curator appears to
  have used the new Sync button (2.2b's first working sync UI) between sessions;
  flagged in Next Tasks for the curator to confirm.
- **2026-07-09 (Session 2.2b)** — Admin UI consolidation (executes `ADMIN_AUDIT.md` §3;
  frontend only, backend untouched). First merged 2.2 to `main` (curator go-ahead), then on
  branch `session-2.2b-admin-ui-consolidation`: **(1)** new `src/api/adminApi.js` —
  `adminFetch` helper (relative `/api` URLs through the Vite proxy + `X-Admin-Password` on
  every call); all 11 admin components converted; zero hardcoded `localhost:5000` left in
  admin code (public pages still hardcode it — Phase 4). **(2)** `AdminInterface.jsx`
  2,327 → 176 lines: login + tab nav shell; Manage Songs (list, manual-song form,
  edit modal) → `ManageSongsTab.jsx`; Manage Playlists → `ManagePlaylistsTab.jsx`.
  **(3)** One shared `CategorizationFields.jsx` (five category arrays + rating, toggle
  buttons) behind the manual-song form, the edit modal, and the Bulk Categorization
  workflow; fixed the broken genre/parent-genre selects while extracting (see Decision
  Log). **(4)** Sync moved into **Staging → Add candidates**: "Sync from playlist"
  (import-only POST) + "Check playlist mismatch" (read-only report) — note both old sync
  functions in AdminInterface/DuplicateManager were dead code no button ever called, so
  this is the sync's first working UI since the 1.2 rebuild. **(5)** Duplicate Manager is
  pure data-quality: dead "Removed from Playlist" sub-tab deleted (read
  `removed_from_playlist`, unwritten since 1.2; its help text pointed at scripts deleted in
  Phase 0/2.2). **(6)** Submissions: "Approve & add to pending" calls the authed 2.2 bridge;
  catch-up "Add to pending queue" button for approved-unbridged; result messages surfaced.
  Also deleted dead code found en route (unused `searchResults` state, unreachable batch-
  categorise stub whose `b` shortcut called an undefined function). Net **≈ −975 lines**.
  Lint: 0 errors in every touched file (5 pre-existing errors remain in untouched public
  `SearchAndFilter`/`ArtistSearchResults`). Smoke test ✅ **28/28** (headless Chrome walk:
  login, all 10 tabs render, staging sub-views + sync panel, live mismatch report
  149/21, Cleanup tab shows no removed-songs view) **plus a live end-to-end bridge test**:
  public submission → "Approve & add to pending" click → verified in DB (manual pending
  song, submitted YouTube link kept as primary play link, `existing_song_id` set) → all
  test rows cleaned up, `db-stats` unchanged at 1,342; backend node:test 17/17. Found for
  the curator: the mismatch report now shows **21 playlist tracks not in the catalogue**
  (playlist grew since 2.2) — the new Sync button imports them when ready. Branch pushed,
  awaiting curator click-through + merge.
- **2026-07-08 (Session 2.2)** — Backend consolidation (executes the admin audit). On branch
  `session-2.2-backend-consolidation`: deleted the 17 dead `admin.js` routes,
  `admin_simple.js` (390 lines, never mounted), and the Phase 0 inventory's other drops —
  9 `spotify.js` debug/dead routes (incl. `GET /artists` + the unused
  `spotifyService.getArtists`), 3 `youtube.js` routes (PUT/DELETE `/videos/:id`,
  `extract-id`), the whole `lyrics.js` router (unmounted from `server.js`), submissions
  `GET /stats`, analytics `GET /audio-features` (+ its Dashboard doughnut chart and
  audio-feature filter). Converted the 2 DDL-over-HTTP routes to catch-up migrations
  `003_lyrics_links.sql` + `004_discography_tracking.sql` (schema objects verified live
  first) and removed their UI callers (Lyrics Manager setup button; ArtistsManager ran the
  DDL on every mount). Regrouped `admin.js` (2,926 → 2,237 lines) into six banner-named
  domains; `server.js` mounts cleaned. Built the **submissions→pending bridge**:
  `staging.addSubmissionAsPending` + authed `POST /api/admin/submissions/:id/add-to-pending`
  (conservative Spotify match → candidate intake; else minimal manual pending song keeping
  the submitted YouTube link; idempotent via `existing_song_id`); +4 node:test cases
  (17/17 green). Net **−1,779 lines**; zero dead routes; zero DDL-over-HTTP. Found along the
  way: `/api/submissions/admin*` has no auth (recorded as a Phase 4 watch-out). Smoke test ✅
  44/44: public API intact (db-stats 1342, search `vegan` 198, song 541 detail/similar,
  analytics, playlists, youtube primary), every deleted route 404s, all 28+1 admin routes
  exercised (incl. live Spotify mismatch report: 149 included-not-on-playlist, unchanged),
  401 without password, Vite loads, `npm run build` + eslint clean (0 errors; the 3
  pre-existing hook warnings remain). Queue totals observed: 172 pending / 42 to-finalise /
  1,342 live (curator has been working the queues since 1.4). Branch pushed, awaiting merge
  go-ahead.
- **2026-07-08 (Session 2.1)** — Frontend decomposition (opens Phase 2). On branch
  `session-2.1-frontend-decomposition`: `App.jsx` 2,001 → 49 lines (router shell only).
  Extracted verbatim to `src/pages/`: HomePage (with its Hero/Stats/Featured/Search
  sections), SongDetailPage, PlaylistsPage (CreatePlaylistModal kept local), 
  PlaylistDetailPage, AboutPage; to `src/components/`: NavigationMenu, SongCard,
  PaginationControls, AddToPlaylistModal. Deleted dead code only: `ArtistsPage` (~270
  lines, never routed — Phase 0 drop) and unused `DescriptionSection`; also removed two
  dead-variable lint errors carried over (unused `section` param, unused `pagination`
  state). Net −257 lines. Smoke test ✅ (headless Chrome against live backend + Vite dev
  server): all 9 routes rendered with real data — home (stats 1342+/630+, featured cards,
  browse grid), song/541 detail (artwork, meta, YouTube embed), playlists + playlist/1,
  about, artists search, admin login; error path (`/song/999999` → "Song not found") and
  URL search (`/?q=vegan` → 198 songs) behave as before; `npm run build` clean, eslint 0
  errors on changed files (2 pre-existing deliberate hook warnings remain). Noticed live
  totals are 1,342 (docs said 1,341) — one song appears newly published (curator was
  exercising the staging UI 2026-07-08); flagged for the curator to confirm it was
  intentional.
- **2026-07-08 (Admin consolidation audit)** — Audit-only session (no code changed, smoke
  test n/a). Cross-referenced all 47 `admin.js` route definitions against every frontend
  fetch → [`ADMIN_AUDIT.md`](./ADMIN_AUDIT.md): **28 keep / 17 delete / 2 convert to
  migrations**, plus `admin_simple.js` (360 lines, unmounted) to delete. Key finds beyond
  Phase 0's inventory: the admin playlist endpoints are *all* dead (the Manage Playlists tab
  uses the public API); the three `removed-songs`/`discrepancies` reports can never show data
  again (nothing writes `removed_from_playlist` since 1.2); song intake now exists in three
  UIs; categorisation and YouTube-attach UIs each exist twice; submission approval never
  creates a song. Curator confirmed three consolidation decisions (see Decision Log).
  `PROJECT_PLAN.md` Session 2.2 rescoped precisely + new Session 2.2b (admin UI
  consolidation) added.
- **2026-07-08 (Session 1.4)** — Staging-queue admin UI (closes Phase 1). Built on branch
  `session-1.4-staging-queue`: `backend/services/staging.js` (queue listing +
  include/reject/play-link/attach-spotify/candidate-intake, `db`-first for testability),
  6 admin endpoints in `admin.js`, `backend/test/staging.test.js` (13 node:test cases, all
  green), and `frontend/src/components/StagingQueue.jsx` with 4 sub-views (To process / To
  finalise / Live / Add candidates) mounted as a Staging tab in `AdminInterface`. Scope call:
  shipped without lyrics paste / categorisation (deferred — see Decision Log). Smoke test ✅
  (reversible, ran against real DB then restored state byte-for-byte): queue totals **177
  pending / 39 to-finalise** as expected; live queue requires a search term (400 without `q`,
  133 hits for `q=vegan`); include moves pending→included and across queues; play-link saves
  and rejects non-http URLs (400); reject→rejected; publish makes a To-finalise song appear in
  Live search, unpublish removes it; candidate intake dedupes an existing Spotify id (added 0 /
  skipped 1, exercising the live Spotify API) and reports invalid URLs; unknown id → 404;
  frontend `npm run build` clean. `RESTORE MATCHES ORIGINAL: true`. **Curator click-through
  confirmed live 2026-07-08** — Staging tab verified working in the browser at `/admin` (also
  surfaced that the admin password had been rotated in the 2026-07-06 cleanup and the curator
  needed the current one from `frontend/.env.local`; a stale Vite process was restarted with
  its cache cleared). Branch is ready to merge to `main`, awaiting the go-ahead.
- **2026-07-07 (Session 1.3)** — Data-integrity pass. Pre-run backup to `backups/`
  (gitignored). **Merged 18 duplicate pairs** (transaction-wrapped merge script, dry-run
  first: keep 2025 canonical, backfill only NULL enrichment scalars + max `popularity`,
  re-point child refs, delete loser; sanity-checked keeps=18/drops=0/Δ=−18). **Swept orphans**
  (dry-run first): 19 albums + 1 artist (Flaex); confirmed only `songs.album_id` and
  `song_artists.artist_id` reference those tables. **Re-ran `consolidateSpreadsheets.js
  --apply`**: file-1 multi-matches 27 → 5 (the 5 remaining are genuinely non-dup), lyrics
  applied to the unblocked rows. End state: songs **1,819 → 1,801**, included **1,398 →
  1,380**, live **1,359 → 1,341**, song_lyrics **929 → 947**, orphans **0**. Curator judgment
  calls written to `docs/SESSION_1.3_CURATOR_DECISIONS.md` (18 status conflicts, new CLEARxCUT
  dup, 6 attach typos, 3 unmatched, 2 unclassified). No application code changed. Smoke test
  ✅: db-stats=1341, merged songs render with artist/album, search returns one row per former
  dup, deleted dup ids 404. **Follow-up (same day):** curator ruled "one instance of include →
  default to include" — the 18 sheet-vs-DB status conflicts stay included (no change); the new
  CLEARxCUT dup (pending 5804) was merged into included 80 (songs 1,801 → 1,800, pending
  178 → 177). Decisions recorded in `SESSION_1.3_CURATOR_DECISIONS.md`.
- **2026-07-07 (Session 1.2b)** — Publication staging (curator-requested design session +
  implementation): migration `002_published_flag.sql` adds `published`/`published_at` +
  CHECK (only included songs can be live) and grandfathers the 1,359 complete included
  songs; all public routes now filter `status='included' AND published=true`; admin
  `publish`/`unpublish` endpoints added (409 on non-included). Site totals 1,398 → 1,359;
  the 39 incomplete songs wait in To-finalise. Spec: `PUBLICATION_STAGING_DESIGN.md`.
  Smoke test ✅: totals consistent, to-finalise song 404s, publish→200/unpublish→404 cycle,
  state restored (one test hiccup caught: 5587 was legitimately published by the backfill —
  it gained artwork in 1.2 — republished after the test).
- **2026-07-07 (Session 1.2)** — Spotify enrichment pipeline live:
  `backend/scripts/enrichFromSpotify.js` + shared `backend/utils/playlistSync.js` (single
  replacement for the three legacy import paths; batched, honours Retry-After, dry-run
  default). Results: **151/190** manual songs attached to Spotify (34 to review — mostly
  spreadsheet typos; 5 confirmed not-on-Spotify); **817 albums** backfilled (covers,
  release dates, labels — 0 albums left without images/dates); **414 artists** backfilled
  (genres 218→432, images, followers); playlist diff added **3 tracks as pending** (other 3
  of the 6-track gap resolved via attach). Admin endpoints rebuilt truth-source-safe:
  `sync-spotify-playlist` = import-only (adds pending, never flags), `spotify-playlist-
  mismatch` = read-only two-way diff. Curatorial md5 checksum verified byte-identical
  pre/post. Pre-run backup in `backups/`. Smoke test ✅: 1,359/1,398 included songs with
  covers, year range intact, both admin endpoints exercised live, frontend loads.
- **2026-07-07 (Session 1.1)** — Truth source stood up. Migration
  `backend/database/migrations/001_truth_source.sql` (first tracked migration): `songs.status`
  /`status_notes`/`lyrics_status`/`bandcamp_url`/`soundcloud_url` + local-only `song_lyrics`
  table. Full DB backup to `backups/` (gitignored), then
  `backend/scripts/consolidateSpreadsheets.js` (dry-run default, idempotent — verified by
  three converging runs) imported both spreadsheets: end state **1,398 included** (+190 new),
  **175 pending**, **243 rejected**, **929 songs with local lyrics**, 519 lyrics links, 78
  bandcamp links, 278 new artists; 72-item review report in `backend/logs/` (multi-matches =
  the known dup pairs; 18 sheet-vs-DB status conflicts left for the curator). All public
  routes (spotify/analytics/playlists/youtube/lyrics) now filter `status='included'` and
  LEFT JOIN albums so non-Spotify songs render. Smoke test ✅: site totals 1,398 everywhere,
  pending/rejected songs 404, manual song renders with placeholder art, frontend loads, no
  route reads `song_lyrics`. exceljs added as backend devDependency.
- **2026-07-07 (Session 0.4)** — Truth-source design session (brainstorming with curator):
  inspected both spreadsheets (711 + 1,013 rows), measured DB overlap (659 exact matches;
  192 new included songs; 256 rejects; 179 pending), worked through 9 curator decisions, and
  wrote the approved spec → `docs/TRUTH_SOURCE_DESIGN.md`. Gitignored `docs/playlist/`
  (lyrics copyright). Phase 0 closed; Phase 1 sessions resequenced (1.1 import, 1.2
  enrichment, 1.3 integrity, 1.4 pending-queue UI). No production code changed.
- **2026-07-07 (Session 0.3)** — Spotify API audit complete → `docs/SPOTIFY_API_AUDIT.md`.
  Live-tested the API with the app's credentials: album images fully available (the missing
  covers are our sync's bug — 450 songs affected, backfillable); audio features (403),
  recommendations/related-artists (404), and preview URLs confirmed dead for this app; the
  real playlist is "Animal Lib & Vegan Songs", 1,216 tracks (DB 8 behind). Truth vs
  enrichment field classification drafted for Session 0.4. **Fix shipped:** sync endpoints'
  default playlist ID pointed at an unrelated Lofi Girl playlist — corrected to the real one
  (server reload + route smoke test ✅; sync itself intentionally not run). Curator answered
  the four 0.2 questions (recorded in Decision Log).
- **2026-07-07 (Session 0.2)** — Database audit complete → `docs/DATABASE_AUDIT.md`
  (read-only; no code changes, smoke test n/a). Headlines: **no curatorial data in the DB**
  (all categorisation/review fields = 0 rows); 1,208 songs = 674 (Jul–Aug 2025 imports, with
  moods/genres/playlist-dates) + 534 (bare 2026-04-06 import, origin ⚑ unconfirmed); id
  sequence at 5,195 → ~4k rows of historic churn; 18 true duplicate pairs identified; audio
  features + preview URLs NULL for all songs (Spotify API no longer provides them); live
  `songs` table has 51 columns vs 23 in `schema.sql`, much of it in no SQL file;
  `database/migrations/` is empty. Four open questions for the curator recorded in the audit.
- **2026-07-07 (Session 0.1 follow-up)** — Removed the two unauthenticated admin test routes
  from `backend/routes/admin.js` (the pre-auth `test-update/:id` and `test-featured-noauth/:id`,
  the latter writing `songs.featured` without a password). Smoke test: both endpoints now 401
  without credentials, `db-stats` still 200 ✅. Recorded curator confirmations (playlist
  deferral) and new context (lyrics being sourced in messy lists; vegan-themes coding is
  future work) in the inventory and this doc.
- **2026-07-07 (Session 0.1)** — Feature Inventory complete → `docs/FEATURE_INVENTORY.md`.
  Walked all 11 frontend routes, 9 admin tabs, and ~100 backend endpoints (every route group
  verified live). Key finds: `admin_simple.js` never mounted; `ArtistsPage` in `App.jsx` dead;
  duplicate route definitions inside `admin.js`; **two admin test routes mounted before the
  auth middleware — one writes `songs.featured` unauthenticated (verified)**; 3 endpoints run
  schema DDL over HTTP; lyrics route file unused by the frontend; live data = 1,208 songs /
  558 artists / 721 albums, lyrics links on 10 songs, vegan-theme analytics empty. Populated
  the Backlog in `PROJECT_PLAN.md`; updated PRD §11 pointer and `CLAUDE.md` architecture
  section. No code changed (audit only — smoke test n/a). / `stop-vegan-playlist.bat` launcher
  scripts (start opens both servers in titled log windows + browser, with already-running
  guard; stop kills by window title and by port 5000/5173). Smoke test: full
  stop → start → re-start cycle verified ✅. Documented in README Quick Start.

- **2026-07-06** — Security cleanup: rotated DB + admin passwords, moved admin password to env
  vars (8 frontend components), untracked/gitignored `.claude/settings.local.json`, removed
  password logging, expanded `.env.example` files, removed stray `backend/nul`. Smoke test:
  DB connection ✅, admin auth new password 200 / old 401 ✅, frontend 200 ✅. Discovered
  `songs` table has 1,208 rows (vs ~650 expected) — flagged for Session 0.2.
- **2026-07-06** — Modernisation planning established: created `PROJECT_OVERVIEW.md`,
  `PROJECT_PLAN.md`, `PROJECT_STATE.md`; updated `PRD.md` with the as-built feature inventory;
  updated `CLAUDE.md` with the Start/End-Session workflow and YAGNI principle.
