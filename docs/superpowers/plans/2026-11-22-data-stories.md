# Data Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Stories tab in Explore > Data: scrollytelling stories (emergent text between full-width visual panels) read from editable Markdown files, with numbers resolved server-side from the same data the charts use.

**Architecture:** `backend/services/stories.js` parses a story file into blocks, resolves `{{tokens}}` and panel data from live-song queries, and returns a ready-to-render story; a thin `/api/stories` route serves the index and each story. The frontend renders blocks with thin React/SVG panels, a `Reveal` wrapper (IntersectionObserver + CSS transition), and pure tested helpers. Same pattern as `services/dataset.js` + `components/explore/data/`.

**Tech Stack:** Node/Express/pg, `node:test`, React 19 + Vite, `react-markdown` + `remark-gfm` (already installed), hand-rolled SVG, design tokens only.

**Spec:** `docs/superpowers/specs/2026-11-22-data-stories-design.md` (the binding authority; read it first).

## Global Constraints

- Live songs only: `s.status = 'included' AND s.published = true`. Lyric fields only through `analysis.LATEST_ANALYSIS`; sound fields only through `audioAnalysis.LATEST_AUDIO`; codes gated by `metadataCodebook.cleanSelection` / `acousticCodebook.cleanSelection`.
- The decade of a song is `floor(year/10)*10` of `albums.release_date`; undated songs are ignored. A decade with fewer than `MIN_POINT_N = 10` songs is withheld (`plot:false`) and a token naming it is an error. Prose sentences never rest on fewer than 30 songs.
- `stories.js` and `routes/stories.js` never mention `song_lyrics`, `translation`, `song_audio_transcripts`, `audio_samples`; song cards carry only `{id, title, artists, year, art, caption}` (art = `albums.images[0].url`). No `lyric_summary`.
- Slug lookup is a `Map` built from the `.md` files that exist in `backend/data/stories/`; a slug is never joined into a path (`..`, `constructor`, empty -> 404).
- Tokens only (`--bg-*`, `--text-*`, `--accent-*`, `--explore-cat-1..7`, `--explore-not-coded`); max six hues plus grey; no emoji; labels from codebooks/taxonomy, never `short_tag`. Relative `/api/...` URLs. Prose renders through react-markdown with no raw-HTML plugin.
- All motion is disabled under `prefers-reduced-motion`; content is readable without the reveal having run (reveal only adds a class; hidden state exists only when JS has marked the element as pending).
- Stories never show the Data slice bar. Explicit `git add` paths; commit with `git commit -F <scratchpad file>`; messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on a new branch `session-data-stories` from `main`.

## Review Focus

- A story names a song that is not live, or an unknown token/dimension/code: loading fails with a coded `StoryError`; a test loads every shipped story so a bad edit is caught before a reader sees it.
- A multi-value dimension (vocal style): shares add to more than 100%; the panel caption must say so.
- Slug `../server`, `constructor`, `%2e%2e`, empty, or a story file with no front matter / an empty body: 404 or a clear `StoryError`, never a crash or a file read outside the directory.
- Prose and panel agree: a token and the chart bar for the same decade/code are the same number (test asserts equality through the shared function).
- A decade with `n < 10` is never plotted and never quoted.
- Reduced-motion and no-IntersectionObserver environments show all text and panels immediately.

---

## PHASE 1 - machinery and story 1 (From shouts to growls)

### Task 1: Story parser and token resolver (pure)

**Files:** Create `backend/services/stories.js` (parser part), `backend/test/storiesParse.test.js`

**Interfaces - produces:**
- `class StoryError extends Error { code }` with codes `BAD_FORMAT | BAD_TOKEN | BAD_BLOCK | SONG_NOT_LIVE | NOT_FOUND`.
- `parseStory(text: string) -> { meta: {title, subtitle, order:number}, blocks: Block[] }` where `Block` is `{type:'prose', markdown}` or `{type:'panel', kind:'opening'|'chart'|'songs'|'closing', variant?:string, args:{[k]:string}, rows?:{id:number, caption:string}[]}`. Front matter is `---\nkey: value\n---` at the top (title required; `order` defaults 100). A block line is a line whose first non-space character is `@`: `@opening k=v ...`, `@chart <variant> k=v ...`, `@songs`, `@closing k=v ...` (values may be quoted with `"`; list values are comma separated). Under `@songs`, following lines matching `^\d+\s*\|` are rows (`id | caption`) until the first non-matching line. Everything else, grouped between blocks and trimmed, is prose; empty prose is dropped.
- `findTokens(markdown) -> {raw, name, args}[]` for `{{name arg arg}}`, and `applyTokens(markdown, resolve:(name,args)=>string) -> string` (resolve may throw `StoryError('BAD_TOKEN')`; an unknown token name throws too).

