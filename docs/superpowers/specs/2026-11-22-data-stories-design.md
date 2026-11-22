# Data stories (scrollytelling) - design

Status: draft for the curator's review (2026-11-22). Follows Explore > Data phase 1 (merged). Where the curator decided something it says so; everything else is the author's call and is listed at the end for checking.

## Intent

Phase 1 gave the Data area honest charts, but charts with generated one-line captions between them do not tell a story. The curator wants staged stories in the manner of ABC Story Lab: a reader scrolls down a single column, short passages of text emerge as they scroll, and between the passages sit full-width visual panels (a chart, a row of songs with their album art) that show what the text just said. The reader finishes understanding something about vegan music and is handed on to the songs themselves.

## Decided by the curator

1. Staged stories are the approach to storytelling. They live in a new first tab of Data, **Stories**; the explorer charts (Over time, and later tabs) stay as the open "explore it yourself" side.
2. **Form:** emergent text between visual panels, not text overlaid on a visual and not text beside a chart. One vertical flow.
3. **Visuals** are data charts plus **album art and song details**. Band photos come later, supplied by the curator; this build uses album art only and leaves room for photos.
4. **The author drafts** the stories from what the data shows; the curator rewrites them in editable files.
5. **The four stories:**
   1. *From shouts to growls* - vocal style by decade. Among sound-analysed songs, shouted vocals fall from 74% (1980s) to 20% (2020s), harsh growls rise from 3% to 46% (1990s) and 60% (2020s), gang chants fall from 64% to 25%, rap appears at 16% (2010s). Exemplars: MDC, Icons of Filth, Terrorizer, Carcass.
   2. *From accusation to resistance* - lyrical tone by decade. "Indictment" falls from about 48% of lyric-coded songs (1980s) to about 27%; "Resistance" rises from about 7% to about 28%.
   3. *What the songs are angry about* - the issues: the most common themes (slaughter, animal suffering, captivity, commodification) and targets (mass slaughter, slaughterhouses, speciesism, factory farming), each with exemplar songs.
   4. *The long road from 1967* - one song in 1967 (Cat Stevens), Wings, Country Joe, Crass, MDC, then the surge after 2006. Framed as the **catalogue's** growth, never the movement's, because curation shapes the curve.
   The numbers above are today's; the stories read live figures (see Tokens), so they never go stale.

## Goals

- `Stories` tab at `/explore/data/stories` (an index of the stories, each a card with title, one line and album-art cover) and `/explore/data/stories/:slug` (the story). `/explore/data` redirects to Stories.
- A story is a **sequence of blocks**: prose, and panels of these kinds:
  - **opening** - title, subtitle, a mosaic of album art from the story's songs;
  - **decade bars** - the share of songs carrying chosen codes in one decade, with the previous decade marked as a ghost tick so change is visible;
  - **decade lines** - chosen codes across all decades (reuses the Over time line chart);
  - **year columns** - songs per year, with named milestone songs marked (story 4);
  - **ranked bars** - the top codes with their song counts (story 3);
  - **songs** - a row of two to four song cards: album art, title, band, year, the curator's one-line caption, a link to the song page;
  - **closing** - a call to action that opens the matching filter in Browse.
