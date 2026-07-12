# Admin Curation Workbench & Lifecycle — Design Spec

_Sub-project **A** of the admin-layer rebuild. Brainstormed 2026-07-12._
_Status: **design approved by curator**, ready for an implementation plan._

---

## 1. Context & problem

The Vegan Playlist's public site (Phases 0–3) is done and branded. The **admin layer** was
deliberately left "light touch" through Phase 3 and has never been designed as a product. It
is 10 tool-named tabs (Manage Songs, Staging, Lyrics Lookup, YouTube Videos, Bulk
Categorization, Duplicate Manager, Artists, Manage Playlists, Submissions, Data Dashboard).

The curator's own words: the admin is **clunky, disjointed, and missing features**. A single
song's information is scattered across many tabs, so adding/curating a song means tab-hopping.
The stakes are real: _"If I can't easily add songs, update their content, and edit things, the
playlist will get stagnant because I won't continue to add to it."_ The admin is the heart of
the operation.

### The curator's target workflow (website-first, lyrics-centric)

1. **Capture** — stumble on a candidate → drop title + artist (+ any details) into an intake →
   it lands in a **To be processed** queue.
2. **Process** (the slow part, **one song at a time**) — find the lyrics, read them, decide
   include / reject / park. If including: capture full lyrics + source URL (+ translation for
   non-English), band/Bandcamp URL, a YouTube video, and a Spotify URL. Non-Spotify songs also
   need an album cover + basic metadata. **Finding lyrics for obscure songs is the bottleneck.**
3. **Analyse** — an **external** process (`song_lyric_analysis`, separate project) reads the
   local lyrics table, codes them, and writes results back to the shared DB. The main app only
   _displays_ that data; it never runs the analysis.
4. **Publish** — the song goes live. **Publishing an incomplete-but-major-features song is
   allowed**, with the gaps tracked in to-do queues.

### Decomposition (this spec is Sub-project A only)

The full admin rebuild is ~6 sub-projects, each with its own spec → plan → build cycle:

| # | Sub-project | Status |
|---|---|---|
| **A** | **Workbench + lifecycle/queues** (all fields captured **manually**) | **this spec** |
| B | Analysis integration (delete mock categorisation; display `song_lyric_analysis`) | later |
| C | Community submissions + moderation (Inbox) | later |
| D | YouTube assist (search + pick best candidate) | later |
| E | Lyrics-search assist (fetch/auto-capture — realistic MVP TBD) | later |
| F | Spotify push (website → Spotify playlist, needs write-auth OAuth) | later |

Deployment + real admin auth remain the old **Phase 4** and wrap around all of it.

**A is the spine everything else plugs into**, and it alone solves the stagnation risk.

---

## 2. Existing schema this builds on (little invention needed)

- **Lifecycle already exists:** `songs.status` (`pending`/`included`/`rejected`) ×
  `songs.published` (+ `published_at`; CHECK: only `included` can be published). `lyrics_status`
  (`found`/`not_found`/`not_searched`).
- **Lyric highlights already exist:** the public song page reads `songs.lyrics_highlights`
  (newline-separated short quotes) + `songs.lyrics_url` + `songs.lyrics_source`. The highlights
  picker just needs to _feed_ that field.
- **Full lyrics are local-only:** `song_lyrics(song_id PK, lyrics, source_url, imported_at)` —
  **never** SELECTed by a public route, never committed, excluded from prod dumps. Copyright.
- **YouTube already supports the picker:** `youtube_videos` allows many rows per song, each
  typed (`official`/`live`/`lyric`/`fan-made`/`other`) with exactly **one `is_primary`**
  (enforced by a partial unique index).
- **Links:** `songs.spotify_url`/`spotify_id`, `songs.bandcamp_url`, `songs.soundcloud_url`;
  artist-level `artists.website_url`.
- **Analysis (for B):** `song_lyric_analysis` (shared DB, composite PK `(song_id, model_used)`,
  default model `gemma4:latest`) + `taxonomy.json` codebook. See
  [`LYRICS_ANALYSIS_INTEGRATION.md`](../../LYRICS_ANALYSIS_INTEGRATION.md).
- **Reusable service:** `backend/services/staging.js` already implements
  include / reject / publish / unpublish / set-play-link / attach-spotify / candidate-intake.

So A is largely **assembling and re-presenting existing data on one screen**, plus a small
amount of new workflow state.

---

## 3. State & queue model (the spine)

**No new status enum.** Catalogue states stay: To be processed = `pending`; Rejected =
`rejected`; Included → _To finalise_ (unpublished) / _Live_ (published).

**Queues are mostly _derived_** from data presence — no storage, always accurate:

| Queue / to-do | Computed from |
|---|---|
| To be processed | `status = 'pending'` |
| Needs lyrics | no `song_lyrics` row (or `lyrics_status <> 'found'`) |
| Needs cover art | no album images |
| Needs a video | no `youtube_videos` row |
| Needs analysis _(B)_ | no `song_lyric_analysis` row for default model |
| To finalise | `status = 'included' AND published = false` |
| Live / All | search over included+published / everything |

