# Staging-Queue Admin UI — Design Spec (Session 1.4)

_Designed with the curator 2026-07-07. Implements the workflow queues defined in
[`PUBLICATION_STAGING_DESIGN.md`](../../PUBLICATION_STAGING_DESIGN.md) (Session 1.2b) and closes
out Phase 1. Data model (`status` + `published`) already exists; this session builds the screen
and the endpoints that drive it._

## Goal

A curator-only screen to work the publication pipeline end-to-end and to intake new candidate
songs — so the source spreadsheets can be retired. Scope is deliberately **lean triage**: the
screen handles go-live essentials (a play link, artwork, include/reject, publish/unpublish) and
new-candidate intake. Deeper editing (categorization, lyrics paste, YouTube) stays in the
existing admin tabs.

## Non-goals (YAGNI)

- No full inline editor (categorization/lyrics/title-artist) — those live in existing tabs.
- No browsable 1,341-row "Live" list — Live is search-to-unpublish only.
- No public-facing changes; no schema changes (model shipped in `002_published_flag.sql`).
- No changes to `status` semantics, the truth-source import rules, or lyrics guardrails.

## Queues (from PUBLICATION_STAGING_DESIGN.md)

| Sub-view | Definition | Count today |
|---|---|---|
| **To process** | `status = 'pending'` | 177 |
| **To finalise** | `status = 'included' AND NOT published`, annotated at query time with `missing[]` | 39 |
| **Live** | `status = 'included' AND published` — reached by search only | 1,341 |
| **Add candidates** | intake form (paste Spotify URLs) → new `pending` rows | — |

"Essentials" for a song to be publishable (used only to compute `missing[]` and to decide which
buttons to show — never a hard gate): **a play link** (`spotify_url` OR `bandcamp_url` OR
`soundcloud_url` OR a `youtube_videos` row) **AND artwork** (album `images` present).

## Architecture

New isolated component **`frontend/src/components/StagingQueue.jsx`**, mounted as one new
**"Staging"** tab in `AdminInterface.jsx` (a tab button + conditional render only — no queue
logic added to the 2,306-line monolith; aligns with the Phase 2.1 decomposition). The component
owns its own sub-view state (To process / To finalise / Live / Add candidates), data fetching,
and actions. All calls use the existing admin auth: the `x-admin-password` header carrying
`VITE_ADMIN_PASSWORD`, exactly as the other admin calls do.

New backend endpoints live in the existing `backend/routes/admin.js`, behind the existing
`x-admin-password` auth middleware, mirroring the style of the 1.2b `publish`/`unpublish`
handlers (LEFT JOIN albums so non-Spotify songs render; parameterised queries; `{success, ...}`
responses).

## Backend endpoints (all under `/api/admin`, password-protected)

### 1. `GET /staging?queue={pending|to-finalise|live}&q=&limit=&offset=`
Returns rows for a queue. Each row: `id, title, artists[], album_art (bool), play_link (bool +
which), status, published`. Extra rules:
- `queue=to-finalise` adds `missing: string[]` (subset of `['play link','artwork']`), computed
  at query time, never stored.
- `queue=live` **requires** `q` (title/artist search, ILIKE); without it returns `400` (guards
  against dumping 1,341 rows).
- `pending` and `to-finalise` return the full queue (small); `limit`/`offset` optional.
Response: `{ queue, total, rows: [...] }`.

### 2. `POST /songs/:id/include`  body `{ publish?: boolean }`
Sets `status = 'included'`. If `publish === true`, also sets `published = true, published_at =
now` in the same statement (the "Include & Publish" one-click). No essentials hard-gate
(publishing is the curator's call — the UI only *shows* the combined button when essentials are
present). `404` if the song does not exist. Returns the updated row.

### 3. `POST /songs/:id/reject`
Sets `status = 'rejected'`; if the row was `published`, also sets `published = false,
published_at = NULL` in the same statement (so the `songs_published_check` constraint is never
violated). `404` if not found. Rejected rows are kept (truth-source), not deleted.