- Prose is **Markdown** (the project's existing renderer). Text blocks **fade and rise into view** as they enter the screen; chart panels **animate in** (bars grow, lines draw) the first time they are seen. All motion is off under `prefers-reduced-motion`, and everything is fully visible without JavaScript-driven reveal being required to read it.
- Stories are **editable files** the curator rewrites, served live (edit the file, refresh, no rebuild), like `backend/data/about.md`: `backend/data/stories/<slug>.md`.
- Every panel states its denominator in a small caption ("441 sound-analysed songs from the 2020s; a song can have more than one vocal style, so shares add to more than 100%") and withholds any decade with fewer than 10 songs (the existing `MIN_POINT_N`).
- Phone: the same single column; panels are full width; nothing sits beside anything.

## Non-goals

- No band photos, no uploaded images, no video, no audio playback inside a story (the song card links to the song page).
- No sticky or pinned panels, no scroll-jacking, no scroll-linked scrubbing: text and panels simply alternate down the page.
- No editor UI: the curator edits the Markdown file.
- No story comments, sharing widgets, or analytics.
- No new charting or animation library: SVG plus CSS transitions plus `IntersectionObserver`, as the rest of Data.
- No causal claims in prose and no statements built on fewer than 30 songs.

## Anti-goals (a failure even if it works)

- A story whose prose says a number the adjacent chart does not show, or vice versa (the two must come from the same computation).
- A confident narrative from a thin sample, or one that hides that half the catalogue has no lyric coding.
- A page that is a slideshow of charts with decoration, or one that cannot be read when the animation does not run.
- Any lyric text, transcript text or audio-sample detail reaching a public route.
- A story referencing a song that is not live (it must fail loudly in tests, not 404 in a reader's face).

## The story file

Markdown with a small front matter (`title`, `subtitle`, `order`) and block lines that start with `@` on their own line; everything between block lines is prose. Illustrative shape (the builder may adjust syntax, not the capabilities):

```
@opening songs=152,1376,5002,4788,1486,95
In the 1980s, {{pct vocal_style RAW_SHOUTED 1980}} of songs were shouted ...
@chart decade-bars dimension=vocal_style codes=RAW_SHOUTED,GANG_CHANT,CLEAN_MELODIC,HARSH_SCREAMED_GROWL decade=1980
@songs
152 | Where it started: a shouted plea, 1977.
1376 | ...
@chart decade-lines dimension=vocal_style codes=HARSH_SCREAMED_GROWL,RAW_SHOUTED,GANG_CHANT
@closing browse=vocal_style:HARSH_SCREAMED_GROWL label=Explore the growled songs
```

**Tokens.** `{{...}}` tokens in prose (for example a share of songs carrying a code in a decade, a count, a decade's song total) are resolved **on the server from the same functions that feed the charts**, so prose and chart cannot disagree. An unresolvable token is a **load error** for that story (caught by a test that loads every shipped story), never raw text on the page. Labels come from the codebooks and taxonomy, never from `short_tag`, and no emoji.

## Constraints

- **Same data rules as the rest of Data:** live songs only (`status = 'included' AND published = true`); lyric fields only through `analysis.LATEST_ANALYSIS` (junk and stale gates), sound fields only through `audioAnalysis.LATEST_AUDIO`; codes gated by the codebooks; `advocacy`, never `tactics`; nothing reads `song_lyrics`, `translation`, `song_audio_transcripts` or `audio_samples` (`lyrics_privacy.test.js` must scan the new files; `legacyAudio.test.js` stays green).
- **Song cards** carry only title, artists, year, album-art URL (the same `albums.images[0].url` the map already uses), the curator's caption and the song id. Not the lyric summary.
- **Server:** a pure story parser and resolver in `backend/services/stories.js`, a thin route `/api/stories` (index and `/:slug`). The slug is looked up in a `Map` built from the files that exist, never joined into a path (the `content.js` pattern), so traversal is impossible by construction. No cache at first; add one only if measured to be slow.
- **Frontend:** pure, `node --test`-tested modules for anything computed (chart geometry, reveal logic kept out of components); thin React/SVG panels under `components/explore/data/story/`; tokens only (`--bg-*`, `--text-*`, `--accent-*`, `--explore-cat-1..7`, `--explore-not-coded`); at most six hues plus grey; every chart has a table view and states its denominator.
- The slice bar (genre, years) belongs to the explorer tabs only; Stories do not show it. The tab row now has more than one tab, so it appears.
- No `localhost` URLs; relative `/api/...` only.

## Phasing (each phase ships on its own and is curator-smoked)

1. **Machinery + story 1.** Story parser/resolver and route, Stories tab and index, the story page with emergent text and animated panels, panels: opening, decade bars, decade lines, songs, closing; story 1 *From shouts to growls*, drafted.
2. **Stories 2 and 4.** *From accusation to resistance* (decade lines on tone, reusing the line chart) and *The long road from 1967* (new year-columns panel with milestone marks).
3. **Story 3.** *What the songs are angry about* (new ranked-bars panel).

The explorer phases 2-5 from the Data redesign (Arguments, Sound, Compare, Artists) are **paused** until the stories are smoked, then revisited: some of what they would have shown may now live better as stories.

## Left to the builder

Exact SVG geometry and animation timings; the precise `@` syntax and token grammar within the capabilities above; how milestone songs are marked on year columns; card and panel styling within the tokens; the draft prose of stories 2-4 beyond the facts above; which exemplar songs fill each `songs` block (the author picks from the data; the curator can swap ids).

## The author's calls (for the curator to check)

Stories is the first Data tab and `/explore/data` redirects to it; one new route family rather than extending `/api/content`; block lines with `@` and server-resolved `{{tokens}}`; no caching; no sticky panels; panels animate once on first view; the explorer phases 2-5 are paused; story 4 framed as catalogue growth; song cards without the lyric summary; the exemplar songs named above (MDC, Icons of Filth, Terrorizer, Carcass, Cat Stevens, Fear Factory) as a starting set; the slice bar hidden on Stories.
