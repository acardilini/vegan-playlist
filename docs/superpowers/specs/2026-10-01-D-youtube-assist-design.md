# Sub-project D — YouTube assist (design)

Date: 2026-10-01 · Status: awaiting curator review · Parent design:
[`2026-07-12-admin-workbench-design.md`](./2026-07-12-admin-workbench-design.md) §7 ("D — search-and-pick
replaces manual add-by-URL in the Video panel")

## 1. Goal

From the curation workbench, the curator presses **Find videos** on a song and sees real YouTube
candidates (thumbnail, title, channel, duration, an embeddability warning). They tick one or more, adjust
each one's type if needed, and add them in one action. Add-by-URL stays as the fallback. Nothing reaches
the public site without the curator's existing Publish click.

## 2. Current state (verified 2026-10-01)

- `VideoPanel.jsx` (workbench): add-by-URL + type select, primary radio, delete, and a **"Search YouTube"**
  link that just opens youtube.com. Backed by `POST/PUT/DELETE /api/admin/workbench/…videos…` in `admin.js`
  and `services/videos.js` (`addVideo` owns the **exactly-one-primary-per-song** invariant; the first video
  on a song becomes primary).
- `POST /api/youtube/search` is a **mock** returning placeholder results. Nothing in `frontend/src` or
  `backend` calls it. The public song page uses only `GET /api/youtube/songs/:id/video/primary`.
- **442 live songs have no video** (898 songs have one) — the backlog this feature is for.
- No YouTube API key existed. The curator added `YOUTUBE_API_KEY` to `backend/.env` (git-ignored) on
  2026-10-01; a 1-unit `videos.list` call confirmed it works (200, returns `embeddable` + `duration`).

## 3. Decisions (curator, 2026-10-01)

1. Use the **official YouTube Data API v3** with a free key (quota 10,000 units/day; one search here costs
   ~101 units, so roughly 95–100 searches/day).
2. **Multi-select:** tick several candidates, set each one's type, add them together.
3. Add-by-URL remains; with no key configured the panel degrades to today's behaviour with a one-line note.
4. Per-song search from the workbench only. No bulk/auto mode: the existing *Needs video* queue and the
   workbench's previous/next navigation already walk the backlog (YAGNI).

## 4. Backend

New `backend/services/youtubeSearch.js` (pure helpers + one network function, `fetch` injected for tests):

- `searchVideos(query, { fetchImpl = fetch, apiKey = process.env.YOUTUBE_API_KEY } = {})` →
  `{ configured, candidates }`. No key → `{ configured: false, candidates: [] }` without any network call.
  1. `GET search?part=snippet&type=video&maxResults=8&q=<query>&key=…` (100 units).
  2. `GET videos?part=contentDetails,status&id=<ids>&key=…` (1 unit) for duration + embeddability.
  3. Candidate = `{ youtube_id, title, channel, thumbnail, duration, embeddable, suggested_type }`, in the API's
     relevance order. `title`/`channel` are HTML-entity-decoded (`&amp;`, `&#39;`, …). `duration` is formatted
     `m:ss` / `h:mm:ss` from the ISO-8601 value. Videos missing from step 2 are kept with
     `duration: null, embeddable: null`.
  4. A request timeout of 8 s (`AbortSignal.timeout`).
- `guessType(title, channel)` → one of the existing `VIDEO_TYPES`: `lyric` if the title has "lyric(s)";
  `live` if it has "live" (word) / "concert"; `official` if it has "official" or the channel ends in
  "- Topic" or "VEVO"; else `other`. First match wins in the order lyric → live → official → other.
  (`fan-made` is never guessed; the curator picks it.)
- Errors: a Google error body carrying reason `quotaExceeded`/`dailyLimitExceeded` throws `code:
  'QUOTA'`; any other non-2xx throws `code: 'UPSTREAM'`; a timeout throws `code: 'UPSTREAM'`. **The API key
  must never appear in a log line, an error message or a response** (the request URL contains it): log only
  the HTTP status and Google's `reason`, never the URL or the fetch error's `cause`.

New routes in `routes/admin.js` (behind the existing admin middleware), in the workbench group:

- `GET /api/admin/workbench/:id/video-search` — builds the query `"<artists> <title>"` from the song
  (404 for an unknown id), calls `searchVideos`, and marks each candidate with `already_added` (its
  `youtube_id` is already on this song). Response `{ configured, query, candidates }`. QUOTA → 429
  `{ error: 'quota', message: "Today's YouTube search quota is used up" }`; UPSTREAM → 502.
- `POST /api/admin/workbench/:id/videos/bulk` — body `{ videos: [{ youtube_id, video_title, video_type }] }`,
  1–10 items (else 400). Runs inside **one transaction** through `addVideo` (so the one-primary invariant
  holds and the first video added to an empty song becomes primary). A `youtube_id` already on the song is
  **skipped, not an error**. Any invalid item aborts the whole batch (nothing half-added). Response
  `{ added: [...], skipped: [youtube_id…] }`.
- **Delete** the dead mock `POST /api/youtube/search` from `routes/youtube.js`.
- `backend/.env.example` gains a `YOUTUBE_API_KEY=` line.

No migration.

## 5. Frontend

- `VideoPanel.jsx`: a **Find videos** button beside "Search YouTube". It calls the search route and shows
  results inside the panel:
  - each row: checkbox, thumbnail, title, channel · duration, a **Preview** link (opens YouTube in a new
    tab), a **type dropdown** pre-set to `suggested_type`, and — when `embeddable === false` — a
    "won't embed on the site" warning (still addable);
  - candidates with `already_added` are greyed, labelled "Already added", and not tickable;
  - footer **Add N selected** (disabled at 0) → bulk route → reload the song, close the results.
- States: "Searching…"; `configured:false` → "YouTube search isn't configured — add YOUTUBE_API_KEY to
  backend/.env" (add-by-URL keeps working); 429 → "Today's YouTube search quota is used up — try again
  tomorrow, or paste a URL"; no candidates → "No results — try Search YouTube"; other failures → inline error.
- Styling: existing workbench classes + a few `wb-vsearch-*` rules in `styles/admin.css`, tokens only. The
  list stays inside `VideoPanel.jsx` unless it passes ~150 lines, in which case split to
  `VideoSearchResults.jsx`.
- The API key is never sent to or read by the frontend.

## 6. Testing

- Backend `node:test`, fixture prefix **`ZZZYT`**, no real network (`fetchImpl` mocked): `guessType` table
  (each type, precedence, case-insensitive, "Topic"/"VEVO" channels, an empty title); entity decoding;
  duration formatting (`PT3M34S`, `PT1H2M3S`, `PT45S`, missing); candidate mapping incl. a video missing from
  the details response; **no key → `configured:false` and `fetchImpl` never called**; QUOTA and UPSTREAM
  mapping; **the key does not appear in a thrown error message**; bulk add: first video on an empty song is
  primary, adding to a song that has a primary leaves it, a duplicate is skipped, an invalid item aborts
  the whole batch with nothing inserted, >10 items → 400.
- Live smoke (Puppeteer from the scratchpad, never from `backend/`): one **real** search (~101 quota units)
  on a *Needs video* song → results appear with real titles → tick two → set one's type → **Add 2 selected**
  → both appear in the list and exactly one is primary. It deletes the rows it added so the dataset is
  unchanged, and asserts the quota/not-configured copy by stubbing the route response in the page rather than
  spending more quota.

## 7. Out of scope / deferred

Bulk/auto-matching across the 442-song backlog; caching search results; ranking or auto-picking the best
candidate; filtering by YouTube's Music category; embeddability enforcement (warn only); a quota meter;
lyrics (E) and Spotify push (F).