### 4. `POST /songs/:id/attach-spotify`
Single-song Spotify attach. Reuses the conservative match logic from
`scripts/enrichFromSpotify.js` / `utils/playlistSync.js` (normalised title AND artist must both
match). On a confident match: sets `spotify_id`, `spotify_url`, links/creates the album (art +
release date) and artists, flipping `data_source` where the schema's CHECK requires it — writing
**only enrichment-class fields**, never curatorial ones. Returns `{ matched: true, ... }` or
`{ matched: false }` (no guess). `404` if song not found.

### 5. `POST /songs/:id/play-link`  body `{ bandcamp_url?, soundcloud_url? }`
Sets a manual play link for non-Spotify songs (at least one URL required; basic URL validation).
YouTube links continue to use the existing `POST /save-youtube-video`. `404` if not found.

### 6. `POST /staging/candidates`  body `{ urls: string[] }`
Intake. Accepts Spotify **track** and/or **playlist** URLs/IDs. Reuses `utils/playlistSync.js`
add-as-pending: resolves tracks, dedupes against existing songs (by `spotify_id`, then normalised
title+artist), inserts new ones as `status='pending'` (unpublished), enriches album/artist.
Import-only — never flips existing rows. Returns `{ added, skippedExisting, invalid }`.

### Reused unchanged
`POST /songs/:id/publish`, `POST /songs/:id/unpublish` (1.2b); `POST /save-youtube-video`,
`POST /save-lyrics-link`; categorization via the existing Manage Songs tab.

## Frontend behaviour (`StagingQueue.jsx`)

- **To process** — full list. Row shows art thumb, title — artist, and presence badges. Actions:
  `Attach Spotify`, `Add play link ▾` (bandcamp / soundcloud / youtube), `Include`, `Reject`, and
  — only when essentials are present — `Include & Publish`.
- **To finalise** — full list. Each row shows `⚠ missing: …` and offers `Attach Spotify` /
  `Add play link` to fill gaps plus `Publish` (always enabled; the warning is guidance).
- **Live** — search box → matching published rows → `Unpublish`.
- **Add candidates** — textarea for pasted Spotify URLs (one per line) → `Import` → shows
  `{added, skippedExisting, invalid}`; new rows appear under To process.
- After every action the affected queue refetches (or the row updates in place) so counts stay
  live. Errors surface inline; nothing is destructive except `Reject` (reversible via Include)
  and candidate import is idempotent.

## Data flow & guardrails

Every write respects the truth source: intake is import-only and additive (new = `pending`);
`include`/`reject` touch only `status` (+ the coupled `published` clear on reject);
`publish`/`unpublish` touch only `published`; `attach-spotify` writes only enrichment fields. The
`songs_published_check` constraint keeps `status`/`published` consistent. No new endpoint or
public route selects `song_lyrics`.

## Testing

- **Backend (automated):** status transitions (`pending → included`; `include {publish:true}` →
  included+published; `reject` on a published row also unpublishes); `GET /staging` filters +
  the `to-finalise` `missing[]` annotation + the `live`-requires-`q` 400; candidate dedupe
  (existing spotify_id and title+artist both skip). Run against a disposable row/transaction so
  the curated data is untouched.
- **UI (manual, end-session smoke per PROJECT_PLAN):** process a few real pending songs
  end-to-end (attach/add link → Include, and Reject one), finalise + publish one To-finalise
  song, unpublish it back, import a small paste of candidate URLs. Confirm public totals move
  as expected and nothing curatorial changed.

## Out-of-scope follow-ups (recorded, not built here)

- The optional Session 1.3 curator items (6 attach typos, 3 unmatched rows, 2 unclassified) can
  be worked through this screen once it exists.
- Frontend monolith decomposition remains Phase 2.1; this component is built decomposed-ready.
