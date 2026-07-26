# B4 — Explore vector map + vector "You might also like" — design spec

**Date:** 2026-07-27
**Phase/session:** Phase 4 · sub-project B, session B4 (the last B build)
**Status:** design approved by the curator; implementation plan to follow
**Supersedes:** the B4 section of [`2026-07-17-B-analysis-integration-design.md`](./2026-07-17-B-analysis-integration-design.md),
whose premises (a `frontend/public/vector_space.json` with `themes`/`audio_2d`/`audio_3d`, and
"colour by sub-dimension") were invalidated by read-only probing on 2026-07-26/27.
**Brainstorm handoff this resumes:** `.superpowers/sdd/b4-brainstorm-handoff.md`

---

## 1. What this builds

Two features over the analysis pipeline's vector output, both **read-only**:

1. **An Explore page** — a 2D canvas scatter of the catalogue in four projected spaces, with a
   colour-by menu, a legend that doubles as a spotlight filter, a song search, and a card for the
   selected song. The existing analytics dashboard moves in beside it as a second tab.
2. **A vector "You might also like"** on the song page — two tabs, *Similar message* and
   *Similar sound*, computed from the full-dimensional embeddings, with an honest genre fallback for
   songs that have no embeddings.

### Out of scope (deliberate)

- **3D.** The `*_3d` columns stay unused. 3D needs a WebGL dependency (~150KB) and raycast
  hit-testing, roughly doubling the surface to test, for a view whose value is unproven. It gets its
  own follow-up session if wanted.
- **Ringing recommended songs on the map** when arriving from a song page — deferred to the same
  3D follow-up.
- **Any pipeline change.** No writes to `song_coordinates`, `song_embeddings` or
  `song_lyric_analysis`; no new derivations. Thematic and holistic *similarity* would need new
  embedding columns from the pipeline (§8).
- **Fixing `DataDashboard`'s hardcoded `http://localhost:5000`** — a known Phase 5 deployment item,
  equally broken wherever the component lives.

---

## 2. Data sources (verified 2026-07-26/27, read-only)

### `song_coordinates` — the map's source

- One row per song, **664 rows / 664 distinct `song_id`**, `updated_at` 2026-07-26.
- Eight `float8[]` columns — `{semantic,thematic,audio,holistic}_{2d,3d}` — **all 100% populated**
  at the correct dimensionality. 0 orphans.
- **Truth-source split: 640 live · 22 `included`-but-unpublished · 2 `pending`.**
- **693 live songs have no coordinates.** The map covers **640 of 1,333 live songs (48%)**.
- Ranges differ per space (`semantic_2d` x ∈ [−3.6, 14.0] vs `holistic_2d` x ∈ [−4.7, 5.1]) —
  the renderer **must rescale per space** and must not assume a shared domain.

### `song_embeddings` — the recommendations' source

- `lyric_embedding`: **768 dims** (min = max = 768), 673 rows, **641 live**.
  *(The curator expected 384; the DB says 768. Not blocking — cosine works at whatever the shared
  dimensionality is. Worth a pipeline glance.)*
- `audio_embedding`: **two incompatible shapes in one column.**
  - **664 rows at 6 dims** — `[energy, valence, danceability, acousticness, speechiness,
    normalized_bpm]`, `updated_at` 2026-07-26, **640 live**.
  - **1,041 rows at 1024 dims** — the old vectors, `updated_at` 2026-07-16, 654 live.
  - **Every query touching this column MUST carry `array_length(audio_embedding, 1) = 6`.**
    This is the single most likely defect in the build.
- The 6 dimensions are on **very different scales** — these are Librosa-derived proxies, not
  Spotify's 0–1 features (`danceability` reaches 4.93):

  | | energy | valence | danceability | acousticness | speechiness | normalized_bpm |
  |---|---|---|---|---|---|---|
  | median | 0.22 | 1.01 | 1.38 | 0.03 | 0.11 | 0.54 |
  | sd | 0.09 | 0.28 | **0.67** | 0.02 | 0.04 | 0.10 |

  A raw distance would be a `danceability` ranking wearing a disguise — hence per-dimension
  standardisation (§4.2).
