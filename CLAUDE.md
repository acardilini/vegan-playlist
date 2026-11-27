# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Vegan Playlist is a web-based resource for vegan-themed music featuring a curated database of 650+ songs. It consists of a React frontend and Node.js/Express backend with PostgreSQL database integration and Spotify API connectivity.

The project is undergoing a **structured modernisation** (messy prototype → clean, branded, deployable product) without a full rewrite. The backend, PostgreSQL schema, and 650-song dataset are preserved and cleaned; the frontend and ops layer are rebuilt. See the modernisation docs in `docs/`.

## Modernisation Workflow

This project is worked on in **phases** and **sessions** (see [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)). Follow the Start-Session and End-Session guides below every session.

### Core principle: YAGNI
Build only what is needed now. No speculative features, abstractions, or infrastructure. If the PRD lists something not needed yet, defer it (record it in the Backlog/Deferred section of `PROJECT_PLAN.md`) rather than building it. Prefer the simplest thing that works. Every change is also weighed against one question: **does this risk the 650-song curated dataset?**

### Key documents (read/update these, not just code)
- [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) — what & why; modernisation philosophy. (Stable)
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — phases → sessions → smoke tests. (Update as phases progress)
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — **living doc**: current phase/session, next tasks, decision log, changelog.
- [`docs/PRD.md`](docs/PRD.md) — product vision + as-built feature inventory (§11).

### Start-Session Guide
Run at the beginning of every working session:
1. **Read [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)** — identify the current phase, the current/next session, and the "Next Tasks" list.
2. **Read the relevant phase in [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)** for the session's tasks and its smoke-test expectation.
3. **Check the Decision Log** in `PROJECT_STATE.md` for constraints that affect today's work.
4. **State the plan for the session** to the user (which session, what tasks, expected outcome) before starting work.
5. **Check git status** so you begin from a known-clean state.

### End-Session Guide
Run before ending every working session:
1. **Smoke test** (if any code changed): launch backend + frontend and exercise the affected flow as a user would; confirm nothing broke. Report the result.
2. **Update [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)**: advance the current/next session, refresh "Next Tasks", add any new entries to the Decision Log, and append a Changelog entry for what was done.
3. **Update [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)**: mark sessions ☑/◐, and adjust upcoming sessions if the work reshaped them.
4. **Update other docs if affected** (`PRD.md` feature inventory, `PROJECT_OVERVIEW.md`, this file).
5. **Commit and push**: stage the work + doc updates, write a clear commit message, and push. End commit messages with the required co-author trailer.

## Development Commands

### Backend (Node.js/Express)
- **Development server**: `cd backend && npm run dev` (uses nodemon)
- **Production server**: `cd backend && npm start`
- **Install dependencies**: `cd backend && npm install`

### Frontend (React/Vite)
- **Development server**: `cd frontend && npm run dev`
- **Build for production**: `cd frontend && npm run build`
- **Lint code**: `cd frontend && npm run lint`
- **Preview production build**: `cd frontend && npm run preview`
- **Install dependencies**: `cd frontend && npm install`

### Database
- **Create tables**: Run `backend/database/schema.sql` against PostgreSQL database, then the migrations in `backend/database/migrations/` (psql, in order)
- **Import/enrich data**: `backend/scripts/enrichFromSpotify.js` (dry-run by default) or the admin Dashboard's **Spotify playlist** card (Pull) — both import-only

## Architecture

### Backend Structure (`backend/`)
- **server.js**: Main Express server; mounts 9 routers: `/api/spotify`, `/api/admin`,
  `/api/playlists`, `/api/youtube`, `/api/submissions`, `/api/analytics`, `/api/analysis`,
  `/api/content`, `/api/spotify-auth` (**separate from `admin.js` on purpose:** `admin.js` checks `X-Admin-Password`
  on every route and Spotify's redirect back to us is a plain browser navigation that cannot send it —
  `POST /start` + `GET /status` are header-authed, `GET /callback` is guarded by a single-use 10-minute `state`)
