# Explore > Data redesign - design

Status: draft for the curator's review (2026-11-22). Source material: the analysis project's `docs/MAIN_PROJECT_EXPLORE_DATA_HANDOFF.md` and `docs/explore_data_prototype.html`, reviewed and changed as below. Where the curator decided something it says so; everything else is the author's call and is listed at the end for checking.

## Intent

`/explore/data` today is three Chart.js charts that disagree with their own filters, cover only the 559 of 1,343 live songs with a song-level genre, and ignore the sound analysis entirely. The goal is a public analytics view of the catalogue that answers a handful of real questions about vegan music (how it changed over time, how artists argue for animals, how it sounds, how groups compare) from the data the site already holds, with every number honest about how many songs it is based on.

It must feel like the rest of Explore: hand-rolled SVG, no charting library, only design tokens, pure logic in tested modules, minimal chrome.

## Decided by the curator

1. **Layout: sub-tabs inside Data.** Explore keeps `Map | Data`; Data gets its own second row of tabs, each a real route so it is linkable: `/explore/data/over-time`, `/arguments`, `/sound`, `/compare`, `/artists`. `/explore/data` redirects to `over-time`; `/dashboard` keeps redirecting to `/explore/data`.
2. **Five tabs and their contents** (below).
3. **Genre source defaults to "Catalogue + audio fallback"**: a song with no catalogue genre (own genre, else its first artist's) is placed under the audio analysis' inferred parent genre. A second option, "Catalogue genres only", is one click away.

## Goals

- One read-only data endpoint, `GET /api/analytics/dataset`, in the style of `explore.mapPayload`: all live songs with only the fields the charts use, so every filter and chart updates client-side with no round trips.
- One slim filter bar shared by every tab: genre source, parent genre, release-year window (a two-handle range in the style of `YearStrip`), a one-line count of what the slice contains, and a "Browse these songs" link.
- Five tabs:
  - **Over time:** songs per era by parent genre (stacked area; counts or share; 5-year or yearly), lyrical tone by decade, sonic shift by decade (median tempo and loudness).
  - **Arguments:** a three-column flow, preset pathways (Genre > Lyrical tone > Advocacy action; Speaking to > Moral frame > Advocacy action; Vocal style > Lyrical tone > Primary emotion), plus "Themes that travel together" (most frequent co-occurring theme pairs).
  - **Sound:** tempo against loudness scatter coloured by parent genre; major vs minor balance by genre.
  - **Compare:** genre vs genre or era vs era with presets, mirrored bars for the message fingerprint (tone, themes, advocacy) and sound fingerprint (intensity, vocals, mood) with median tempo, loudness and share minor; below it an "Advanced" cross-tab (row dimension by column dimension; Count, Row %, Lift).
  - **Artists:** catalogue depth (how many artists have 1, 2-4, 5-9, 10+ songs), a top-contributors leaderboard, and a curated-language chart once it is meaningful (see Language below).
- Every chart states its denominator in its caption ("based on 672 lyric-coded songs").
- Every chart has a table view (accessibility and checking).
- Delete the five old `/api/analytics/*` routes and the `chart.js` / `react-chartjs-2` dependencies once the first phase ships.

## Non-goals

- No song drawer: "Browse these songs" and per-element click-throughs go to the existing Browse page.
- No world map, origin-country panel or active/legacy cohort panel in this build: 1 of 642 artists has a country and none has a formed year. Recorded as deferred; they return when artist data exists.
- No audio samples in the payload (`audio_samples`, and with it the `show_audio_samples` gate, is not used by any chart).
- No AI-detected languages anywhere on this page (language is curator-approved; see Language).
- No per-song lyric or transcript text, ever.
- No mock or "preview" data in production.

## Anti-goals (what would make this a failure even if it works)

- A chart whose number a visitor cannot reproduce from what the page tells them (denominators missing, a Browse link that shows a different count than the chart).
- A confident sentence generated from a handful of songs.
- A page that is a wall of charts again, only now hidden behind tabs.
- Anything that lets the curator-owned catalogue be written to, or lets lyric or transcript text reach a public route.

## Constraints

- **Privacy:** the dataset service and route never reference `song_lyrics`, `translation`, or `song_audio_transcripts` (the existing `lyrics_privacy.test.js` guards cover this; the new service file is covered by the scan).
- **Legacy audio:** sound figures come only from `song_audio_analysis` through `audioAnalysis.LATEST_AUDIO`; nothing reads the frozen `song_lyric_analysis` acoustic columns or Spotify audio features (`legacyAudio.test.js` must stay green).
- **Live songs only:** `status = 'included' AND published = true`.
- **Lyric analysis:** read through `analysis.LATEST_ANALYSIS` with its junk and stale gates (a song counts as lyric-coded only when its analysis is publicly visible), codes gated by the codebook; `act` is `advocacy`, never `tactics`.
- **Genre:** catalogue genre is the song's own genre, else its first artist's (`genres.EFFECTIVE_GENRE_SUBQUERY`), mapped to a parent with `getParentGenre`; the audio-inferred parent is a read-only fallback and is never written to `songs`.
- **Tokens only:** `--bg-*`, `--text-*`, `--accent-*`, `--explore-cat-1..7`, `--explore-not-coded`, `--tl-grit` / `--tl-pulse`. No emojis in any label; labels come from `metadataCodebook`, `acousticCodebook` and the taxonomy (never `short_tag`).
- **Colour rules:** at most six categorical hues plus a neutral grey "Other" (`--explore-not-coded`), as on the Explore map; Compare uses `--tl-grit` against `--tl-pulse`. Run the dataviz palette validator on any new colour pairing; do not invent colours.
- **Architecture:** pure, DOM-free, `node --test`-tested modules (`frontend/src/utils/dataUrlState.js`, `frontend/src/components/explore/data/dataModel.js`), with React/SVG presentation kept thin, as `explore/` does. Server logic in `backend/services/dataset.js` with tests; the route stays a thin wrapper.
- **No `localhost:5000` URLs**; relative `/api/...` only. Year bounds come from the data, not constants.

## How the numbers are protected (calls made while reviewing)

- **Genre basis is always visible.** The caption under any genre-split chart says how many of its songs are using an audio-inferred genre ("1,314 placed by genre; 251 of them audio-inferred").
- **Browse links stay honest.** Browse knows catalogue genres only. In "Catalogue + audio fallback" mode, when the slice contains audio-inferred songs the link carries a short note ("Browse matches catalogue genres only; N of these M songs are audio-inferred"). The Arguments flow uses each song's *primary* code per dimension while Browse matches *any* code, so a flow click-through says "Browse counts songs with this code anywhere, not only as the main one". Click-throughs use `browseUrlState` vocabulary only.
- **Small samples.** Insight sentences ("In the 1980s Punk led at 49%...") are written only when each compared group has at least 30 songs, and hedge ("about"). Decade points with fewer than 10 songs are not plotted. Lift cells with fewer than 3 songs are faded. Every threshold is a named constant in `dataModel.js`.
- **Coverage is stated everywhere**, because half the catalogue has no lyric coding and some eras are tiny.

## Language (Artists tab)

Curated `songs.language` covers about 9% of live songs today. The curated-language chart appears only when at least a quarter of live songs have a curated language (a named constant); below that the panel is simply absent, with no empty "progress" card. The lyric-analysis `detected_languages` never feed this chart: the curator approves them through the Language suggested rail, and the chart grows as that work is done.

## Data contract (summary)

`GET /api/analytics/dataset` returns `{ songs, artists, labels, coverage }`.

- `songs[i]`: `id`, `t` (title), `a` (display artists), `y` (release year or null), `cp` (catalogue parent genre or null), `ap` (audio-inferred parent genre or null), `ha`, `hl` (has OK audio / has visible lyric coding), `bpm` (null for unmetered), `lufs`, `mode`, lyric scalars `persp`, `tone`, `focus`, `aud` (codebook-gated), lyric arrays `emo`, `thm`, `act`, `frm`, audio `aint`, `atex`, `avoc`, `amood`. `clar`, `thm_sd`, `tgt`, `arhy`, `aarc`, `ains`, `key` are included only if a built chart uses them, the build phase decides. Never `asmp` or `al`.
- `artists[i]`: `id`, `name`, `n` (live songs). Country and active-status fields are not shipped until their panels are built.
- `labels`: code-to-label dictionaries from the codebooks, hidden codes omitted.
- `coverage`: the denominators (live songs, dated, genre-covered by each basis, audio-analysed, lyric-coded, curated-language).
- Cached in process for a short time; target under 100 ms uncached and a few hundred KB gzipped (compare `mapPayload`, about 393 KB).

## Phasing (each phase ships on its own and is curator-smoked before the next)

1. `dataset` service and endpoint, route shell with the five-tab routes, filter bar and URL state, **Over time** tab. Retires the old dashboard, its five routes and Chart.js.
2. **Arguments** (the flow and theme pairs).
3. **Sound.**
4. **Compare** and the advanced cross-tab.
5. **Artists** (depth, leaderboard, language when meaningful).

A tab whose phase is not built yet is not shown in the tab row.

## Phone

The tab row scrolls horizontally; the filter bar collapses to a one-line "Slice" summary that expands; the Arguments flow becomes a ranked list of pathways below a width where the ribbons cannot be read; scatter and heatmap scroll or reflow. Table views work everywhere.

## Left to the builder

Exact SVG geometry, tooltips and hover behaviour; the dataset cache lifetime; which optional fields in the schema each chart ends up needing; the cross-tab's dimension lists beyond those named in the handoff; the wording of captions within the rules above.

## The author's calls (for the curator to check)

No song drawer; no AI languages; no origin or active/legacy panels yet; language chart gated at a quarter of songs; `t` and `a` kept in the payload for scatter tooltips and links to song pages; thresholds (30 / 10 / 3); neutral grey for "Other" and first-column-only colouring in the flow; a tab is hidden until its phase is built; the old routes and Chart.js are removed in phase 1; the Compare tab hosts the cross-tab as "Advanced".
