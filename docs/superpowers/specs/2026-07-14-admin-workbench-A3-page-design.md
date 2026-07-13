# Admin Curation Workbench — A3: The Workbench Page — Design Spec

_Plan **A3** of Sub-project **A** (admin-layer rebuild). Brainstormed 2026-07-14._
_Status: **design approved by curator**, ready for an implementation plan._

Builds directly on:
- [`2026-07-12-admin-workbench-design.md`](./2026-07-12-admin-workbench-design.md) — the whole-of-A design (§4 specifies every panel, interaction rule, and guardrail).
- **A1** (merged) — every backend endpoint the workbench needs already exists.
- **A2** (merged) — the 5-area nav shell, `adminApi`, the `/admin/song/:id` route (currently `WorkbenchStub`), the Songs area, and the component patterns to match.

---

## 1. Scope

A3 replaces the A2 **stub** at `/admin/song/:id` with the full **Curation Workbench**: one
screen for both _processing_ a pending song and _editing_ an existing/live one. It is the
priority next task because A2 deleted the old `AdminInterface` outright — **per-song editing
(lyrics / publish / include-reject) is unavailable in the new admin until A3 ships.**

A3 is **almost entirely frontend.** No backend changes are expected: A1 shipped the assemble-read,
the per-panel saves, the video endpoints, and the reused lifecycle endpoints. The design is
already settled in the whole-of-A spec §4; this document records the A3-specific decisions the
curator confirmed and the component/data structure.

### Curator-confirmed decisions (2026-07-14 brainstorm)
1. **Layout:** two-column with a sticky top bar; lyrics (the heart) in the wide left column,
   the rest stacked in the right column.
2. **Highlights picker:** interactive — select text in the lyrics box → "Add highlight".
3. **Prev/Next:** within-page neighbours (steps through the ID list of the Songs-list page the
   curator arrived from; stops at page edges).
4. **Deletions:** parity-check + delete the 4 superseded components _in A3_ (not deferred to A4).
5. **Details editing** is limited to what A1 exposes (title + language); album/year/artists are
   read-only. Any real parity gap is flagged, not silently expanded into A3.
6. **"On the Spotify playlist?" indicator** is deferred to sub-project F.

---

## 2. Backend surface consumed (all A1, no changes)

| Purpose | Endpoint |
|---|---|
| Assemble everything (admin-only; full lyrics + `completeness`) | `GET /api/admin/workbench/:id` |
| Save details (title, language, status_notes) | `PUT /api/admin/workbench/:id/details` |
| Save lyrics (lyrics, source_url, translation, lyrics_status, lyrics_url/source) | `PUT /api/admin/workbench/:id/lyrics` |
| Save highlights (`lyrics_highlights`, newline-separated) | `PUT /api/admin/workbench/:id/highlights` |
| Save links (spotify/bandcamp/soundcloud) | `PUT /api/admin/workbench/:id/links` |
| Set cover (paste URL) | `PUT /api/admin/workbench/:id/cover` |
| Save processing (snooze_until, park_reason, lyrics_tried, processing_note) | `PUT /api/admin/workbench/:id/processing` |
| Add / update / set-primary / delete video | `POST /workbench/:id/videos`, `PUT/DELETE /workbench/videos/:videoId`, `PUT .../primary` |
| Lifecycle (reused) | `POST /api/admin/songs/:id/{include,reject,publish,unpublish,attach-spotify}` |

Every per-panel save **returns the reassembled workbench** (`{ success, workbench }`), so the UI
swaps state and the completeness summary refreshes without a second fetch. `include` accepts
`{ publish: true }`. All calls go through `adminFetch` (relative `/api`, `X-Admin-Password`).

---

## 3. Architecture — container + panel components