- **No `pgvector`** — the only installed extension is `plpgsql`. Similarity is computed in SQL over
  `float8[]`.

### Live coverage summary (of 1,333 live songs)

| source | live songs reached |
|---|---|
| `song_coordinates` (map) | 640 |
| `lyric_embedding` (message tab) | 641 |
| `audio_embedding` 6D (sound tab) | 640 |
| latest `song_lyric_analysis` pass (colour-by) | 693 |

**693 of 1,333 live songs (52%) have no embeddings at all** and get the genre fallback. This is not
an edge case, and the page must state its coverage rather than implying it shows the catalogue.

---

## 3. Decisions carried in from the brainstorm

These were settled with the curator and are not re-opened by implementation.

1. **Space discovery is data-driven** — the code reads whichever coordinate sets exist rather than
   hardcoding a list, so a future space appears without a code change. Today: four.
2. **Read through the API, not a static file.** `frontend/public/vector_space.json` is superseded
   and **deleted**. It was a genuine publication-staging leak (22 unpublished + 2 pending songs
   served as a static asset, bypassing the filter every API route enforces), and serving through the
   API makes an unpublish take effect immediately rather than at the next pipeline run.
3. **2D now, 3D as its own follow-up.** No new frontend dependency (the project carries only
   chart.js).
4. **Colour-by is a curated low-cardinality menu** — five acoustic dimensions, `focus_amount`,
   parent genre. Absence codes render as neutral grey **"Not coded"**, never a palette colour.
   *Rejected:* all seven scalar components with top-8 + "Other" bucketing (`tone` has 16 codes, so
   "Other" would swallow half the distribution and the legend would stop being a key).
   *Explicitly not done:* the old spec's "colour by sub-dimension" — a song carries many theme codes
   across several sub-dimensions, so one colour per point would require the implementer to pick a
   "dominant" theme, which is a curatorial act.
5. **Spotlight = clickable legend + song search.** *Rejected:* re-mounting the browse sidebar.
6. **Two similarity tabs, message and sound**, over the **full-dimensional embeddings**.
   *Rejected:* kNN over the UMAP coordinates — see §4.3 for why, since this was re-examined.
7. **Songs with no embeddings get an honest genre fallback**, labelled **"More in this genre"**,
   never implying vector similarity.
8. **Explore absorbs the analytics dashboard** as a second tab; the standalone Dashboard nav item
   is retired.
9. **Interacting with a point brings up the song's card; the card carries the link.** Clicking a dot
   straight through to the song page was rejected by the curator as breaking exploration flow.
10. **The card docks in the right rail**, not as a popover anchored to the point — a popover covers
    the dot's neighbours, which are exactly the songs being compared.

---

## 4. Backend

### 4.1 `GET /api/analysis/explore/points`

One request that answers every interaction on the page. Filtered `status='included' AND
published=true`; colour codes read from each song's **latest analysis pass** via the shared
`LATEST_ANALYSIS` fragment, so the map's colours agree with the browse filters by construction.

```jsonc
{
  "spaces":  [ { "key": "semantic", "label": "Semantic" }, … ],
  "colourBy":[ { "key": "sonic_energy", "label": "Energy",
                 "codes": [ { "code": "…", "label": "…", "count": 478 }, … ] }, … ],
  "coverage":{ "mapped": 640, "live": 1333 },
  "songs":   [ { "id": 123, "title": "…", "artist": "…", "year": 1985, "art": "https://…",
                 "coords": { "semantic": [x, y], "thematic": [x, y],
                             "audio": [x, y], "holistic": [x, y] },
                 "codes":  { "sonic_energy": "MODERATE_BALANCED", … ,
                             "focus_amount": "…" },
                 "genre":  "Punk" }, … ]
}
```

**Size:** ~250KB, ~60KB gzipped. Deliberate: switching space, switching colour-by, spotlighting and
searching then need **zero further requests**, and the selected-song card needs no second fetch.