- [ ] **Step 1: Write failing tests** (`storiesParse.test.js`): front matter parsed (title/subtitle/order, missing title -> `BAD_FORMAT`); prose and panels alternate in file order; `@chart decade-bars dimension=vocal_style codes=A,B decade=1980` yields variant `decade-bars` and args as strings; quoted arg value keeps spaces; `@songs` rows parse `152 | Where it started.` into `{id:152, caption}` and stop at the first prose line; an unknown `@kind` -> `BAD_BLOCK`; `applyTokens('x {{pct vocal_style A 1980}} y', fn)` calls `fn('pct',['vocal_style','A','1980'])` and splices the result; a resolver throwing propagates as `BAD_TOKEN`; text containing a lone `{{` with no close is left as prose (no crash); CRLF input parses the same as LF.
- [ ] **Step 2:** Run `cd backend && node --test test/storiesParse.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the parser, `StoryError`, `findTokens`, `applyTokens` (no DB access in this part; export them).
- [ ] **Step 4:** Run the test file. Expected: all pass.
- [ ] **Step 5: Commit** `feat(stories): pure story-file parser and token resolver`.

### Task 2: Data providers (decade shares, songs)

**Files:** Modify `backend/services/stories.js`; Create `backend/test/storiesData.test.js` (sentinel `ZZZSTD`).

**Interfaces - produces:**
- `DIMENSIONS`: `{ vocal_style: {kind:'audio-multi'}, lyrical_tone: {kind:'lyric-scalar'} }` (phases 2-3 add `themes`/`topics`); anything else -> `StoryError('BAD_BLOCK')`.
- `decadeShares(db, dimension: string) -> Promise<{dimension, decades: {decade:number, n:number, plot:boolean, shares:{[code]:number}}[], labels:{[code]:string}}>` over live songs with a release year (`n` = songs with an OK audio row for audio dimensions, with a visible lyric analysis for lyric dimensions; `share` = songs carrying the code / `n`, 0..1; codes pass `cleanSelection`; `plot = n >= MIN_POINT_N`; decades ascending, only those present).
- `songCards(db, rows: {id,caption}[]) -> Promise<{id,title,artists,year,art,caption}[]>` in the order given; a row whose song is not live -> `StoryError('SONG_NOT_LIVE')` naming the id.
- `pct(shares-result, code, decade) -> string` formatting `"46%"` (rounded), throwing `BAD_TOKEN` if the decade is absent, not `plot`, or the code unknown; `nOf(result, decade) -> string` (`"441"`).

- [ ] **Step 1: Write failing tests:** seed (own sentinel, dated album) 12 songs in one decade each with an OK audio row, 6 with `vocal_style` containing `HARSH_SCREAMED_GROWL` and 3 containing `RAW_SHOUTED` plus growl; assert `n` counts only seeded-or-existing as read (use a decade nobody else occupies, e.g. a 1930s album, so the live catalogue cannot interfere), shares `0.5` and `0.25`, `plot:true`; 9 songs in another empty decade (1920s) -> `plot:false` and `pct` throws `BAD_TOKEN`; an unpublished song is not counted; `songCards` returns album art and artists, throws `SONG_NOT_LIVE` for an unpublished id; a lyric-scalar test with `lyrical_tone` codes via `song_lyric_analysis` rows.
- [ ] **Step 2:** Run `node --test test/storiesData.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the providers: one SQL read per dimension joined to `albums`, `audioAnalysis.LATEST_AUDIO` or `analysis.LATEST_ANALYSIS`, grouped in JS; labels from `acousticCodebook.optionsFor` / `metadataCodebook.codeLabel`.
- [ ] **Step 4:** Run the file. Expected: all pass.
- [ ] **Step 5: Commit** `feat(stories): decade-share and song-card providers`.

### Task 3: loadStory, listStories, route, story 1, guards

**Files:** Modify `backend/services/stories.js`, `backend/server.js` (mount `/api/stories`), `backend/test/lyrics_privacy.test.js`; Create `backend/routes/stories.js`, `backend/data/stories/from-shouts-to-growls.md`, `backend/test/storiesLoad.test.js`.