**Chosen approach (A of three considered):** one container owns the fetch and save orchestration;
each panel is a small focused component. (Rejected: a monolithic 600+-line `Workbench.jsx`;
per-panel self-fetching, which would waste A1's single assemble endpoint and desync the badges.)

### Files (all under `frontend/src/components/admin/`)
- **`Workbench.jsx`** — container. Fetches `GET /workbench/:id` into `wb` state; renders top bar +
  two-column panel grid; exposes a `save(panel, body)` helper that PUTs and swaps `wb` from the
  response. 404 → "Song not found" with a Back link. Wired at the existing `/admin/song/:id` route
  (replaces `WorkbenchStub` in `App.jsx`).
- **`WorkbenchTopBar.jsx`** — badges, completeness summary, decision buttons, Prev/Next.
- **`DetailsPanel.jsx`**, **`LyricsPanel.jsx`** (contains the highlights picker),
  **`VideoPanel.jsx`**, **`LinksPanel.jsx`**, **`AnalysisPanel.jsx`**, **`NotesPanel.jsx`**.
- **`SavedField.jsx`** — shared wrapper rendering the per-field indicator
  (idle / saving / saved ✓ / error). Reused by every autosaving field.
- CSS added to the existing `frontend/src/styles/admin.css` (design tokens only — no raw colors).

### Data flow & autosave (whole-of-A spec §4 rule (a))
- Panels hold local field state seeded from `wb`.
- **Text fields autosave on blur**, only if the value changed; **selects / checkboxes / radios
  save on change.**
- On save the response `workbench` replaces `wb` → the top bar and completeness update.
- `SavedField` shows status inline; a save **error keeps the edited value** and surfaces the
  message (no silent loss — the entire point of autosave-on-blur).

---

## 4. Top bar (sticky)

- **Identity:** title — artist(s); status badges (`pending` / `included` / `rejected` +
  published?); live **completeness summary** ("Lyrics ✓ · Cover ✓ · Video ✗ · Analysis pending")
  from `wb.completeness`.
- **Decision buttons by state:**
  - `pending` → **Include** and **Include & publish** (`POST /include` with `{publish}`),
    **Reject** (confirm dialog — spec rule (b)), **Park ▾** (menu: `awaiting_community` /
    `needs_transcription` / `listened_unclear` + "Remind me later" date → `PUT /processing`).
  - `included` → **Publish** / **Unpublish**. **Publish is always allowed, even if incomplete.**
- **‹ Prev / Next ›:** steps through the ID list of the Songs-list page the curator arrived from,
  passed via React-Router `location.state` (`{ from, ids, index }`) from `SongQueueList`.
  Disabled at the ends; **hidden entirely on a direct / deep link** (no `location.state`).

---

## 5. Panels

1. **Details** — editable **title** + **language sung in** (`PUT /details`). Album name / release
   year / duration / artist(s) / Spotify id shown **read-only** (A1's `saveDetails` exposes only
   title/language/status_notes). Editing album/year/artists is **out of scope for A3**; the
   parity check (§6) confirms the old modal left no real gap, and flags one if it did.
   **Cover art:** shows the current cover (or a placeholder); a **paste-a-URL** field saves via
   `PUT /cover` (upload deferred to Phase 5). Feeds the "Cover" completeness badge and the
   "Needs cover" queue.
2. **Lyrics** (wide left column — the heart):
   - Full-lyrics **paste box** → `PUT /lyrics` (`lyrics` + `source_url`). Local-only.
   - **`lyrics_status`** select (found / not_found / not_searched).
   - **Avenues-tried** checkboxes (Google · Genius · Bandcamp · YouTube · genre sites) →
     `PUT /processing` `lyrics_tried`.
   - **Quick-search launcher:** one-click links (static URL templates for Google / Genius /
     Bandcamp / YouTube, title+artist interpolated, open in a new tab). A's honest lyrics assist;
     E adds real fetch.
   - **Translation** box (local-only, `PUT /lyrics` `translation`).
   - **Highlights picker (interactive):** select text within the lyrics box → **Add highlight**
     appends it to a removable list; the list is saved newline-joined to `lyrics_highlights` via
     `PUT /highlights` (feeds the public "Key lyrics" section).
3. **Video** — lists `wb.videos` with a **type** label and a **primary** radio
   (`PUT .../primary`); **add by pasted URL** (parse the 11-char YouTube id client-side) with a
   type select (`POST /videos`); **delete** (`DELETE`). One-primary invariant is enforced
   server-side by A1's `videos.js`.
4. **Links** — `spotify_url` / `bandcamp_url` / `soundcloud_url` (`PUT /links`, each validated as
   http(s) server-side). Artist `website_url` shown for reconciliation (read-only here). **Attach
   Spotify** action for manual songs (`POST /attach-spotify`). The **"on the playlist?" indicator
   is deferred to F.**
5. **Analysis** — read-only status from `wb.analysed`: "Analysed ✓ (gemma4)" / "Not yet analysed."
   **No editing, ever** — the external process owns this data; **B** fills in the coded dimensions.
6. **Notes** — `status_notes` (`PUT /details`) + `processing_note` (`PUT /processing`); current
   park reason / snooze date shown.

---

## 6. Parity check + deletions (final A3 task)

Before deleting, verify **every field the 4 superseded components managed is reachable in the new
workbench**:

- `StagingQueue.jsx` — To-process actions (attach-spotify, play-link, include, include&publish,
  reject) → top-bar decision buttons + Links panel.
- `LyricsLookupManager.jsx` — lyrics paste / status / source URL → Lyrics panel.
- `YouTubeVideoManager.jsx` — add/set-primary/delete videos → Video panel.
- old **`ManageSongsTab.jsx`** edit modal — title / links / etc. → Details + Links panels.
  (Already **unmounted since A2**; A3 removes the dead file.)

Any field with **no home** in the new UI is **flagged for a curator decision** (add a small
endpoint, or accept the drop) — never silently lost (curator condition from the whole-of-A spec
§8). Then `git rm` the 4 files and confirm no remaining imports (`npm run build` clean).

_Note: these components are already unmounted (no route imports them since A2), so deletion is
removing dead files, not changing live behaviour._

---

## 7. Guardrails / non-goals

- **Admin-only.** Behind the existing password gate (`AdminLayout`) + `X-Admin-Password` on every
  call. The workbench read returns **full lyrics + translation** — copyright, **never** a public
  route (existing grep-before-deploy rule holds; A1's `lyrics_privacy.test.js` guards it).
- **Not touched by A3** (owned by other sub-projects): mock categorisation (B deletes it — the
  workbench simply omits any categorisation form), YouTube _search_ (D — A3 is add-by-URL),
  lyrics _auto-fetch_ (E — A3 is quick-links + paste), Spotify _push_ + playlist indicator (F),
  real auth (Phase 5), cover-art _upload_ (Phase 5 — A3 is paste-a-URL), and editing
  artist/album/year (not exposed by A1).
- **No public-site behaviour change.** A3 is admin-only; public routes and the re-parented
  Artists/Playlists/Data-quality components are untouched.

---

## 8. Smoke-test expectation

- Backend `node --test` stays green (**no backend changes** expected in A3).
- `npm run build` clean; `npx eslint src/` → 0 errors on touched files.
- Headless walk (admin, logged in): open a **pending** song → paste lyrics (autosaves, "Lyrics"
  badge flips ✓) → select a line → Add highlight → add a video + set primary → save a Spotify
  link → **Include & publish** (status → live, completeness refreshes) → **‹ Prev / Next ›** steps
  within the arriving queue → open a song via **direct URL** and confirm Prev/Next is hidden →
  **Reject** on a pending song shows the confirm dialog. Confirm the 4 deleted files leave no
  broken imports.