**Space discovery:** enumerate `song_coordinates`' `*_2d` columns from `information_schema.columns`
rather than naming them. Labels come from a small map (`audio` → **"Sound"**, the site's word for
it) with a **title-cased fallback** for anything unrecognised — the same ungated-display rule
`acousticCodebook.js` already follows.

**Colour-by options:** the five acoustic dimensions and `focus_amount` (labels and code labels from
`acousticCodebook.js` / `metadataCodebook.js`), plus parent genre via `utils/genreMapping.js`. The
four absence codes (`THEMATIC_ABSENCE`, `ABSENCE_OF_FOCUS`, `INSUFFICIENT_DATA`, `UNSPECIFIED`) and
any missing value collapse into one **"Not coded"** entry. Counts are computed over the **640 mapped
songs**, so the legend describes what is on screen.

### 4.2 `GET /api/analysis/songs/:id/similar`

Returns both tabs and the fallback in one response, so switching tabs is instant.

```jsonc
{ "tabs": [ { "key": "message", "label": "Similar message", "songs": [ …6 ] },
            { "key": "sound",   "label": "Similar sound",   "songs": [ …6 ] } ],
  "fallback": null }
// or, when tabs is empty:
{ "tabs": [], "fallback": { "label": "More in this genre", "songs": [ … ] } }
```

- **Message** — cosine over the full 768-dim `lyric_embedding`, in SQL via
  `unnest … WITH ORDINALITY`.
- **Sound** — Euclidean distance over the 6-dim `audio_embedding`, **z-scored per dimension** in a
  CTE over the live 6-dim set before any distance is taken.
- **`WHERE array_length(audio_embedding, 1) = 6`** wherever that column is touched.
- **6 songs per tab, no similarity score shown.** A cosine value looks like a measurement a visitor
  can act on and is not one; the ordering already says which is closest, and the two tabs' numbers
  would not mean the same thing.
- A tab is **omitted** if that embedding is missing for the song. If both are missing, `tabs` is
  empty and `fallback` carries the genre panel — the existing same-genre query with its dead
  audio-feature clause (`songs.energy` etc. are NULL catalogue-wide) and its `RANDOM()` removed.
- All results are publish-filtered and exclude the song itself.

**Metric registry, not discovery.** Similarity is built around a small registry —
`{ column, metric, standardisation, label }` — with two entries today. Adding a third tab is one
entry plus a test. This deliberately does **not** mirror the map's automatic space discovery:
coordinates are interchangeable (every one is an (x, y) to plot), whereas each embedding needs a
metric and a normalisation judgement that code should not guess.

**Performance:** the message cosine is ~641 × 768 multiply-adds per request. Measure it against live
data during the build and record the number. A Node-side vector cache is **not** built speculatively
— its invalidation would depend on noticing that an external pipeline ran, which is exactly the
failure mode that serves stale recommendations silently. Revisit only if the measurement is bad.

### 4.3 Why full-dimensional cosine, not kNN over the coordinates

Re-examined at the curator's prompt and confirmed. The coordinates are a **lossy 2D shadow** of the
embeddings, not the vectors themselves; the vectors are already in `song_embeddings`, so neither
option re-derives anything. UMAP's objective *is* local structure, so projection-kNN approximates
the real thing — but:

- **Crowding.** 640 points in a bounded plane means dense regions where dozens of songs sit at
  near-identical distances; "the closest 6" is then a pick from a tie, giving 6 songs from the right
  blob rather than the 6 most similar. A top-6 list is precisely where this bites.
- **Instability.** UMAP is stochastic; re-running it on unchanged embeddings yields rotated,
  flipped, locally reshuffled coordinates, so recommendations would churn between pipeline runs for
  no perceptible reason.
- **Information already discarded.** 768 → 2 is a ~99.7% reduction.

Accepted cost: cosine neighbours will not always look adjacent on the map.

### 4.4 Files

- **New** `backend/services/explore.js` — coordinates read, space discovery, colour-by assembly,
  the similarity registry and its two metrics, the genre fallback.