- **routes/**: `spotify.js` (public site API), `admin.js` (~2,200 lines, password-protected
  curation API in six banner-named domains: Songs/curation (incl. the Submissions Inbox) ·
  Enrichment · Data quality · Sync (import-only) · Artists · Staging/lifecycle, plus the Band check routes; see
  `docs/ADMIN_AUDIT.md`), `playlists.js`, `youtube.js`, `submissions.js`, `analytics.js`,
  `content.js` (triage 6 — the two-route `GET /api/content/:slug` read behind the About
  section's Markdown pages; the `slug` is looked up in a hard-coded `Map` of `{about, analysis}`
  → filename, deliberately **not** a plain object, since a plain-object lookup of `constructor`
  returns a truthy inherited function that would then be used as a filename — 404 for anything
  else, so path traversal is impossible by construction rather than by sanitising).
  Dead code pruned in Session 2.2 (`admin_simple.js`, `lyrics.js`, ~33 endpoints).
  `submissions.js` is now **public-only** (`POST /submit`); submissions moderation lives in `admin.js`
  (`/curation/inbox*`, authed) — the old unauthenticated `/api/submissions/admin*` routes were deleted in C
- **services/staging.js**: staging-queue service (queues, include/reject/publish, candidate
  intake, submissions→pending bridge); tests in `test/staging.test.js` (node:test)
- **services/spotifyAuth.js + services/spotifyPush.js** (sub-project F, Spotify sync): `spotifyAuth` is the one-time
  Authorization-Code sign-in (scopes `playlist-modify-public/private` only) keeping **only a refresh token in the
  gitignored `backend/.spotify-token.json`** (no DB row, per-machine); `getAccessToken()` refreshes per use. **Nothing there
  may log or rethrow the code, a token, a request body or a fetch error's message** (errors are fixed strings + `.code`:
  NOT_CONNECTED / REAUTH / UPSTREAM; REAUTH only for `invalid_grant` on a *refresh*). `spotifyPush` is **add-only,
  click-only and never writes the DB**: `compare` buckets pullable / pushable / possibleDuplicates / noSpotifyId /
  onPlaylistNotLive; `pushSongs` re-reads the **live** playlist first (idempotent), adds in chunks of 100 via a direct
  `POST /v1/playlists/{id}/items` (the library's `/tracks` write path is reportedly 403'd by Spotify's March-2026 dev-mode
  change; reads work on both), one push at a time (`BUSY`), 429 with Retry-After > 30s fails fast. **Possible duplicate** =
  same normalised title + first artist (`staging.normalizeName`, which strips parentheticals and " - …") as a playlist
  track with a *different* id — unless that playlist track is itself a **live** catalogue song (Vox 2 / Vox 3). Duplicates
  leave the push list and the bulk push; only an explicit per-song push with `allowDuplicates` overrides. Compare's playlist
  read is a slim parallel read (`fetchPlaylistTracksLite`, ~3s) cached 60s (`?fresh=1` bypasses but writes; a
  generation counter stops a pre-push read re-caching); push never uses the cache. Routes: `GET /api/admin/spotify/compare`,
  `POST /api/admin/spotify/push`; pull is the unchanged import-only `POST /api/admin/sync-spotify-playlist` (needs a JSON
  body — `adminFetch` must send `body: {}`).
- **services/youtubeSearch.js**: the workbench's "Find videos" (sub-project D) over the **official YouTube
  Data API v3** — `searchVideos` (`search.list` ~100 quota units + `videos.list` 1 unit; 10,000/day, so ~99
  searches), `findCandidatesForSong` (query = **first-listed artist** + title, i.e. the lowest
  `song_artists.id`, because joining a collaboration's artists made YouTube return nothing; flags
  `already_added`), and the pure `guessType` (lyric → live → official → other; `fan-made` is never guessed).
  `fetch` is injected so the tests never touch the network. **The key is in the request URL, so nothing may
  log or rethrow a URL, a fetch error's message or its `.cause`** — errors carry only the HTTP status and
  Google's `reason`, mapped to `QUOTA` (429) / `CONFIG` (bad or disabled key, 502 with a fix-the-key message)
  / `UPSTREAM` (502). `videos.addVideos` is the transactional bulk add (1–10 items, duplicates skipped, any
  invalid item rolls back the batch). The dead mock `POST /api/youtube/search` was deleted
- **services/lyricsQuality.js + services/junkLyrics.js** (sub-project G): `lyricsQuality.classify` is the pure detector
  (`error` stubs from failed scrapers; `youtube_description` boilerplate — strong patterns alone, two weak markers together, a `[Verse`
  header vetoes). `junkLyrics` maintains `song_lyrics.junk_kind` / `junk_dismissed` (scan / listJunk / dismiss / recheck; `saveLyrics`
  re-checks on every text change). **Invariants:** a flagged song's analysis is excluded by `NOT_JUNK` inside the shared `LATEST_ANALYSIS` and
  `hasAnalysisExists` (so every public read hides it, no per-query edits), and `curation.HAS_LYRICS_SQL` requires `junk_kind IS NULL` so it reads
  (Public hiding is also **row-level stale**: real lyrics replacing flagged junk stamp `analysis_stale_since`, hiding older passes until a newer one exists; the
  Explore map additionally requires `hasRealLyricsExists` + `hasAnalysisExists`.) (A **blank** flagged row keeps its flag - Clear lyrics must not resurrect the junk-derived analysis - and is excluded from the Junk queue; real
  lyrics saved later let `recheck` decide.)   as having no lyrics. `scan(db, {songIds})` — tests must always pass `songIds`. `listJunk` is the only admin read of lyric text and truncates
  to 120 chars server-side
- **services/bandCheck/** (sub-project H, multi-source Band check): per-band, on-demand review of a band's catalogue across **Spotify, Bandcamp and MusicBrainz**. **Label pages:** `bandcamp.fetchCatalogue(origin, { artistName })` reads every release a `/music` page lists (the `<li data-item-id>` grid items with their `.artist-override` credit, the embedded `data-client-items` JSON for the rest, plain links as a fallback); when more than one artist is credited it is a label page and only releases credited to the band are fetched (`nameKey` folds case/diacritics/punctuation/leading 'The', `creditParts` splits collaborations), a release with no credit is kept, and a label page with none of the band's releases returns `releases: []` with `label.noMatch`. The result carries `label: { artist, hidden, credits, noMatch }`, which `loadMerged` copies into `sources.bandcamp.label` and `CatalogueReview`'s `LabelNote` shows.
  Three injected adapters (`spotify.js`, `bandcamp.js` reads the page's embedded JSON-LD, `musicbrainz.js` paced ~1.1s/request; `http.js` `defaultFetch`), the pure
  `merge.js` (`keyOf` Unicode-aware title key, `mergeCatalogues`, `buildIndex`/`classify` vs the catalogue by spotify id / bandcamp url / title), and `index.js`
  (`listBands`, `identifyCandidates`, `saveIdentity`, `checkBand`, `addSelected`). **Identity is curator-confirmed per source** in `artists.spotify_id` (replace, never
  clear; `spotify_url` written with it) / `artists.bandcamp_url` / `artists.musicbrainz_id` (migration 014). Sources fail independently on read (coded errors, 5-minute
  cache, `?fresh`), but **any failed source aborts an add**; one add at a time (`BUSY`), cap 100 (I2: `addSelected` also takes `rejectKeys` - those new songs are saved as `rejected` rows, flipped only among the pending rows that same apply just created, so an existing catalogue song is never touched; `keys.length + rejectKeys.length` is the cap, a key in both lists is `BAD_INPUT`, the response carries `rejected`). **Nothing may log or rethrow a fetch error's message, URL or token.**
  Five routes under `/api/admin/band-check/...`; adds go through `staging.insertManualCandidate` / `insertCandidates` as pending, tagged `bandcheck` ("From band check").
  Tests: `test/bandCheck*.test.js`. Frontend: `components/admin/CatalogueReview.jsx` (the artist workbench's Catalogue panel: per-song Process/Reject choice applied in one action, plus "mark catalogue reviewed" prompts shown only after a complete error-free read) + `IdentifyPanel.jsx` (its Links panel) over `bandCheckApi.js`; the old Songs > Band check view was retired in I1
- **services/artists.js** (sub-project I1, Artists area): the admin Artists queues, list, read and update. The five queue predicates (`needs-identity`, `needs-check`, `needs-bio`,
- **services/leads.js** (Leads queue, migration 017): bands the curator wants to look into later, admin-only (no public route may read `leads`; a test asserts it). `leadKey` (case, diacritics, punctuation and a leading 'The' folded) is the one name key; `addLead({name, note, song, url, origin})` rejects bad input and reports a **duplicate** (`kind: 'lead'` for a lead in ANY status, else `kind: 'artist'` by comparing keys against `artists.name`) instead of inserting; `listLeads` returns `{leads, counts}` with a live `artist_match`; `updateLead` moves status (stamping `dismissed_at`); `promoteLead` is one transaction that reuses a same-key artist or creates a `data_source='manual'` artist, appends one dated `Lead (date): ...` line to `artists.discography_review_notes` (never overwrites; a lead that already has an `artist_id` adds nothing again), marks the lead `checked` and sets `leads.artist_id` (`ON DELETE SET NULL`). Routes `/api/admin/leads*`. Frontend: `LeadsArea` (`/admin/leads`), the count on the Leads nav label (refreshed by a `leads-changed` window event) and a Dashboard tile. Test `test/leads.test.js` (sentinel `ZZZLEA`, cleanup is ILIKE because tests lowercase names)
- **services/artistFacts.js** (artist facts, migration 016): stored facts on `artists` (`country`, `formed_year`, `disbanded_year`, `first_release_year` (migration 024), `last_release_year`, each with a `*_source` from the allow-list `SOURCE_NAMES` = `MusicBrainz`, `Wikidata`, `Bandcamp`, `Catalogue Albums`, `Gemini Web Search`, `Added by curator`) and the `artist_members` table (`vegan` is curator-only). **There is no Active/Inactive indicator** (curator decision 2026-11-23: a band can reform; the public line shows the range of published work instead; the old `activeStatus`/`active_override` are gone, the column is dormant). The admin Facts panel links a `MusicBrainz` / `Bandcamp` source to its page via `utils/factSources.js` `sourceLink` (valid UUID / http(s) only; public pages show no sources). `saveFacts` / `addMember` / `updateMember` / `removeMember` are the only writers; `proposeFromMusicBrainz` **only reads** (needs `artists.musicbrainz_id`, `NO_IDENTITY` otherwise) and diffs MusicBrainz against what is stored - equal values are omitted, members match by `nameKey` (case/diacritics), a stored member MusicBrainz lacks is never mentioned, so a fill cannot delete a member or change a vegan mark; **Skip stores nothing**. `publicFacts` is the public view (only non-empty accepted parts: country, first and last release year, members; no sources/ids, the formed and disbanded years stay admin-only (curator 2026-11-23: formed clashes with releases); null when empty) attached as `artist.facts` on `GET /api/spotify/artists/:id`, and `utils/artistFactsText.js` `summaryLine` prints it as `Germany · Released 1996–2024` (`Released 1999` when equal, `Last release` / `First release` when only one is known, never a backwards range). `services/bandCheck/musicbrainzFacts.js` is the pure parse behind the adapter's `fetchFacts` (first and last release = earliest and latest Album/EP/Single minus Live/Compilation/Remix/Demo; country ISO -> English via `Intl.DisplayNames`; disbanded only when `ended`; 'member of band' relations, live/touring skipped). Routes under `/api/admin/artists/:id/facts*`. Frontend: `ArtistFactsPanel` (workbench side column), `utils/artistFactsText.js` (`summaryLine`, `memberList`, node-tested) on `ArtistDetailPage`. Tests `test/artistFacts.test.js` (sentinel `ZZZAFA`), `test/musicbrainzFacts.test.js`
  `needs-notes`, `done`; plus `all`) live in ONE `PREDICATE` table feeding both `counts()` and `list()`, so a rail count cannot disagree with its list; search is literal
  (`%`/`_` escaped) and the list and count queries share one filter (the old `/all-artists` reused a `$3` placeholder in the count query and failed on any search). `update` writes
  only whitelisted artist columns (never `songs`) and **never identity** - `bandCheck.saveIdentity` is the single writer of `spotify_id`/`bandcamp_url`/`musicbrainz_id`.
  `artists.no_advocacy_notes_needed` (migration 015) lets an artist leave the notes queue. `discography_reviewed` now means "catalogue checked via Band check". Routes: `GET /api/admin/artists/queues`,
  `GET /api/admin/artists`, `GET|PUT /api/admin/artists/:id` (the old `/all-artists`, `/artists-stats` are gone). Tests: `test/artists.test.js` (sentinel `ZZZART`)
- **services/artistEnrichment.js** (artist enrichment piece 2, migration 025, 2026-11-24): the curator's review of the analysis project's staged `artist_enrichment_proposals` (803 rows; **read-only to the web app, and only this service may reference that table or `artist_enrichment_review`** - test-enforced in `test/enrichmentRoutes.test.js`; it selects an explicit column list, never `SELECT *`, so the Layer 4 / website / Wikidata columns are never read). Decisions live in the web-owned `artist_enrichment_review` (`match_decision` approved|rejected + `matched_mbid`, `finished_at`; a decision about a different id than the one now proposed is ignored). **The match state follows the identity stored NOW, not the decision history** (`matchState`): the proposed id stored -> `approved`; a different id stored, an earlier approval whose id is no longer stored, or an `EXISTING` method whose id is not the stored one -> `needs-approval`; `pretrusted` only for `EXACT_ID` with no id stored (and no shared id); a rejection of this id stays `rejected`. So clearing or changing the id under Links locks the MusicBrainz/Wikidata rows again (the workbench keys the panel on the identity, so it re-reads). Migration 025 also adds the unique index `artists_musicbrainz_id_unique` (one MusicBrainz id per artist; the migration refuses with a clear message if duplicates exist; `bandCheck.saveIdentity` now raises `CONFLICT` on it). Read side: `counts` and `list` share ONE `PREDICATE` table (queues `enr-review` / `enr-match` / `enr-dupes` / `enr-done`; the "has something to review" SQL is an **approximation** of `getReview`, so an artist can open to "Nothing new to review"; `enr-match` mirrors `needs-approval` except the shared-id downgrade); `getReview` returns `{has_proposal: false, finished_at}` for an artist with no proposal (and `finish` works without one, so such an artist can be marked reviewed), and its match block carries `wrong_identity`; it returns the match block (`state` none | pretrusted | needs-approval | approved | rejected, `proposed_mbid`, `stored_mbid`, `shared_with`, the artist's own `catalogue` albums/years), the field rows (`country`, `formed_year`, `disbanded_year`, `first_release_year`, `last_release_year`, `bandcamp_url`; equal values omitted; each MusicBrainz/Wikidata row `locked` while the match is not `pretrusted` or `approved`), member rows (new name or status change only, never a delete, the vegan flag never passes through) and `warnings` (last release earlier than the catalogue's latest album, first release later than the catalogue's earliest album, disbanded before last release, formed after the earliest album, a Person with members, a shared MusicBrainz id). **A second-pass verdict that the id is someone else's is never pre-trusted:** `field_conflicts.l4c2_resolution.status = 'WRONG_MBID_IDENTITY_CORRECTED'` (status only, the free text is never read) downgrades `pretrusted` to `needs-approval` in `getReview` and in the `enr-match` SQL (`WRONG_ID_SQL`), with a `match` warning; Accept all then skips the match and its MusicBrainz facts, and the curator can still approve explicitly. **A shared id is a duplicate signal:** an `EXACT_ID` match whose id is also proposed for or stored on another artist is downgraded from `pretrusted` to `needs-approval`, listed under Possible duplicates, and approving the second of a pair is refused by the unique index (merge is piece 3, not built; the notice says so). Write side (the client names only a decision, a field or a member; every value is re-read server-side and goes through the existing single writers `bandCheck.saveIdentity` / `artistFacts.saveFacts|addMember|updateMember`; the proposals table is never written): `decideMatch` (`approve` runs saveIdentity + the decision in ONE transaction; `reject`; `clear`, refused with BAD_INPUT unless the stored decision is `rejected`), `acceptField` / `acceptMember` (may replace a stored value; behind the lock), `acceptAll` (**FILL-ONLY**: approves only a `pretrusted` match, never one carrying a shared-id warning, so it never replaces a stored identity; then applies an unlocked, unwarned field only when the stored value is empty, adds only new members, and fills `bandcamp_url` only when the match is `approved` after that step; every other row comes back in `skipped` with reason `locked` / `warning` / `replace` / `failed`; returns `{applied, skipped, review}`, best-effort per row), `finish(true|false)`. Routes `GET /api/admin/enrichment/queues|queue`, `GET /api/admin/artists/:id/enrichment`, `PUT .../enrichment/match|finish`, `POST .../enrichment/accept|accept-all`. Tests `test/enrichmentMigration|Read|Write|Routes.test.js`. Frontend: the Enrichment group on the Artists rail (`ArtistsArea` / `ArtistQueueList`), `components/admin/EnrichmentPanel.jsx` in the artist workbench (match step with the catalogue beside the proposal, and a "Saved id ... differs" line when another id is stored; one row per fact with Accept / Skip; Skip only hides the row in the view and stores nothing, and once any row is skipped "Accept all shown" is not offered because the server takes no row list (the workbench keys the panel on `artist.id` only and the panel re-reads when `musicbrainz_id` / `bandcamp_url` change, so a Skip survives Approve match); the button is offered only when a row would be filled (unlocked, unwarned, empty stored value; Bandcamp only with an approved or pre-trusted match) or a new member added, so it is hidden when there is nothing to fill even for a pre-trusted match (Approve match is still available); **Undo decision exists only for a rejected match** - an approval is the stored id, changed or cleared under Links; **Accept all never navigates**: it lists `Just accepted: ...` (`acceptedSummary`) and, once the artist is finished, offers an explicit **Next artist →**; Done / Reopen; the shared-id notice links `Merge...` per partner to `?mergeWith=<id>`) and pure `utils/enrichmentText.js` (labels via `Map`, `acceptedSummary`)
- **services/artistMerge.js** (artist merge, piece 3, migration 026, 2026-11-26): fold a duplicate artist (the loser) into the one that stays (the keeper); the only code that moves `song_artists`. `preview(db, keeperId, loserId)` is read-only: songs moving/shared, members moving/skipped (by `artistFacts.nameKey`), leads, `fills` (blank keeper fields the loser has), `conflicts` (both differ: the keeper's wins), `identity.carried/kept` (Spotify / Bandcamp / MusicBrainz) and a sha1 `hash` of everything it read (both artist rows without `updated_at`, both artists' song links and members, the loser's leads). `merge(pool, keeperId, loserId, hash)` is ONE transaction: lock both rows (lower id first), recompute the preview and refuse with `CONFLICT` (409) when the hash differs, write the `artist_merges` snapshot (loser row, `song_artists` ids, members, lead ids), move `song_artists` by **UPDATE so each row keeps its id and a song's artist order (`song_artists.id`) holds**, move non-duplicate members and leads, fill blank keeper fields with their `*_source`, append `Merged from <name> (<date>): <notes>` to `discography_review_notes`, **delete the loser** (cascades its remaining links, members, enrichment review and proposal rows, and frees its unique ids), and only then carry identity ids through `bandCheck.saveIdentity` (still the single writer; injectable as `_deps.saveIdentity` for the rollback test). Any error rolls back everything, snapshot included. Never automatic or bulk; **only this service may name `artist_merges`** and only `routes/admin.js` requires it (test-enforced in `test/artistMergeRoutes.test.js`). Routes `GET /api/admin/artists/:id/merge-preview?keeper=` and `POST /api/admin/artists/:id/merge` `{keeper, hash}` (`:id` is the artist that disappears). Frontend: `components/admin/MergeDialog.jsx` (the artist workbench's merge dialog, replacing `ArtistMergePanel`; name search, default keeper = more songs then live songs then lower id, Swap direction, preview of exactly the direction shown, a confirm button naming the artist it deletes, no `window.confirm`) over pure `utils/mergeText.js` (`defaultKeeper`, `previewLines`). `IdentifyPanel` (Links) also takes a pasted MusicBrainz link or id (`utils/musicbrainzId.js` `parseMusicBrainzId`), offers the enrichment-proposed id first and asks before Clear. Tests `test/artistMergePreview|artistMerge|artistMergeRoutes.test.js` (sentinels `ZZZAMG`, `ZZZAMG2`, `ZZZAMR`)
- **services/bandcampLyrics/** (Bandcamp lyrics fetch): reads a band's own Bandcamp song pages (via the Band check adapter's `fetchTrack`) for songs with **no real lyrics** (same test as `curation.HAS_LYRICS_SQL`: a junk-flagged song counts as none). `match.js` is pure (`matchSongs` by normalised title with apostrophes dropped, two same-title tracks = ambiguous; `creditMatches` skips a track credited to a different artist). `index.js` runs are **in-memory jobs** (start -> poll -> results; one at a time, `BUSY`; a restart loses a run); lyrics exist only in the run until `saveFetched`, which re-checks the song still has no real lyrics (`CONFLICT` otherwise) then calls `curation.saveLyrics` with source `Bandcamp`. Run errors carry fixed strings only. Routes `/api/admin/bandcamp-lyrics/{artist/:id,song/:id,runs/:runId,runs/:runId/save}`; tests `test/bandcampLyrics{Match,Service}.test.js` (sentinel `ZZZBCL`). Frontend: `useBandcampLyricsRun`, `BandcampLyricsPanel` (artist workbench), a Fetch button in `LyricsPanel` (site buttons behind **More sites**). Metal Archives is Cloudflare-blocked and Genius/Spotify lyrics are not usable, so they stay manual **Catalogue integration:** `bandCheck.catalogueForLyrics` serves each catalogue song's key, state, match and Bandcamp URL (server-derived, the client never supplies a URL); `startCatalogueRun` fetches new songs plus held non-rejected songs without real lyrics (no request for a song not on Bandcamp), `resolveForApply` turns run results + pasted text into the Map `bandCheck.addSelected` takes as `lyrics` (saved best-effort after the reject-flip, never onto a pre-existing song; pasted text wins, source `Added by curator`), and `saveHeldLyrics` is the held row's guarded save. Routes `/api/admin/bandcamp-lyrics/catalogue/:id[/save]`; `/band-check/bands/:id/add` accepts `lyricsRunId` + `pastedLyrics`. The Catalogue panel owns the UI (Fetch lyrics, chips, Read / Add lyrics); the artist-workbench 'Lyrics from Bandcamp' panel is gone and `startArtistRun` is unused by the UI. Tests `test/bandcampCatalogueLyrics.test.js` (sentinel `ZZZCLR`), `test/bandCheckLyricsApply.test.js` (`ZZZCLA`).
- **services/playlistCrosscheck.js** (Playlist cross-check, top-level admin tab at `/admin/crosscheck`): compares someone else's *public* Spotify playlist with the whole catalogue (all statuses). `classifyTracks` is pure: Spotify-id match = `have`; else normalised title + first artist (`staging.normalizeName`; a title that normalises to nothing never matches) = `duplicate`; else `new`. `apply` takes only Spotify ids (+ lyrics keyed by id), **re-reads the playlist and re-classifies server-side**, imports chosen tracks as pending (`staging.insertCandidates` with `allowTitleDuplicates: true`, note `added via playlist cross-check (<name>)` -> origin `crosscheck`) and saves rejected ones as `rejected` rows by the I2 trick (insert pending under a unique note, flip only rows that call created). Best-effort per song, one apply at a time (`BUSY`), cap 100; pasted lyrics go through `curation.saveLyrics` for both choices. Routes `GET /api/admin/playlist-crosscheck`, `POST .../apply`. Tests `test/playlistCrosscheck*.test.js`
- **services/platformLinks.js** (Platform links, migration 028): the song page's **Listen on** row (`utils/platformLinks.js` `listenLinks`: Spotify, Apple Music, Deezer, Tidal order, http(s) only, plain text buttons, no logos, YouTube deliberately absent). `songs.isrc` plus table `song_platform_links(song_id, platform deezer|apple_music|tidal, url, status proposed|confirmed|rejected, source isrc|search, match_title, match_artist)`. The adapters are injected `fetch` (tests never touch the network): `spotifyIsrc` (client credentials), `deezerByIsrc` (`api.deezer.com/track/isrc:<isrc>`, exact, saved `confirmed`/`isrc`), `appleSearch` (iTunes Search, strict base-title + first-artist match, saved `proposed`/`search` with `match_title`/`match_artist`); `normTitle` is the one title key. `startRun` is an **in-memory paced job** (gaps Spotify 100 ms, Deezer 120 ms, Apple 3200 ms, so a full catalogue takes 70+ min; one at a time, `BUSY`; a restart loses the run; a Spotify ISRC failure skips only Deezer) over `included` songs with a Spotify id; inserts are `ON CONFLICT DO NOTHING`, so a confirmed or rejected row is never replaced. `reviewLink(db, songId, platform, {action: confirm|reject})`, `linksForSong` (admin), `publicLinks` (**confirmed only**, attached as `platform_links` on `GET /api/spotify/songs/:id`), `counts`. **Nothing may log or rethrow a URL or a fetch error's message.** Routes `POST /api/admin/platform-links/run`, `GET .../runs/:runId`, `GET .../counts`, `GET .../song/:id`, `PUT .../song/:id/:platform`; the `check-links` rail (`curation.js`, included songs with a proposed row). Frontend: `PlatformLinksCard` (Dashboard > Platform links: Find links, progress, counts) and `PlatformLinksSection` (the workbench Links panel: Confirm / Reject beside what Apple called the track). Tidal is not built yet (needs the curator's developer app; `tidal` is already allowed by the table CHECK). Odesli / song.link is closed, so it is not used. Tests `test/platformLinks{Adapters,Run,Routes}.test.js` (sentinel `ZZZPLK`)
- **Audio analysis video** (migration 029): `songs.audio_video_id` (nullable pointer to `youtube_videos`, `ON DELETE SET NULL`; NULL = use the primary) and `audio_video_set_at` (stamped on every change). `videos.setAudioVideo(db, songId, videoId|null)` is the only writer; a video of another song is `BAD_INPUT`, and choosing the primary clears the pointer. The analysis project reads `COALESCE(audio_video_id, primary)` (handoff `docs/MAIN_PROJECT_AUDIO_VIDEO_HANDOFF.md`); the web app never writes `song_audio_analysis`. `curation.getWorkbench` videos carry `is_audio_source`; `audioAnalysis.BROKEN_VIDEO_SQL` also clears a song when `audio_video_set_at` is later than its failed analysis. Route `PUT /api/admin/workbench/:id/audio-video` `{video_id}`; frontend `VideoPanel` (Use for audio / Use primary). Test `test/audioVideo.test.js` (sentinel `ZZZAVD`)
- **Admin UI standard** (`docs/ADMIN_UI.md`, 2026-11-27): admin lists are tables built from the shared `.adm-list` / `.adm-head` / `.adm-row` / `.adm-col-choice` / `.adm-col-name` / `.adm-pill` / `.adm-x` classes in `admin.css` (header row, narrow choice columns, one flexible name column that keeps the leftover width, state shown by radios/checkboxes/tags not label-flipping buttons, a small ✕ for delete, panel text 0.85rem); controls needed mid-task live in the pinned top bar (the **Listen** link, `utils/videoSource.js`). `VideoPanel.jsx` is the reference; new panels follow it and old ones adopt it when next touched
- **Band website and link actions** (2026-11-27): a band's own website is `artists.website_url` (not a song column), edited per credited artist from the song Links panel (saves through `PUT /api/admin/artists/:id`) and from the artist workbench; `songs.bandcamp_url` is the song's Bandcamp play link. `spotifyPush.isOnPlaylist(pool, songId, opts)` answers "is this song on the live playlist" from compare's 60 s cached read (read-only; a song with no Spotify id is not on it with no read; a failed read is a coded UPSTREAM error with a fixed message); route `GET /api/admin/spotify/on-playlist/:songId`. The Links panel hides Add to Spotify playlist when it is on the playlist and Search Bandcamp when a Bandcamp URL exists. Test `test/spotifyOnPlaylist.test.js` (sentinel `ZZZOPL`)
- **services/inbox.js**: the Submissions Inbox (sub-project C) — `listInbox` (pending, **oldest first**,
  catalogue match flagged with `live`), `acceptSubmission`, `dismissSubmission`. **Accept claims the row
  first** (`approved`, match cleared) and only then bridges via staging, reverting to `pending` if the bridge
  throws or yields no song — so a concurrent accept/dismiss gets `NOT_PENDING` and can't orphan a song.
  The submit-time match is a fuzzy prefix match, so Accept stays available on matched rows; staging's
  title|artist dedupe makes an exact duplicate resolve to the existing song. Tests in `test/inbox.test.js`
- **services/dataset.js** (Explore > Data, phase 1, 2026-11-22): `GET /api/analytics/dataset` (the only `analytics.js` route; the five Chart.js-era routes were deleted) serves every live song in ONE payload, `{songs, labels, coverage}`, cached 60 s (~185 KB, ~100 ms uncached). `songs[i]` = `{id, t, a, y, g, ha, hl, tone}`: **`g` is ONE combined parent genre** (`getParentGenre` of the catalogue genre, else of the latest OK `song_audio_analysis.inferred_parent_genre`) with **no provenance anywhere in payload or UI** (curator decision: audio-inferred genres are checked, their source is an admin detail); `tone` is the latest coding pass's `lyrical_tone` through `metadataCodebook.cleanSelection` (legacy/ERROR codes become null); `hl`/`ha` = has a publicly visible lyric coding / an OK audio row. Read-only; never touches lyric or transcript text or audio samples (`lyrics_privacy.test.js` scans the service and route). Test `test/dataset.test.js` (sentinel `ZZZDSET`). Phases 2-5 add fields only when a built chart needs them. **Arguments fields (phase 2, 2026-11-22; payload ~315 KB, ~46 ms uncached):** each song also carries `aud` (target audience, `metadataCodebook.cleanSelection`), `frm` (first moral frame), `act` (first advocacy action), `emo` (first emotion), `avoc` (first audio `vocal_style`, `acousticCodebook.cleanSelection`) and `thm` (ALL its theme codes, an array, `[]` when none); every one except `thm` is the **first valid code after gating** (`validCodes` filters by `analysis.SUBDIM[column]`, listed order kept, hidden/legacy/invented codes dropped) and null when absent; `labels` gains `aud, frm, act, emo, avoc, thm` dictionaries for the codes that appear. **No evidence text is ever selected.** `frm`, `act` and `thm` read the same latest coding pass as every public read; Advocacy action is coded on only ~38% of lyric-coded songs (about 250), which the Arguments captions state.
- **services/stories.js + routes/stories.js** (Data stories, 2026-11-22): the engine behind Explore > Data > Stories. `GET /api/stories` (list: `{slug,title,subtitle,order,cover}`, a broken story is skipped with a console.error) and `GET /api/stories/:slug` (404 `No such story`; slug is looked up in a `Map` built from the files that exist, never joined to a path, so traversal is impossible by construction). **A story is a curator-editable file `backend/data/stories/<slug>.md`**, read on every request (edit, refresh, no rebuild): `---` front matter (`title` required, `subtitle`, `order` default 100); block lines start with `@` (`@opening songs=ids`, `@chart decade-bars|decade-lines ...`, `@songs` + rows `id | caption`, `@closing browse=key:value[,key:value] label="..."`); everything else is Markdown prose. `{{pct <dimension> <code> <decade>}}` and `{{n <dimension> <decade>}}` resolve server-side from the same `decadeShares` provider the charts use, so prose and chart cannot disagree; an unresolved token or bad block throws a `StoryError` (`BAD_FORMAT | BAD_TOKEN | BAD_BLOCK | SONG_NOT_LIVE | NOT_FOUND`), never raw text. `DIMENSIONS` = `vocal_style` (audio, multi-value) and `lyrical_tone` (lyric, scalar); live songs only, latest coding pass / latest OK audio row, codes gated by the codebooks, a decade with fewer than `MIN_POINT_N` (10) songs is withheld (`plot:false`) and never quoted. Song cards carry only `{id,title,artists,year,art,caption}`. **Every figure in a story is derived from the data, never typed:** `parseStory` rejects prose with a `%` or a digit outside a `{{token}}` (four-digit years/decades are allowed as scope labels) and a `@songs` caption with any digit (`BAD_FORMAT`). The author's interpretive wording and a caption's claim about a song's coding are not checked. `lyrics_privacy.test.js` scans both files (no lyric, transcript or sample table may be named in them). Tests `test/stories{Parse,Data,Load}.test.js` (sentinels `ZZZSTD`, `ZZZSTL`); `storiesLoad` also loads every shipped story so a bad edit fails a test.
- **services/analysis.js + services/metadataCodebook.js**: the lyric-analysis read. Every consumer
  (song page, browse facets, `/search` filters, `themeCounts`, the admin `needs-analysis` queue) reads
  each song's **latest coding pass** — the single newest `song_lyric_analysis` row by `MAX(analyzed_at)`,
  via the shared `LATEST_ANALYSIS` fragment (`DISTINCT ON (song_id) … ORDER BY analyzed_at DESC …`).
  **There is no hard-coded model string anywhere** — the old two-tier `CODE_MODEL`/`SCALAR_MODEL`/
  `ANY_TIER_SQL` constants were deleted (2026-07-25); selection is purely by recency. **Contract:** each
  pass must be written as one *complete* row per song, or a partial newer row would override a richer one.
  The song page **codebook-gates** thematic codes and scalars so it shows exactly what the browse filters
  count. The top summary comes from the `lyric_summary` column (exposed as `summary`); `hasAnalysisExists`/
  `hasCodesExists` are the shared has-analysis/has-codes EXISTS helpers. `metadataCodebook.js` is pure (no
  DB) and owns `data/master_metadata_codebook.json` — labels, definitions, the hidden absence codes, and
  the scalar filter clauses (the `target_audience` heading is **"Speaking to"**)
- **services/acousticCodebook.js + services/audioAnalysis.js** (Step B, 2026-11-22 — the site reads the analysis project's
  **`song_audio_analysis`** table; the Spotify-era audio features and the first six-dimension acoustic analysis are gone, and
  `backend/test/legacyAudio.test.js` fails if a retired name creeps back into routes/services/utils/frontend source).
  `acousticCodebook` is pure over `data/acoustic_codebook.json` (**the analysis project's file, mirrored by its export; never
  hand-edit**): eight dimensions — `musical_mood`, `vocal_style`, `instrumentation`, `audio_samples` are multi-value (TEXT[]),
  `sonic_intensity`, `production_texture`, `rhythmic_feel`, `dynamic_arc` single — plus objective metrics (tempo, key, loudness).
  Exports `DIMENSIONS` (page order; `production_texture` is headed **Production** on the site via one `HEADINGS` constant, the
  codebook calls it "Sound"), `SAMPLES`, `FILTER_KEYS`, `SINGLE_KEYS`, `COLOUR_KEYS` (single AND <= 7 codes: the palette limit),
  `selectionClauses` (multi `&&`, single `= ANY`; OR within a dimension, AND across), `cleanSelection` (hidden codes such as
  `NONE` and invented codes are dropped), `objectiveMetrics`. `audioAnalysis` owns every read: **a song's audio is its OK row
  with the latest `analyzed_at`** (`LATEST_AUDIO`, alias `sau`; a newer non-OK row never hides an older OK one), `getSongAudio`
  (public block on `GET /api/analysis/song/:id` as `audio`), `getAdminAudio` (the curator's view), `audioFacets` (exclude-self
  sidebar counts, group `audio:<key>`), `tempoRange` (UNMETERED tempo is hidden; key is an *estimate*), `coverage`,
  `MOOD_SUBQUERY` / `attachMood` (cards carry `mood` = the first-listed `musical_mood` label), `SAMPLES_PENDING_SQL`, `BROKEN_VIDEO_SQL` (the **Broken video** rail: an `UNAVAILABLE` row, no `OK` row from any model, a video still on the song, none added after the failed analysis - so adding a replacement link clears the song, and the analysis-owned row is never written here; a song with no video left is Needs video's). **Timeline (2026-11-22):** the single-song reads (`getSongAudio` / `getAdminAudio`, never a list/map query) also carry `timeline` (`cleanTimeline`: the analysis' 80-bin `audio_timeline` v1, loudness/grit/pulse in 0..1, anything malformed dropped whole), `sections` (`parseSections`: `sonic_evidence` lines as `{startSec,endSec,label,text}`, untimed lines kept as notes) and, on approved samples, `startSec`/`endSec` (`parseRange`) plus `confidence`; a sample's `source` is named **only at `identification_confidence = 'HIGH'`** (otherwise the name is not in the payload). Frontend: `AudioTimeline.jsx` (canvas, `timelineDraw.js`, pure `utils/timelineModel.js`) is the full-width **Through the song** card at the top of Song analysis (and in the admin Audio panel, ungated); its toggles are the legend; a click pins the cursor (`timelineModel.pressBin` / `activeBinOf`: hover is ignored while pinned, the same spot unpins); the page deliberately shows no section text and no clip descriptions (the server still serves `sections` and `description`, unused by the page); colours are `--tl-*` in `components.css`, validated with the dataviz `validate_palette.js` (dark only).
  **The samples gate:** `songs.show_audio_samples` (migration 021; NULL unreviewed = hidden, TRUE show, FALSE reviewed-hidden).
  **The server withholds** sample details, types, the `audio_samples` filter membership and reference counts unless TRUE —
  never trust the page to hide them. **Curator-saved sample sources (2026-11-23, migration 023):** the web-owned `song_sample_sources` table (PK song, sample type, timestamp as the analysis wrote it) holds a curator-named source; `buildSamples` overlays it (`source` + `confirmed: true`, beats the HIGH rule) so the page, timeline and admin panel agree; the admin read also carries `suggested` (the analysis' non-HIGH guess) and `samples.orphans` (saved sources whose timestamp no longer matches after a re-run) and **the public block never carries either**. Writer `curation.setSampleSource` (`PUT /api/admin/workbench/:id/sample-source`; blank clears, and clearing skips the "sample exists" check so orphans can be removed); `analysis` tables are never written. Test `test/sampleSources.test.js` (sentinel `ZZZSMS`). The curator decides in the workbench **Audio** panel (`PUT /api/admin/workbench/:id/audio-samples`,
  `curation.setAudioSamples`, returns the reassembled workbench) and the **Needs sample approval** rail lists included songs with
  real samples and no decision. The song page's **The Sound** (`TheSound.jsx`, pure layout and `hasSoundContent` in `utils/soundLayout.js`; the right half of **Song analysis**, beside **The Lyrics** in `LyricalAnalysis.jsx`, each opening with its own "In short")
  replaced "In the sound". `facetSql.js` holds the shared constraint/count helpers (`unpackConstraint`, `countByCode`)
- **Language + draft-transcript review** (in `services/curation.js`, 2026-11-22): the analysis project's detected languages and AI audio transcripts reach the curator as **suggestions only** - it never writes `songs.language` or `song_lyrics`. `getWorkbench` carries `language_suggestions` (latest `song_lyric_analysis` row with `detected_languages`, then the OK `song_audio_transcripts` row; `differs` vs a recorded language, case/order ignored) and `draft_transcript` (**a draft is an `OK` or `UNINTELLIGIBLE` transcript with text, newest row, and only while the song has no real lyrics**; it carries `status`, `tier` (UNINTELLIGIBLE when the status says so, else `confidence`), `confidence_score`, `estimated_word_accuracy_pct`, `audio_clarity`, `inaudible_segments` and `confidence_notes`, nulls kept; language suggestions still read OK rows only). The `check-transcripts` queue takes `sort` (`best` | `worst`) and `tier` (HIGH | MEDIUM | LOW | UNINTELLIGIBLE), valid for that queue only (else `BAD_QUEUE`); `best` orders by tier rank, then `confidence_score` (an unscored row uses its tier midpoint), then id, `worst` reverses the first two, no `sort` is by id; its rows carry only a `transcript` object of the six scalar fields, never the text or notes. **Reject draft:** `curation.setDraftRejected` (`PUT /api/admin/workbench/:id/draft-rejected`, explicit `rejected` boolean) stamps the web-owned `songs.transcript_rejected_at` (migration 027); `DRAFT_LIVE_SQL` hides a rejected draft from `HAS_DRAFT_SQL`, the queue join and `draftTranscript` until a newer `transcribed_at` arrives (the song stays in Needs lyrics). Frontend: `utils/transcriptConfidence.js` (pure, node-tested badge/pill/score text; the rail shows only `scoreText`, with `detailText` as its tooltip), `utils/songsBackLink.js` (Back to Songs returns to the originating rail), the sort and tier selects in `SongQueueList`, badge, pills, note and warning in `DraftTranscript`. `chooseLanguage` (`PUT /api/admin/workbench/:id/language-choice`) takes only a source name (`analysis` | `transcript`), reads the languages server-side and replaces `songs.language`; a draft becomes lyrics only when the curator edits it and saves through the existing `saveLyrics` (`DraftTranscript.jsx`, source 'AI transcript, curator-checked'). Rails `language-suggested` (subset of `needs-language`) and `check-transcripts` (subset of `needs-lyrics`). **`song_audio_transcripts.transcript` is LOCAL / ADMIN ONLY: only `services/curation.js` may reference the table** (`lyrics_privacy.test.js` scans routes, services and utils); the web app never writes it, including its `promoted_to_lyrics` column. `lyricsQuality` gained the `placeholder` junk kind (whole-text match: 'NA', '[object Object]', ...; migration 022). Tests `test/languageCapture.test.js` (sentinel `ZZZLNC`).
- **services/explore.js**: the read-only consumer of `song_coordinates` + `song_embeddings` behind the
  Explore map and the song page's "You might also like". Two halves. **The map:** space discovery is
  *data-driven* — it reads whichever `*_2d` columns the catalogue holds, so a space the pipeline adds
  appears with no code change — with **one named exception, `HIDDEN_SPACES`** (currently `semantic`, dropped
  at the curator's 2026-08-02 smoke); un-hiding is deleting a word from that set. Each space also carries a
  short `description` saying what it was built from (`SPACE_DESCRIPTIONS`; unknown spaces serve `null` and
  the page renders nothing). `mapPayload` serves spaces, colour-by legends, coverage and all 640
  points in **one** response (~393KB), which is why switching space/colour/spotlight/search costs no
  further request. **Both the `space` and `colour` URL params are validated against what the catalogue
  actually serves** — a stale shared link falls back to the default rather than drawing an empty or all-grey
  map. Colour-by is a curated low-cardinality menu. **Genre names every value but colours only
  the top 3**: a song carries its *raw* parent genre, while the legend gives slots 1–3 to the top three by
  count and lists every remaining genre as a named `child` of an "Other genres" group that **shares slot 4**
  — so a 1-song genre is visible and individually spotlightable without a colour of its own. That split
  was designed when **four simultaneous categorical colours was the measured ceiling** (the `dataviz` skill's
  documented 8 hues score 9.8 for 5 colours on the all-pairs normal-vision gate against a floor of 15). On
  2026-10-01 the palette was replaced by a **searched 7-colour set that passes every gate in both modes** (worst
  CVD 9.5, normal 18.3; `components.css` holds the values and validator command) so every colour-by legend keeps all its codes (the audio colour-by menu is `acoustic.COLOUR_KEYS`: Intensity, Production,
  Dynamics; the default is Intensity; Not coded is neutral grey and takes no palette slot); genre keeps the top-3 + Other split, now a choice and not a
  limit. The top-N set
  is computed **once** and shared by the legend builder and the colour assignment, so a point can never carry
  a bucket its own legend doesn't explain. Spotlight state holds raw codes, and a group toggle is tri-state
  (`aria-pressed="mixed"` when only some members are lit). **Similarity is a REGISTRY, not discovery** (`SIMILARITY`) — coordinates are
  interchangeable, but each embedding needs a metric and a normalisation judgement code must not guess:
  `message` is cosine over the 1188-dim **`lyric_hybrid_embedding`** (qualitative codes + centred BGE-M3, the same vector as the Thematic space; `dims: 1188` is enforced like the sound tab's; the older mixed-width `lyric_embedding` is ignored), `sound` is cosine over the 574-dim
  **`audio_hybrid_embedding`** (Step B replaced the z-scored 6-dim `audio_embedding`, which is ignored now; `dims: 574` is enforced
  on the target AND every candidate in `cosineSql`, so a vector of any other length never enters a comparison). A tab is omitted when its embedding is missing; only when no tab
  has anything does the honest **"More in this genre"** fallback fire (692 of 1,333 live songs, 52%, have
  no embeddings). Read-only — never writes to any analysis table. **3D (explorer round 1, 2026-11-06):**
  `discoverSpaces` also pairs each `*_2d` column with its `*_3d` sibling (`column3dFor`; `has3d` per space in the
  payload) and `mapPayload` serves `songs[i].coords3[space]`, each space's cloud normalised once on the server by
  the pure `normaliseCloud` (centre on the bbox midpoint, divide by the largest half-span x 1.15, so it lies in
  [-1,1]^3 with uniform scale; degenerate clouds collapse to the origin). **Theme colour-by:** four more
  `COLOUR_DIMENSIONS` (`themes`, `targets`, `actions`, `moral_frames`, `source: 'theme'`, columns `themes` / `topics` /
  `advocacy` / `moral_frames`; **never `tactics`**, a mirror of advocacy) colour a song by its **sub-dimension with the
  most distinct codes** (`themeSubCounts` + `themeBucket`; a tie goes to the sub-dimension **fewer songs touch**, then taxonomy order, so there is no Mixed bucket; no finding is `NOT_CODED`). The single
  colour bucket is in `codes[key]`; the full set of touched sub-dimensions rides in `subs[key]` so a spotlight lights
  every song that touches a lit sub-dimension (`songPassesSpotlight` on the frontend). Legends are sub-dimensions in
  taxonomy order, then Not coded (<= 5 entries, inside the 7 palette slots), with a usage `note` under the legend (a pick lights every song that touches it, so more dots can light than the count shows).
  **Cluster labels (Round 2):** `services/exploreRegions.js` is the pure labeller - `kmeans` (no random source: farthest-point start, then Lloyd, lowest index wins ties) and `buildRegionLabels` and `buildTieredLabels` (a coarse level of `REGION_K = 8` regions, level 1, plus a finer `FINE_K = 24` cut, level 2, minus any fine label repeating a coarse one's text; the map only offers level 2 once zoomed in, so zooming reveals more), which names each region (the curator found 12 too many; regions under 15 songs are unlabelled) by what is **over-represented** there (term count x ln(lift); thresholds are exported constants; the most distinctive theme code across all four columns, plus the most distinctive parent genre, joined by " · "; two regions with identical text keep the larger). `explore.js` `labelItems` / `labelsFor` run it per space on the raw 2D column and on the already-normalised 3D cloud, and `mapPayload` serves `spaces[i].labels2d` / `labels3d` (`{label, centre, count}`; 3D is `[]` for a 2D-only space). No per-song code lists reach the payload. Naming is automatic and subjective by design: tune the constants, not the callers
- **services/referenceCodebook.js**: the read behind the About section's Reference tab
  (`GET /api/analysis/codebook`). **Composes** `metadataCodebook.js`, `acousticCodebook.js` and the
  taxonomy rather than re-reading their JSON, so label rules and suppression stay owned in one place
  each. Deliberately a **different** shape from `analysis.facetTree`: the facet tree drops any code
  with a zero count and carries no definition (right for a filter sidebar), while the reference lists
  **all 107 thematic terms including zero-count ones**, all 6 lyric-metadata components and the audio
  dimensions (7 + the sample types, each code with its listener description and the AI definition, plus a "Measured by
  software" `objective` list) — a term nobody's song currently carries is itself information on a glossary
  page. **Audio counts come from `audioAnalysis.audioFacets`**, the same function as the browse sidebar, so they agree by
  construction and the sample counts honour the approval gate; `coverage.audio` carries the sound analysis' own coverage
  (explainer tokens `audioAnalysed`, `audioAnalysedPct`, `audioModels`, `audioDate`).
  Thematic and metadata counts are **10 count queries**, **plus 5 coverage queries**, all reusing the shared
  `LATEST_ANALYSIS` fragment and the `status='included' AND published=true` gate, exactly like every
  other public read — this is
  the one invariant a future change here must not drift from, or the reference page will disagree
  with the browse sidebar. The response also carries a `coverage` block (live-song/artist/analysed/
  mapped counts, plus the latest coding pass's models and date) that both the Reference tab and the
  explainer's `{{tokens}}` read
- **`backend/data/{about,analysis}.md`**: **curator-editable copy served live** by
  `GET /api/content/:slug` — edit the file, refresh the browser, no rebuild needed. Both ship with a
  complete first draft; the curator's prose replaces the drafted text in place. Live figures reach the
  prose as `{{tokens}}` (`frontend/src/utils/contentTokens.js`'s `substituteTokens`, pure/DOM-free/
  node-tested) — `{{songs}}`, `{{artists}}`, `{{analysed}}`, `{{analysedPct}}`, `{{mapped}}`,
  `{{codingModels}}`, `{{codingDate}}` — so the sentence stays under curator control while the number
  in it tracks the live data. An **unrecognised token renders as itself** rather than vanishing, which
  is what makes a typo visible. The same two files are also imported at build time via Vite's `?raw`
  as a **bundled fallback** (one file in git, not two, so it can't drift from the live copy) — a
  build-time snapshot that goes stale until the next build if the curator edits after deploying, which
  is correct: the fallback exists for an unreachable API, not for freshness
- **database/db.js**: PostgreSQL connection pool; **database/schema.sql** + 6 add-on SQL files
- **scripts/**: 4 documented maintenance scripts (see `backend/scripts/README.md`);
  the ~37 one-off scripts were deleted in Session 2.3 (git history preserves them)
- **utils/genreMapping.js**: parent-genre mapping used by admin + search. The hierarchy lives in
  `backend/data/genre_hierarchy.json` (shared with the analysis project, which reads the same file): every subgenre under exactly
  one of 17 parents (test-enforced), `getParentGenre` resolves a bare parent to itself and anything unknown to `other`. `songs.genre_source`
  (migration 019: `manual` | `spotify_artist` | `audio_gemini` | `audio_local_mir`, NULL = legacy/unknown, no CHECK) records who set a song's genre; only
  curator writes stamp it. **Genre choice (Step A, migration 020 adds `song_audio_analysis`, written by the analysis project, read-only here):** `curation.chooseGenre`
  (`PUT /api/admin/workbench/:id/genre-choice`) takes only a source name (`artist` | `audio` + model | `keep`) and **reads the genre on the server**; the
  workbench `audio_genres` list and the `genre-from-audio` / `genre-conflicts` queues (the latter judged by parent only, NULL `genre_source` only, filterable by
  `pair`, `GET /curation/genre-conflict-pairs`) read `song_audio_analysis` OK rows. `genres.parentSql` is `getParentGenre` as SQL, generated from the same JSON **No other copy of the hierarchy may exist:** the artist filter counts/filter (`services/genres.artistParentCounts` / `genresForParents`, used by `routes/spotify.js`) go through `getParentGenre`, and the frontend (`ArtistSearchAndFilter.jsx`, `SongCard.jsx` via `utils/genreHierarchy.js`) imports the same JSON. **A song's displayed genre is the browse filter's effective genre** (own genre, else its primary artist's first): `genres.EFFECTIVE_GENRE_SUBQUERY` (a join-free twin of `EFFECTIVE_GENRE_EXPR`; keep them in step) is served as `genre` by the song page, `/search`, `/songs/featured` and playlist reads; the song page's hero shows a Genre cell and the card its parent + genre tag from it
- **utils/playlistSync.js**: truth-source-safe Spotify helpers (import-only playlist diff,
  add-as-pending, album/artist upserts) shared by `scripts/enrichFromSpotify.js` and the
  admin sync endpoints

### Frontend Structure (`frontend/`)
- **src/App.jsx** (~50 lines): router shell only — routes, header/nav, footer
- **src/pages/**: one file per route — HomePage, SongDetailPage, PlaylistsPage,
  PlaylistDetailPage, **ExplorePage** (a tab shell over `/explore` = Map and
  `/explore/data` = **`DataPage`**, the Data area (below); **the standalone Dashboard nav item is retired and
  `/dashboard` redirects to `/explore/data`**), **AboutPage** (triage 6 — became a second tab
  shell mirroring `ExplorePage`'s pattern, `NavLink` × 3 + `Outlet`, over three routes:
  `/about` → `pages/about/AboutOverview.jsx`, `/about/analysis` →
  `pages/about/AnalysisExplainer.jsx` ("How the analysis works" — the AI-disclosure explainer),
  `/about/reference` → `pages/about/AnalysisReference.jsx` (the 107-term/7-component/6-dimension
  glossary, one scroll with a sticky jump nav, each term's count linking through to a filtered
  browse via `termHref` on `utils/browseUrlState.js` — a zero-count term's count renders as plain
  text instead, since a link to an empty result set is a dead end). `/about` keeps working exactly
  as before, so no existing link breaks. All three consume `pages/about/useCodebook.js`, a small
  hook fetching `GET /api/analysis/codebook` once and sharing it across the tabs. Single-consumer
  helpers stay local to their page file
- **src/components/**: components (public + admin; the **Artists area** - `ArtistsArea` + `ArtistQueueList` (rail and list, `/admin/artists?queue=&q=&page=`) and `ArtistWorkbench` (`/admin/artist/:id`, redesign slice 1, 2026-11-27: a loader plus a keyed `WorkbenchBody` with an editable name header, a red **Needs you** banner from `utils/workbenchView.js` `bannerItems` (shared MusicBrainz id -> Review merge; `match.wrong_identity` -> Check match), **Details | Catalogue** tabs (`?tab=catalogue`; only the active tab is mounted), section 1 `IdentitySection` (Spotify / Bandcamp / MusicBrainz as `IdentifyPanel` table rows with `MatchStep` under MusicBrainz via `renderAfterRow`, Website, Merge entry), a Mark artist done footer, and `MergeDialog`; `useEnrichmentReview` holds the one copy of the staged review shared by banner, match step, rows and footer (its `act` takes a `scope` so the match step and rows show their own errors); `ArtistLinksPanel` is gone; the bio/notes, the **`EnrichmentPanel`** (piece 2: the analysis project's proposed match and facts, reviewed row by row; reached from the rail's Enrichment group, see `services/artistEnrichment.js`)); `QueueRail` takes a `groups` prop so both areas share it; **SpotifySyncCard** on the Dashboard and **SpotifyLists**, the Songs > Spotify sync view) — public (SearchAndFilter,
  ArtistSearchResults, ArtistDetailPage, SongSubmissionForm, MoodBadge,
  YouTubeEmbed, **SimilarSongs** (the song page's two embedding tabs + genre fallback), the **Data area** (`pages/DataPage.jsx` + `components/explore/data/`: `useDataset` fetches the payload ONCE; the slice (parent genre `pg`, year window `yf`/`yt`, Over-time toggles `era_m`/`era_b`) lives in the URL via the pure `utils/dataUrlState.js`; the pure, node-tested `dataModel.js` does every aggregation (filter, KPIs, era series with colours following the entity's slot in a fixed whole-catalogue order, tone by decade with `MIN_POINT_N = 10` and `MIN_GROUP_FOR_SENTENCE = 30` thresholds); `ChartFrame` (card + Table view + denominator caption), `EraChart` (stacked bars)/`LineChart` hand-rolled SVG at the container's measured width, tokens only; sub-tabs are real routes `/explore/data/<tab>` and a tab appears only once built - **phase 1 = Over time**; spec `docs/superpowers/specs/2026-11-22-explore-data-redesign-design.md`, plan `docs/superpowers/plans/2026-11-22-explore-data-phase1.md`; `chart.js` / `react-chartjs-2` and `DataDashboard.jsx` are gone), plus
  **`components/explore/`** — `ExploreMap` (hand-rolled canvas scatter, **no charting
  dependency**), `exploreUrlState.js` (every `derive*`/`format*` that reads or writes the map's URL
  params — space, colour, spotlight, search, selection, and the `view=k,tx,ty` viewport — pulled
  into one pure, DOM-free module because the B4 final review found three separate URL-state
  defects all living in one unextracted block of `ExploreMap.jsx`; being pure lets `node --test`
  exercise it directly with no frontend test runner), `mapGeometry.js` (pure fit/zoom/pan geometry
  — `layout()`, `clampView`, `zoomAtPoint`, `FIT_VIEW`, `MIN_K` (0.5: the map zooms out past fit)/`MAX_K` — shared by the gesture
  hook and the draw loop so the maths that moves the map and the maths that draws it can never
  disagree; also pure and node-tested), `useMapTransform.js` (the gesture hook: a non-passive
  wheel listener zooming toward the cursor, drag-pan with a 4px click-vs-drag threshold, the
  `+`/`−`/Reset buttons, and a 300ms debounced URL commit — kept out of `ExploreMap.jsx` because
  it is imperative pointer/wheel-event plumbing, not rendering), `SelectedSongCard`,
  `useExplorePoints`, the **3D view** (`camera3d.js` pure perspective maths - projection, presets, interpolation,
  depth cues, gizmo, depth-aware `pickPoint`, zoom scales the focal length not the camera distance;
  `useOrbitCamera.js` the gesture/drift hook, left-drag does what the toolbar's Rotate | Pan switch says (`camera3d.dragModeFor`; Shift or right button does the other), arrow keys orbit;
  `MapToolbar.jsx` the floating 2D|3D pill with the camera pill (Rotate | Pan, Drift) stacked under it in 3D; URL params `dim=3d` and
  `cam=<preset>|yaw,pitch,zoom,panX,panY`, both falling back to the default view when invalid, and `dim=3d` falling
  back to 2D for a space with no 3D data; default view stays 2D), **Round 2:** `mapLabels.js` (pure `placeLabels`: level 1 beats level 2, then larger regions win collisions; `labelsAtZoom` offers level 2 from `FINE_ZOOM = 1.6`; `truncateLabel`), `neighbours.js` (`nearestSongs` in the map's OWN coordinates, not embedding similarity) and `walk.js` (`walkBase`/`walkNext`/`walkBack`: the path is component state and only counts while its last element is the selected song), `YearStrip.jsx` (a two-handle year range, `yf` start + `yr` end, with Play sweeping the end handle from the start up to where it was; `PAN_SLACK = 0.3` in `mapGeometry.js` lets the 2D map be pushed 30% past the plot edge so dots can clear the overlays; `exploreUrlState.js` `yearBounds`/`deriveYear`/`formatYear`/`yearState`, `deriveFlag`), new URL params `yr=<year>` (end; absent = open) and `yf=<year>` (start; absent = from the first year), `labels=0`, `lines=0`; `mapGeometry.js` gained `projectPoint` (a label centre projects exactly like a dot), `outsideCore`, `viewCentredOn` and `camera3d.js` `panCentredOn` for the walk, and both camera hooks export an eased `moveTo`, `palette.js` (categorical colours live in
  CSS as `--explore-cat-*` so theming stays in the token layer; JS only reads them) — plus the
  shared NavigationMenu, SongCard, PaginationControls) and admin
  (AdminInterface is a
  login + tab-nav shell over ManageSongsTab, ManagePlaylistsTab and the 8 other tab
  components; `CategorizationFields` is the one categorisation form shared by Manage
  Songs and Bulk Categorization). Song intake lives in the Staging tab
  (Add candidates); Spotify sync (Pull / Push / Refresh, with its five lists under Songs > Spotify sync) lives in the Dashboard
  card; queue rows carry an `origin` tag ("From Spotify" / "From submit form"); Duplicate Manager is
  data-quality only. **Two shared presentation primitives:** `FilterSection` — every
  browse-sidebar group is one, so they all collapse identically; it nests, which is how the
  five theme dimensions, six metadata components and eight audio dimensions read as the
  same unit. `ScalarFacetGroups` is generic over `{key: {heading, options}}` and renders both
  the "Lyric metadata" and the "Sound" (`audio_facets`) families — don't fork it for a third. Its `note` is
  **usage help only** (caveats, what the options mean): the curator twice rejected
  definitional copy in the sidebar, so "what this filter is" text belongs on the About
  pages, not here — the API serves it (`scalarFacets`/`facetTree` `description`) but the
  browse UI deliberately ignores it. `InfoTip` — the tooltip used instead of the native
  `title` attribute (which waits ~1s and can't be styled); wraps its trigger, no icon
  variant (icons were removed as clutter). Use it for any new hover help. **A third, from triage 6:
  `MarkdownPage`** — fetches `GET /api/content/:slug`, substitutes `{{tokens}}` via
  `utils/contentTokens.js`, then renders with `react-markdown` + `remark-gfm` (the project's first
  new frontend dependency in a long while — a deliberate exception to the avoid-a-dependency habit
  formed against the *charting* library the Explore scatter hand-rolls instead of importing; a
  Markdown parser is a different problem, correctness-critical and thoroughly solved, where a
  hand-rolled subset fails by *silently* rendering a construct as literal text). On fetch failure it
  falls back to the matching `backend/data/*.md` file bundled at build time via Vite's `?raw`, with
  no visible error UI — a visitor should never see the site's own plumbing. `react-markdown` escapes
  raw HTML by default and no raw-HTML plugin is added; that default is load-bearing, since the
  Markdown arrives over HTTP from a file on disk. **Public playlists are read-only (browse-only)** — Session 3.3
  deleted `AddToPlaylistModal` and the create/remove-song UI (curator decision, no auth
  story yet); the backend playlist routes are untouched and still serve the admin
  Manage Playlists tab. Playlist creation returns to the public site in Phase 4+ once
  there's real auth
- **Arguments (frontend, Data phase 2, 2026-11-22)**: `/explore/data/arguments` (tab after Over time, inside `SliceLayout`, so the slice bar applies; the slice query string is carried between Over time and Arguments only, Stories carry none) = `ArgumentsTab` over the one dataset payload. Pure `flowModel.js` (`PRESETS` = Genre/tone/action, Audience/frame/action, Voice/tone/emotion; `buildFlow` keeps the top 6 nodes per column and folds the rest into an **Other** node identified by its `other: true` flag, never by key, because its key becomes `_other` when a real parent genre `other` is also a node (the real one is then labelled "Other genre"); `firstOrderFor` is the column-0 colour order (the genre preset uses `genreRanking` over ALL songs, so a genre keeps one colour across Over time and Arguments); `flowEmptyMessage` / `MIN_FLOW_N` (10): a flow with fewer eligible songs shows a "Too few songs" message, no chart or sentence; `strongestSentence`, `topPathways`, `flowTable`, `topThemePairs`, `pairsTable`, `flowLayout` (ribbons attach ordered by the counterpart node position), `browseSelectionFor`) and `dataUrlState.js` (`flow` param, default omitted, unknown id falls back; `FLOW_IDS`; `browseHref(state, bounds, extra)`). UI: `FlowChart` (hand-rolled SVG; colour on the first column only, via `--explore-cat-1..6`, Other grey with `--explore-not-coded`; the first column's ribbons take its colours and ribbons between the second and third columns are neutral grey; a node outside the whole-catalogue top six borrows the next free colour slot; hover fades, click/Enter pins), `PathwayList` (the phone width replaces the ribbons), `FlowDetail` (pinned count/share/Browse link plus an always-mounted live region), `ThemePairs` ("Themes that travel together"), `flowPin.js`; CSS `data-arg-*` in `components.css`. **Browse links:** Browse ANDs individual codes within a dimension (`analysis.facetSelectionClauses`), so a link counts songs carrying the code ANYWHERE on the song, not only as its first-listed one (Browse can list more than the first-listed count); for a Genre pick Browse matches catalogue genres only, while the flow's genre includes audio-inferred genres (Browse can list fewer); the detail note says both, and the Themes link note says "carrying both themes anywhere on the song". An Other node or a ribbon touching one has no link. Tests `flowModel.test.js`, `dataUrlState.test.js`.
- **Stories (frontend)**: `/explore/data` redirects to `/explore/data/stories`; `pages/StoriesIndex.jsx` (cards with the cover art), `pages/StoryPage.jsx` (fetches the story, computes colour slots once, renders blocks) and the panels in `components/explore/data/story/` (`Reveal`/`useSeen` = IntersectionObserver fade-and-rise that falls back to visible when the observer is missing or `prefers-reduced-motion` is set and only hides content while `.is-pending`; `Prose` = react-markdown inside a Reveal; `OpeningPanel`, `DecadeBarsPanel`, `DecadeLinesPanel`, `SongsPanel`, `ClosingPanel`; pure `storyModel.js` + test: `barRows`, `chartTable`, `linesDomain`, `colourSlots`/`colourVar` so a code keeps one colour across the whole story). `DataPage` is only the tab row; **`pages/SliceLayout.jsx` owns the dataset fetch, the slice and the slice bar and wraps `over-time` and `arguments`** (stories are a fixed argument over the whole catalogue, so no slice bar). `story-*` CSS in `components.css`; every chart keeps its Table view and denominator caption.
- **src/api/**: `spotifyService.js`, `playlistService.js`, and `adminApi.js` —
  admin code must fetch via `adminFetch` (relative `/api` URLs through the Vite proxy +
  `X-Admin-Password` header), never hardcode `localhost:5000` or the header
- **src/styles/**: the design system (Session 3.1, from the brand kit) —
  `tokens/{colors,typography,spacing}.css` (oklch warm-dark palette, Ember/Moss accents,
  Manrope/Public Sans), `base.css` (global element styles), `components.css` (core
  component classes; imported **after** `App.css` in `App.jsx` so it wins the cascade).
  New/updated styling must use the `--bg-*`/`--text-*`/`--accent-*`/`--space-*` tokens,
  never raw colors. `App.css` is the legacy monolith: its `:root` is a bridge re-pointing
  old variable names at the tokens; its page blocks are deleted (with their bridge
  entries) as Sessions 3.2/3.3 restyle each page
- See [`docs/FEATURE_INVENTORY.md`](docs/FEATURE_INVENTORY.md) for the full screen/endpoint
  audit with keep/rebuild/drop/defer decisions

### Database Schema
- **Core tables**: songs, artists, albums with many-to-many relationships
- **Truth source**: `songs.status` (`pending`/`included`/`rejected`) is curator-owned; the
  orthogonal `songs.published` flag marks included songs as ready-to-show (curator clicks
  Publish — never automatic). Every public route filters
  `status='included' AND published=true` and LEFT JOINs albums (non-Spotify songs have no
  album row). See `docs/TRUTH_SOURCE_DESIGN.md` + `docs/PUBLICATION_STAGING_DESIGN.md`.
  Migrations live in `backend/database/migrations/`
- **`song_lyrics` is LOCAL ONLY** (copyright): full lyrics for analysis; never SELECT it from
  an API route, never commit it (`backups/` and `backend/logs/` are gitignored), and exclude
  it from production dumps (`pg_dump --exclude-table-data=song_lyrics`)
- **Analysis-service tables** (written by the curator's separate analysis project; the web app is a
  **read-only** consumer): `song_lyric_analysis` (see `services/analysis.js`), `song_embeddings`
  (`lyric_embedding` 768-dim `float8[]`; `audio_hybrid_embedding` — **574-dim, the only audio vector the site reads; the legacy
  `audio_embedding` column (6-dim on some rows, 1024-dim on others) is ignored, and any distance query must constrain
  `array_length(audio_hybrid_embedding,1)=574`**), `song_audio_analysis` (the audio analysis, PK `song_id, model_used`,
  `audio_status` OK / UNAVAILABLE / TOO_LONG / ERROR / PENDING; see `services/audioAnalysis.js`), and
  `song_coordinates` (one row per song; eight `float8[]` UMAP projections —
  `{semantic,thematic,audio,holistic}_{2d,3d}`). Only ~640 live songs have coordinates/embeddings, and
  some rows belong to unpublished songs, so **public reads must still filter
  `status='included' AND published=true`**. No `pgvector` is installed — similarity is a multi-array
  `unnest` cosine/distance in SQL (measured median **224ms**, so no cache was built). All three tables are
  read through `services/explore.js` via `GET /api/analysis/explore/points` and
  `GET /api/analysis/songs/:id/similar`. **`frontend/public/vector_space.json` is deleted** (B4): it was
  superseded by `song_coordinates` and was a real publication-staging leak — being a static asset it
  bypassed the publish filter every API route enforces, exposing 22 unpublished + 2 pending songs
- **Categorization**: Flexible TEXT[] arrays for vegan focus, advocacy styles, animal categories
- **User features**: playlists, playlist_songs for user-generated content
- **Spotify integration**: Stores spotify_id, URLs, and metadata — enrichment only,
  import-only sync (pull), plus an add-only user-auth push; never overwrites curatorial fields and never removes playlist tracks

## Key Features

### Spotify Integration
- Uses `spotify-web-api-node` library with client credentials flow for reads; playlist **writes** use the signed-in user's refresh token (see `spotifyAuth`)
- Fetches playlist data, track metadata, artist info, and audio features
- Backend routes: `/api/spotify/playlist/:id`, `/api/spotify/songs/featured`, `/api/spotify/search`

### Database Operations
- PostgreSQL with complex joins for song-artist-album relationships
- Full-text search across songs, artists, and albums
- Pagination support for large datasets
- Random/featured song selection for homepage

### Frontend Features
- React Router for navigation between Browse Songs, Artists, Playlists, About
- Dynamic stats display fetched from database
- Song cards with play buttons and navigation to detail pages
- Responsive design with CSS styling

## Environment Setup

### Required Environment Variables (backend/.env)
```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vegan_playlist
DB_USER=your_pg_user
DB_PASSWORD=your_pg_password
ADMIN_PASSWORD=shared_admin_password
PORT=5000
YOUTUBE_API_KEY=optional_youtube_data_api_v3_key   # workbench "Find videos"; search is disabled when unset
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/api/spotify-auth/callback   # must match a Redirect URI registered in the Spotify dashboard
ADMIN_RETURN_URL=http://localhost:5173/admin   # where the OAuth callback sends the browser afterwards
```

**Note:** `database/db.js` reads the five discrete `DB_*` vars above — there is **no `DATABASE_URL`**
(earlier docs claimed one; scripts that build their own pool must use the `DB_*` vars).

### Development Workflow
1. Start PostgreSQL database
2. Run database schema setup
3. Configure backend environment variables
4. Start backend: `cd backend && npm run dev`
5. Start frontend: `cd frontend && npm run dev`
6. Backend runs on port 5000, frontend on Vite's default port

## Important Notes

- Backend uses PostgreSQL with connection pooling via `pg` library
- Frontend communicates with backend API at `http://localhost:5000/api/spotify`
- Song categorization system uses flexible TEXT[] arrays for multiple values per category
- Spotify API requires client credentials for public playlist access
- Project follows monorepo structure with separate package.json files for frontend/backend