**Interfaces - produces:**
- `listStories(dir) -> {slug, title, subtitle, order, cover: string|null}[]` sorted by `order` (cover = first `opening` song's art, resolved via `songCards`, so it needs `db`: signature `listStories(db, dir)`); `loadStory(db, slug, dir) -> Promise<{slug, title, subtitle, blocks: ResolvedBlock[]}>`; `NOT_FOUND` for a slug not in the directory's `Map`.
- `ResolvedBlock`: `{type:'prose', markdown}` (tokens applied) | `{type:'opening', title, subtitle, art:string[]}` | `{type:'chart', variant:'decade-bars', dimension, decade, previousDecade|null, bars:{code,label,share,previousShare|null}[], n, previousN|null, caption}` | `{type:'chart', variant:'decade-lines', dimension, decades:{decade,n,plot}[], series:{code,label,values:(number|null)[]}[], caption}` | `{type:'songs', songs:SongCard[]}` | `{type:'closing', label, href}` where `href` is `/?...` built with `URLSearchParams` from `browse=` (comma-separated `key:value` pairs, e.g. `browse=vocal_style:HARSH_SCREAMED_GROWL` or `browse=year_from:1967,year_to:1999`; the browse vocabulary, `termHref` format). Chart captions state the denominator and, for `audio-multi`, "a song can have more than one vocal style, so shares add to more than 100%".
- Route: `GET /api/stories` -> list; `GET /api/stories/:slug` -> story; 404 `{error}` for `NOT_FOUND`; any other `StoryError` or failure -> 500 `{error:'Story could not be loaded'}` with `console.error(err.code, err.message)` (no stack to the client).

- [ ] **Step 1: Write failing tests** (`storiesLoad.test.js`, sentinel `ZZZSTL`): `loadStory` against a temp directory of fixture stories using seeded songs: blocks resolve in order; `decade-bars` carries `previousDecade`/`previousShare` for the prior present decade; a token and the bar for the same decade/code give the same number (parse the `%` from prose and compare with `Math.round(share*100)`); unknown slug, `..%2Fserver`, `constructor`, `''` all `NOT_FOUND`; story naming an unpublished song -> `SONG_NOT_LIVE`; token for a withheld decade -> `BAD_TOKEN`; a file with no title -> `BAD_FORMAT`; **a test that runs `loadStory` for every file in `backend/data/stories/` against the live database and asserts no error and that every song card has a non-empty title** (this is the guard against a bad curator edit).
- [ ] **Step 2:** Run the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** `loadStory`, `listStories`, `routes/stories.js` and the `server.js` mount; extend `lyrics_privacy.test.js` so `routes/stories.js` is in `PUBLIC_ROUTES` and a test asserts `services/stories.js` contains none of the four forbidden words.
- [ ] **Step 4: Write story 1** `backend/data/stories/from-shouts-to-growls.md` (front matter `title: From shouts to growls`, `subtitle: How the voices of vegan music changed, 1980 to now`, `order: 1`). Draft prose of 6 short passages and these panels in order: `@opening songs=152,1376,5002,4788,1486,95`; prose (the 1980s: shouted and gang chant, growl nearly absent); `@chart decade-bars dimension=vocal_style codes=RAW_SHOUTED,GANG_CHANT,CLEAN_MELODIC,HARSH_SCREAMED_GROWL decade=1980`; `@songs` (1376, 152 with one-line captions); prose (the 1990s turn); `@chart decade-bars ... decade=1990`; `@songs` (5002, 4788); prose (today, rap); `@chart decade-lines dimension=vocal_style codes=HARSH_SCREAMED_GROWL,RAW_SHOUTED,GANG_CHANT,RAP_TOASTING`; prose (closing thought, hedged, no causal claims); `@closing browse=vocal_style:HARSH_SCREAMED_GROWL label="Explore the growled songs"`. Every number in the prose is a `{{pct ...}}` / `{{n ...}}` token. No lyric quotation.
- [ ] **Step 5:** Run `cd backend && node --test test/storiesParse.test.js test/storiesData.test.js test/storiesLoad.test.js test/lyrics_privacy.test.js test/legacyAudio.test.js`, then `curl -s localhost:5000/api/stories/from-shouts-to-growls`. Expected: all pass; JSON has 12-ish blocks, no `{{` left.
- [ ] **Step 6: Commit** `feat(stories): loader, /api/stories route and the first story`.

### Task 4: Frontend - routes, Stories index, story page, panels

**Files:** Create `frontend/src/pages/StoriesIndex.jsx`, `frontend/src/pages/StoryPage.jsx`, `frontend/src/pages/SliceLayout.jsx`, `frontend/src/components/explore/data/story/{Reveal,Prose,OpeningPanel,DecadeBarsPanel,DecadeLinesPanel,SongsPanel,ClosingPanel}.jsx`, `frontend/src/components/explore/data/story/storyModel.js`, `frontend/src/components/explore/data/story/storyModel.test.js`; Modify `frontend/src/pages/DataPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/explore/data/LineChart.jsx` (optional `animate` prop), `frontend/src/styles/components.css`.

**Interfaces:**
- `storyModel.js` (pure): `barRows(chart) -> {code,label,pct:number,ghostPct:number|null,deltaText:string|null}[]` (bars in the file's order; `pct`/`ghostPct` 0..100 rounded; `deltaText` like `"+43 points since the 1980s"` only when a previous decade exists); `decadeLabel(decade) -> '1980s'`; `chartTable(chart) -> {head, rows}` for the table view (bars: Code, this decade, previous decade; lines: Decade, n, one column per series, `too few` for null).
- Routing: `/explore/data` -> `DataPage` = tab row (`Stories`, `Over time`) + `Outlet`, index `Navigate to="stories"`; `stories` -> `StoriesIndex`; `stories/:slug` -> `StoryPage`; a pathless layout route `SliceLayout` (owns `useDataset`, slice state, the existing `DataFilterBar` and the outlet context formerly in `DataPage`) wraps `over-time`. The slice bar must not render on Stories.
- `Reveal({children, as, once=true})`: adds class `is-visible` when it first intersects (IntersectionObserver, threshold ~0.15); if `IntersectionObserver` is missing or `prefers-reduced-motion: reduce` matches, renders visible immediately. Hidden/translated state is applied only under a `.js-reveal-pending` class set by the component after mount, so a failure leaves content visible.
- Panels are full width of the page container, one per block, in file order; `Prose` renders `markdown` with `react-markdown` + `remark-gfm` (no raw HTML) inside `Reveal`, reading width ~ 38rem centred; `DecadeBarsPanel` animates bar widths from 0 on first reveal and shows the ghost tick and `deltaText`; `DecadeLinesPanel` reuses `LineChart` (lines draw in via stroke-dash on first reveal, markers fade in) with a legend and Table toggle via `ChartFrame`'s pattern; `SongsPanel` shows 2-4 cards (album art `<img loading="lazy" alt="">` with the title as text, band, year, caption, link `/song/:id`); `OpeningPanel` shows the art mosaic dimmed behind the title and subtitle and a scroll cue; `ClosingPanel` is a pill link to `href`. Every chart panel shows its `caption`.

- [ ] **Step 1: Write failing tests** for `storyModel.js`: `barRows` rounds and orders, ghost and delta only with a previous decade, delta wording for a drop (`"-23 points since the 1980s"`) and a rise; `decadeLabel(1980) === '1980s'`; `chartTable` shape for both variants.
- [ ] **Step 2:** Run `cd frontend && node --test src/components/explore/data/story/storyModel.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `storyModel.js`, then the components, route restructure and CSS (new classes prefixed `story-`; tokens only; reveal and bar/line animations as CSS transitions; all inside `@media (prefers-reduced-motion: no-preference)` where they move; phone: single column, panels full width, song cards wrap).
- [ ] **Step 4:** Run `cd frontend && node --test && npm run lint && npm run build`. Expected: tests pass, 0 lint errors, build succeeds.
- [ ] **Step 5: Browser check** (backend + Vite running): `/explore/data` redirects to `/explore/data/stories`; the index shows story 1 with album-art cover; the story opens, text blocks and panels reveal while scrolling, no slice bar, charts animate once, Table toggles work, the closing link lands on Browse with the vocal-style filter, `/explore/data/over-time` still works with its slice bar, phone width has no horizontal overflow, reduced-motion shows everything immediately, no console errors.
- [ ] **Step 6: Commit** `feat(stories): Stories tab, story page and panels`.

### Task 5: Phase 1 docs and verification

**Files:** `CLAUDE.md` (stories service/route/frontend, `backend/data/stories/` as curator-editable copy), `docs/PROJECT_STATE.md` (Current State, Next Tasks with smoke steps, Decision Log for the author's calls, Changelog), `docs/PROJECT_PLAN.md`, `docs/PRD.md` (inventory row).

- [ ] **Step 1:** Update the docs. **Step 2:** Run `cd backend && node --test --test-concurrency=1` and `cd frontend && node --test && npm run lint && npm run build`. Expected: all green. **Step 3:** Commit docs; give the curator smoke steps in chat; wait for "Merge" (then merge `--no-ff`, push).

---

## PHASE 2 - stories 2 and 4

### Task 6: Story 2 (From accusation to resistance)

**Files:** Create `backend/data/stories/from-accusation-to-resistance.md`; extend `backend/test/storiesLoad.test.js` only if a resolver gap appears.

- [ ] **Step 1:** Write the story (`order: 2`) using `decade-lines`/`decade-bars` on `dimension=lyrical_tone` (codes `INDICTMENT`, `RESISTANCE`, `MOBILIZING`, `LAMENTATION`), with `@songs` exemplars the author selects from the data for indictment-heavy 1980s songs and resistance-heavy recent songs (verify each id is live and has a lyric analysis; no lyric quotation), and tokens for every figure. Caption must say the base is lyric-coded songs, not the catalogue.
- [ ] **Step 2:** Run `node --test test/storiesLoad.test.js` (the all-shipped-stories test) and `curl /api/stories/from-accusation-to-resistance`. Expected: pass, no `{{` remaining.
- [ ] **Step 3: Commit** `feat(stories): From accusation to resistance`.

### Task 7: Year-columns panel and story 4 (The long road from 1967)

**Files:** Modify `backend/services/stories.js` (`songsPerYear(db) -> {years:{year,n}[], total, dated}`; block `{type:'chart', variant:'year-columns', years, marks:{year,songId,title,artists}[], caption}` from `@chart year-columns marks=95,49,259,4823,1376`; token `{{songs_in <year>}}` and `{{first_year}}`), `backend/test/storiesData.test.js`, `frontend/src/components/explore/data/story/storyModel.js` (+test: `columnGeometry({years, width, height}) -> {bars:{x,y,w,h,year,n}[], yMax}`), Create `frontend/src/components/explore/data/story/YearColumnsPanel.jsx`, `backend/data/stories/the-long-road-from-1967.md`.

- [ ] **Step 1: Write failing tests:** `songsPerYear` counts a seeded year and ignores unpublished/undated songs; a mark whose song is not live -> `SONG_NOT_LIVE`; `columnGeometry` scales bars to the max, one bar per year with gaps for years with no songs; marks reference only years present.
- [ ] **Step 2:** Run both test files. Expected: FAIL. **Step 3: Implement** provider, block resolution, geometry, panel (columns grow on first reveal, milestone marks as small album-art circles with the year; table view lists year and count).
- [ ] **Step 4:** Write story 4 (`order: 4`): caption and prose frame it as the **catalogue's** growth (curated, shaped by availability), name the first songs, the 2006 step and the post-2018 surge via tokens, end with `@closing browse=year_from:1967,year_to:1999`, tokens for every number.
- [ ] **Step 5:** Run backend and frontend suites, lint, build; browser-check both stories and the index (now two cards). **Step 6: Commit** `feat(stories): year-columns panel and The long road from 1967`; update `PROJECT_STATE` smoke steps; wait for "Merge".

---

## PHASE 3 - story 3

### Task 8: Ranked-bars panel and story 3 (What the songs are angry about)

**Files:** Modify `backend/services/stories.js` (dimensions `themes`, `topics` of kind `lyric-json` reading `jsonb_array_elements(code)` through `LATEST_ANALYSIS`; `topCodes(db, dimension, limit) -> {dimension, n, items:{code,label,count}[]}` where `n` = lyric-coded live songs; block `{type:'chart', variant:'ranked-bars', items, n, caption}` from `@chart ranked-bars dimension=themes limit=8`; tokens `{{count themes slaughter}}`, `{{rank themes slaughter}}`), `backend/test/storiesData.test.js`, `storyModel.js` (+test `rankedRows(items, n)`), Create `RankedBarsPanel.jsx`, `backend/data/stories/what-the-songs-are-angry-about.md`.

- [ ] **Step 1: Write failing tests:** `topCodes` counts distinct songs per code (a song with the same code twice counts once), excludes unpublished songs and codes outside the taxonomy, labels from the taxonomy (not `short_tag`); `rankedRows` computes percent of `n`; unknown dimension -> `BAD_BLOCK`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3: Implement** provider, block, panel (bars grow on first reveal, counts shown, caption "based on N lyric-coded songs, about half the catalogue"), table view.
- [ ] **Step 4:** Write story 3 (`order: 3`): themes panel, targets panel, exemplar `@songs` per issue chosen by the author from songs coded with that code (verify live; no lyric quotation), tokens for all figures, closing links to the matching Browse theme filter.
- [ ] **Step 5:** Run all suites, lint, build; browser-check; update docs (`CLAUDE.md`, `PROJECT_STATE`, `PROJECT_PLAN`, `PRD`). **Step 6: Commit** `feat(stories): ranked-bars panel and What the songs are angry about`; give smoke steps; wait for "Merge". Afterwards revisit the paused explorer phases 2-5 with the curator.