- **Changed** `backend/routes/analysis.js` — the two routes above.
- **Changed** `backend/routes/spotify.js` — `GET /songs/:id/similar` deleted; its genre query moves
  into `services/explore.js`.

---

## 5. Frontend

### 5.1 Nav and routing

Nav becomes `Home · Artists · Playlists · Explore · Submit Song · About · Admin` — **Explore after
Playlists**, **Dashboard retired**. Routes: `/explore` (Map) and `/explore/data` (Data) as real
nested routes so each tab is linkable; `/dashboard` redirects to `/explore/data`.

### 5.2 Map tab — layout

Toolbar across the top (space chips · colour-by select · "Find a song"), the canvas below, and a
~230px right rail holding the legend and, beneath it, the **Selected** slot — a one-line hint until
a point is clicked, then the song card: cover art, title, artist · year, the colour-by value, and a
**View song →** link to `/song/:id`. The coverage line sits under the plot:

> Showing 640 of 1,333 songs — only songs the analysis has mapped appear here.

On narrow screens the rail drops below the map and the toolbar wraps. No drawer: there is nothing to
hide.

*Rejected layouts:* a left sidebar like browse (Explore's controls are not filters, and it costs
~230px of plot); a full-bleed map with floating panels (they always sit on top of real songs).

### 5.3 Interactions

- **Hover** — a light card follows the cursor: title, artist · year, and the current colour-by value
  (which re-labels itself when colour-by changes). `pointer-events: none`; flips near edges.
- **Click** — selects the point: it takes a ring and its card fills the rail. **Nothing navigates
  until View song is pressed.**
- **Legend** — each entry is a multi-select toggle. Selected codes keep full colour; the rest dim to
  faint neutral. Counts are fixed to the mapped set: the legend is a spotlight, not a filter, so
  there is no exclude-self recounting.
- **Search** — typing dims non-matching points *and* lists matches under the box, each selecting its
  point.
- **View state lives in the URL** — space, colour-by, spotlighted codes, query, selected song — via
  `useSearchParams`, the pattern triage 2 set for browse. Views are shareable, and Back from a song
  page restores the map rather than resetting it.

### 5.4 Rendering

Hand-rolled canvas, `devicePixelRatio`-aware, **rescaled per space** (§2). Dimmed points drawn
first, then full-colour, then the selected ring. Hit-testing is a linear scan over 640 points on
mousemove.

### 5.5 Colour and accessibility

- The **`dataviz` skill must be invoked before writing any palette or chart code** — project rule and
  the skill's own trigger. The palette must hold up in light and dark and use the design tokens
  (`--bg-*`/`--text-*`/`--accent-*`/`--space-*`, never raw colours). "Not coded" is neutral grey.
- The canvas carries `role="img"` and an aria-label stating what is plotted and the coverage.
- **The search box and its result list are the non-visual route into the map** — the same control
  sighted users get, landing on the same card with the same link.
- **No arrow-key point cycling.** Stepping one at a time through 640 dots satisfies a checklist
  without helping anyone; searching by name is what a keyboard user would actually want.
- Hover help uses `InfoTip`, never the native `title` attribute.

### 5.6 Data tab

`DataDashboard` renders unchanged inside the tab, including its hardcoded `http://localhost:5000`
(§1, out of scope). Its `<h1>Vegan music analytics</h1>` demotes to `<h2>` so the page has one
heading.

### 5.7 Song page — "You might also like"

The section keeps its heading and its existing `.similar-songs-grid` / `.similar-song-card` styling,
and gains two tabs, **Similar message** / **Similar sound**, filled from one request on song load.
A tab is omitted when its embedding is missing; when both are, the tabs are replaced by the plain
**More in this genre** panel. "Sound" and "message" match the site's existing vocabulary ("In the
sound" on this same page, the "Sound" filter group).

### 5.8 Loading, empty and error states

- **Map loading** — the toolbar and rail render immediately; the plot area shows a loading state
  until the single points request resolves. No skeleton dots (a fake scatter would misrepresent the
  data).