**Non-derivable workflow state → a dedicated `song_processing` table** (Section 1 decision,
"Option 2": keep workflow state out of the already-bloated ~51-column `songs` table):

```sql
CREATE TABLE song_processing (
  song_id      INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  snooze_until DATE,                 -- "remind me later"; NULL = not snoozed
  park_reason  VARCHAR(30)           -- NULL, or one of:
     CHECK (park_reason IN ('awaiting_community','needs_transcription','listened_unclear')),
  lyrics_tried JSONB NOT NULL DEFAULT '[]',  -- avenues already exhausted, e.g.
                                             -- ["google","genius","bandcamp","youtube","genre_site"]
  processing_note TEXT,              -- free-text working note
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

These drive two more rail queues: **Awaiting community** (`park_reason='awaiting_community'`)
and **Remind me later** (`snooze_until` set / due). `lyrics_tried` stops the curator
re-searching dead ends; `park_reason='listened_unclear'` is the "can't understand, can't find
lyrics" state that **stays `pending`** (explicitly _not_ included) with its avenues checked off.

**Language & translation storage.** The **language a song is sung in** is catalogue metadata
(public-safe, and it will power future language filtering), so it lives on `songs`. The
**translation** of the lyrics is copyright-sensitive like the lyrics themselves, so it stays in
the **local-only** `song_lyrics` table (never a public route):

```sql
ALTER TABLE songs       ADD COLUMN IF NOT EXISTS language    VARCHAR(40);  -- sung-in language (public)
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS translation TEXT;         -- local-only, copyright
```

---

## 4. The Workbench

**One full-page admin route** (e.g. `/admin/song/:id`), replacing the cramped edit modal. It
is the **same screen for two jobs**: _processing_ a pending song and _editing_ an existing/live
one. This collapses the old Manage Songs modal + Staging To-process + Lyrics + YouTube tabs
into one place.

### Top bar (sticky)
- Title + artist(s); state badges (`pending`/`included`/`rejected` · published?); a **live
  completeness summary** ("Lyrics ✓ · Cover ✓ · Video ✗ · Analysis pending").
- **Context decision buttons:** pending → _Include_ / _Reject_ / _Park_; included → _Publish_ /
  _Unpublish_. **Publish is always allowed, even if incomplete.**
- **‹ Prev / Next ›** within the queue the curator arrived from — work a queue song-by-song
  without returning to the list.

### Panels
1. **Details** — title, artist(s), album, year, duration; **language sung in** (`songs.language`);
   Spotify id/url; for non-Spotify songs, album name + **cover art via pasted URL** (upload
   deferred to Phase 4 — needs image hosting).
2. **Lyrics** (the heart):
   - Full-lyrics paste box → local-only `song_lyrics.lyrics` + **source URL** (`lyrics_url`/`lyrics_source`).
   - **Language** + optional **translation** box (original + translation stored side by side, local-only).
   - `lyrics_status`: found / not found / not searched.
   - **"Avenues tried"** checkboxes (Google · Genius · Bandcamp · YouTube · genre sites) → `song_processing.lyrics_tried`.
   - **Quick-search launcher:** one-click links "search this title+artist on Google / Genius /
     Bandcamp / YouTube" (static URL templates, open in a new tab). _A's honest version of the
     lyrics assist; E adds real fetch/auto-capture._
   - **Park actions:** "No lyrics — remind me later" (sets `snooze_until`) · "Awaiting
     community" · "Needs transcription" (set `park_reason`).
   - **Highlights picker:** after lyrics are present, select passages → saved to
     `songs.lyrics_highlights` (the public "Key lyrics" section).
3. **Video** — existing `youtube_videos` listed with type + a "primary" radio; add by URL, set
   type, choose primary. _(D adds search-and-pick.)_
4. **Play sources / links** — Spotify URL (+ an "on the playlist?" indicator; F adds the push
   button), Bandcamp/website, SoundCloud. Reconciles song-level vs artist-level website so the
   curator doesn't type it twice (show artist-level, allow a song-level override).
5. **Analysis** (read-only) — status stub in A ("analysed ✓ · gemma4" / "pending"); **B** fills
   in the coded dimensions with `taxonomy.json` labels. **No editing in admin, ever** — the
   external process owns this data.
6. **Notes** — `songs.status_notes` + `song_processing.processing_note` + park reason.

### Interaction rules (curator-approved)
- **(a) Saving = autosave-on-blur**, with a clear per-field "saved" indicator. No risk of
  losing a pasted lyric to a forgotten Save button.
- **(b) Reject requires a confirm** (recoverable — the row stays `rejected` — but a stray click
  mid-workbench shouldn't nuke the decision).

### Guardrail
The workbench read endpoint returns **full lyrics** and is therefore **admin-only** (behind the
admin password middleware). No public route may ever return `song_lyrics` content or the
`translation` column. Grep before deploy (existing project rule).

---

## 5. Admin navigation (10 tabs → 5 job-areas)

```
Admin
├── Dashboard        ← landing: queue counts, "Add a song", recent activity
├── Songs            ← THE hub: [queue rail] + [song list] → click → Workbench
│     rail: Inbox · To be processed · Needs lyrics · Needs cover · Needs video ·
│           Needs analysis · Awaiting community · Remind me later · To finalise · Live/All
│     + [ Add a song ] (quick capture: title/artist/details → pending; + bulk Spotify URL intake)
├── Artists          ← re-parented ArtistsManager (untouched)
├── Playlists        ← re-parented ManagePlaylistsTab (untouched)
└── Data quality     ← re-parented DuplicateManager (duplicates + Spotify validation)
```

Everything routes into the Workbench. The queue rail is saved filters over Section 3's model.

**Old → new mapping (nothing lost):**

| Today | Becomes |
|---|---|
| Manage Songs | Songs list + Workbench |
| Staging (To process / finalise / Live / Add) | Songs queues + Add button |
| Lyrics Lookup | Workbench _Lyrics_ panel + "Needs lyrics" queue |
| YouTube Videos | Workbench _Video_ panel + "Needs video" queue |
| Bulk Categorization | **Deleted in B** (it's the mock) |
| Duplicate Manager | Data quality |
| Artists | Artists |
| Manage Playlists | Playlists |
| Submissions | Songs → Inbox queue (moderation built in C) |
| Data Dashboard | Dashboard (landing) |

**Reserved-but-stubbed rail slots:** **Inbox** (moderation = C) and **Needs analysis**
(contents = B) appear in the rail but are stubbed/hidden until their sub-project lands, so the
structure is stable and they "light up" later.

---

## 6. Build scope for A

### Creates
- **DB migrations:** `song_processing` table; `song_lyrics` `+language +translation`.
- **Backend admin API:** derived queue-list endpoints; one "assemble everything for this song"
  workbench read endpoint (admin-only, includes full lyrics); per-panel save endpoints
  (details, lyrics + translation + source, highlights, links, park/snooze, lyrics_tried, add/
  edit/delete YouTube + set primary). **Reuses** `staging.js` for include/reject/publish/
  unpublish/play-link/attach-spotify and the intake for "Add a song".
- **Frontend:** the 5-area nav shell; the **Songs** area (queue rail + list); the full-page
  **Workbench** (all §4 panels, autosave-on-blur, prev/next, completeness checklist,
  reject-confirm, quick-search links, highlights picker); the **Dashboard** landing.

### Deletes now (fully superseded — all covered by Songs/Workbench/Dashboard)
`StagingQueue`, `LyricsLookupManager`, `YouTubeVideoManager`, `ManageSongsTab`'s list + edit
modal, `DataDashboard`, and the old `AdminInterface` tab shell.

### Keeps (re-parented under the new nav, untouched)
`ArtistsManager` → Artists · `ManagePlaylistsTab` → Playlists · `DuplicateManager` → Data quality.

### Explicitly does NOT touch (owned by other sub-projects)
- Mock categorisation — `BulkCategorizationWorkflow` / `CategorizationFields` / the public
  advocacy section stay until **B** deletes them. The new Workbench simply omits the
  categorisation form.
- YouTube _search_ (D — A is add-by-URL). Lyrics _auto-fetch_ (E — A is quick-links + paste).
  Spotify _push_ (F — A shows the URL field + "on playlist?" indicator, no push button). Real
  auth (Phase 4). Cover-art _upload_ (Phase 4 — A is paste-a-URL).

---

## 7. Non-goals / seams left for B–F

- **B (Analysis):** the §4 Analysis panel is a status stub; B swaps in read-only coded
  dimensions from `song_lyric_analysis` + `taxonomy.json`, deletes the mock categorisation, and
  lights up the "Needs analysis" queue.
- **C (Submissions):** the Inbox rail slot + moderation (accept → To be processed / spam);
  the existing `staging.addSubmissionAsPending` bridge is reused.
- **D (YouTube assist):** search-and-pick replaces manual add-by-URL in the Video panel.
- **E (Lyrics assist):** real multi-site fetch/auto-capture replaces quick-search links.
- **F (Spotify push):** a push button next to the Spotify URL field (needs one-time write-auth
  OAuth); reverses today's "add in Spotify then resync" into "website is truth, Spotify mirrors."

---

## 8. Risks & guardrails

- **Dataset protection:** full lyrics + translations are copyright-sensitive and **local-only** —
  admin-only read path, never a public route, excluded from prod dumps, grep before deploy.
- **Reuse over rebuild:** lifecycle logic already exists in `staging.js` — A wires the workbench
  to it rather than reimplementing (avoids divergence).
- **Size:** A is multi-session (roughly: migrations + backend API → Songs IA + list →
  Workbench → Dashboard). The implementation plan will sequence these; each session ends with a
  smoke test per the project workflow.
- **No behaviour regressions on the public site:** A is admin-only; the public routes and the
  reused Artists/Playlists/Duplicate components are untouched.
- **Deletions are UI-only — no data loss (curator condition).** The "deletes now" list removes
  frontend components only. The data they managed (YouTube videos, lyrics, links, publish
  state, completion counts) lives in the DB and is re-surfaced by the Workbench/Songs/Dashboard.
  Each delete session must verify the same data is reachable in the new UI before removing the
  old component.