- **Map request fails** — an error message in the plot area with a retry, matching the browse page's
  existing error treatment. The Data tab is unaffected.
- **`?song=` names a song that is not on the map** (unmapped, unpublished, or a stale link) — the
  parameter is ignored silently and the rail shows its hint. No error: a shared URL outliving a
  publication change is expected, not exceptional.
- **Search matches nothing** — the result list shows a plain "No songs match" line and no points are
  dimmed, so the map stays readable.
- **Similarity request fails** — the song page's section is omitted entirely rather than showing a
  broken panel; the rest of the page is unaffected.

### 5.9 Files

- **New** `frontend/src/pages/ExplorePage.jsx` (tab shell) and `frontend/src/components/explore/`
  — map canvas, toolbar, legend, selected-song card, song search.
- **New** `frontend/src/components/SimilarSongs.jsx` (the tabbed section).
- **Changed** `App.jsx` (routes + redirect), `NavigationMenu.jsx`, `SongDetailPage.jsx`,
  `DataDashboard.jsx` (heading level only), `api/` service additions, `styles/components.css`.
- **Deleted** `frontend/public/vector_space.json`.

---

## 6. Verification

- **Backend `node:test`**, with its **own sentinel prefix** (shared LIKE-prefix cleanup races under
  parallel runs). Baseline to preserve: **151/151**. New coverage:
  - the publish filter excludes `included`-unpublished and `pending` songs from both endpoints;
  - space discovery returns the four spaces and survives an unknown space name (title-cased label);
  - absence codes and missing values collapse to a single "Not coded" entry, with correct counts;
  - `array_length(audio_embedding, 1) = 6` is enforced — a 1024-dim row never enters a distance;
  - z-scoring is applied before the sound distance;
  - cosine ranking matches a hand-checked fixture;
  - a tab is omitted when its embedding is missing; the genre fallback fires only when both are.
- **Frontend:** `npm run lint` (0 errors; 6 pre-existing warnings) and `npm run build` clean. No test
  runner exists.
- **Live smoke on isolated ports** — backend `:5001`, Vite `:5199` — so the curator's `:5000`/`:5173`
  are never touched. Kill by **PID only**; never `taskkill /F /IM node.exe`. Temp scripts run from
  the scratchpad with absolute requires, never under `backend/` (nodemon restarts the server).
- Curator smoke before merge, as with every session since triage 1.

---

## 7. Risks

| risk | mitigation |
|---|---|
| A 1024-dim row enters a distance query | The `array_length = 6` constraint, with a test that fails without it |
| Sound tab degenerates into a danceability ranking | Per-dimension z-scoring, with a test |
| The page implies it shows the whole catalogue | Coverage line under the plot; the genre fallback never claims similarity |
| Cosine query too slow | Measured during the build and recorded; cache only if the number is bad |
| Palette unreadable in one theme | `dataviz` skill before palette code; check both themes in smoke |
| Payload growth as the pipeline adds spaces | ~60KB gzipped today; revisit if it doubles |

---

## 8. Notes for the analysis pipeline (not this build)

- **Thematic and holistic *similarity* need new embedding columns.** The map already has all four
  spaces because `song_coordinates` holds them, but recommendations need full-dimensional vectors,
  and `song_embeddings` has only `lyric_embedding` and `audio_embedding`. The thematic and holistic
  feature matrices presumably exist transiently in the pipeline (UMAP consumed them); the missing
  step is persisting them. **Keep one shape per column** — the 6-dim/1024-dim mix in
  `audio_embedding` is why every query here carries a length constraint. Each new column also needs
  a metric and standardisation decision (a multi-hot coding matrix is not well served by plain
  cosine; a concatenated holistic matrix needs its blocks scaled).
- `lyric_embedding` is **768** dims, not the 384 expected.
- Carried forward from the acoustic session: the derivation looks unreliable (appears to judge only
  the first ~30s), and `/song/5266` carries a theme apparently inferred from its title.
