# A4 — Admin Dashboard landing + cleanup (design)

_Date: 2026-07-16 · Sub-project A, plan A4 (the last plan in sub-project A) · Phase 4 (Admin Rebuild)_

## Purpose

Replace the `/admin` dashboard **stub** (`DashboardStub.jsx`, placeholder text only) with a
real landing page, and delete the **old** admin dashboard (`DataCompletionDashboard.jsx`).

When the curator logs in they land on `/admin`. The dashboard answers two things at a glance:
**what should I work on** (queues needing attention) and **how healthy is the catalogue**
(totals), plus a fast path back to in-progress work (recent activity) and a way to add a song.
This is the "blend of both" the curator chose: action tiles on top, a compact health line
below — deliberately lean so it does not regrow into the old percentage-bar wall.

> **Naming guardrail (repeated across the project docs):** A4 deletes
> `frontend/src/components/DataCompletionDashboard.jsx` — the **admin** dashboard. It does
> **not** touch `frontend/src/components/DataDashboard.jsx`, the **public** `/dashboard`
> page, which stays.

## Non-goals (YAGNI)

- No completion-percentage bars, no "priority action" nagging copy, no emoji (brand voice).
- No activity/audit log. "Recent activity" is derived from `songs.updated_at`, not an event
  stream. (The heavier "what changed" feed was explicitly rejected in brainstorming.)
- No Inbox view (sub-project C) and no Needs-analysis surfacing (sub-project B). The Inbox
  tile shows its count but is disabled, matching the existing `QueueRail` treatment.
- No new curatorial data and no writes: the two new endpoints are read-only.

## Layout

New component `Dashboard.jsx` at `/admin`, real data only (no mock fallbacks).

```
┌──────────────────────────────────────────────────────────────┐
│  Dashboard                                    [ + Add a song ] │
├──────────────────────────────────────────────────────────────┤
│  Needs your attention                                          │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐  │
│  │  177  │ │  603  │ │  41   │ │  715  │ │  39   │ │   2   │  │
│  │To be  │ │Needs  │ │Needs  │ │Needs  │ │To     │ │Inbox  │  │
│  │process│ │lyrics │ │cover  │ │video  │ │finalise│ │(soon)│  │
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘  │
│   (each clickable → /admin/songs?queue=…)   (Inbox disabled)   │
├──────────────────────────────────────────────────────────────┤
│  Catalogue health                                              │
│   1,800 songs · 1,342 live · 39 to finalise · 177 pending      │
│   · 243 rejected                                               │
├──────────────────────────────────────────────────────────────┤
│  Recent activity                                               │
│   Song Title — Artist            included    2h ago        →   │
│   Song Title — Artist            pending     5h ago        →   │
│   … last 10 edited, each row → its Curation Workbench          │
└──────────────────────────────────────────────────────────────┘
```

(The numbers above are illustrative, drawn from recent queue counts.)

## Sections

### 1. Needs your attention (action tiles)

Clickable stat cards, one per work queue, linking to that queue in the Songs area via
`/admin/songs?queue=<key>` (the Songs area already reads and sanitizes `?queue=`):

| Tile | queue key | links to |
| --- | --- | --- |
| To be processed | `to-process` | `/admin/songs?queue=to-process` |
| Needs lyrics | `needs-lyrics` | `/admin/songs?queue=needs-lyrics` |
| Needs cover | `needs-cover` | `/admin/songs?queue=needs-cover` |
| Needs video | `needs-video` | `/admin/songs?queue=needs-video` |
| To finalise | `to-finalise` | `/admin/songs?queue=to-finalise` |
| Inbox | `inbox` | — (disabled; sub-project C) |

Data source: the **existing** `GET /api/admin/curation/counts` (`curation.queueCounts`). No new
endpoint. `needs-analysis`, `awaiting-community`, and `remind-later` are intentionally **not**
tiles here (B / parked queues) — they remain reachable from the Songs-area rail.

### 2. Catalogue health (compact)

A single line of totals: **total songs · live · to finalise · pending · rejected**. Numbers
only — no bars, no percentages, no recommendations.

Data source: a new `GET /api/admin/curation/catalogue-stats`.

Definitions (consistent with `queueWhere` in `curation.js`):
- **total** = all rows in `songs`.
- **live** = `status='included' AND published=true`.
- **to finalise** = `status='included' AND published=false`.
- **pending** = `status='pending'` (total pending, regardless of park/snooze — a superset of
  the `to-process` tile, which excludes awaiting-community and snoozed).
- **rejected** = `status='rejected'`.

### 3. Recent activity

The last 10 songs by `updated_at DESC`. Each row: title, artist(s), a status badge
(pending / included / rejected, plus a "live" hint when `published`), relative time
("2h ago"), linking to `/admin/song/:id` (the Curation Workbench). Because every workbench
panel-save and lifecycle change sets `songs.updated_at=CURRENT_TIMESTAMP`, this reflects real
curator work. (Enrichment/sync also bump `updated_at`; that is acceptable — it is still recent
activity, not noise worth filtering.)

Data source: a new `GET /api/admin/curation/recent`.

## Backend (two small additions, TDD)

Both live in `backend/services/curation.js`, are routed in `backend/routes/admin.js` under the
existing "Curation workbench" banner **behind `authenticateAdmin`**, and get tests in
`backend/test/curation.test.js` (node:test; use the file's existing fixture-prefix convention
so parallel runs don't race).

- `curation.catalogueStats(db)` → `{ total, live, toFinalise, pending, rejected }` — one query
  using `COUNT(*) FILTER (WHERE …)`.
  Route: `GET /api/admin/curation/catalogue-stats`.
- `curation.recentlyEdited(db, limit = 10)` → array of
  `{ id, title, artists, status, published, updated_at }`, ordered `updated_at DESC`, artists
  aggregated the same way the queue list does (`string_agg(DISTINCT a.name, ', ')`).
  Route: `GET /api/admin/curation/recent` (optional `?limit=` capped to a small max, default 10).

The action tiles reuse the existing counts endpoint, so no third endpoint is added.

## Frontend

- New `frontend/src/components/admin/Dashboard.jsx`:
  - Fetches counts, catalogue-stats, and recent (via `adminFetch`) on mount.
  - Renders the three sections + an `AddSongPanel` modal (reused unchanged) opened by
    `+ Add a song`; on add, refetch counts + recent so the dashboard reflects the new song.
  - Tiles and rows are real links/buttons (keyboard-accessible), navigating with React Router.
- Wire `Dashboard` into the router (`App.jsx`) as the `/admin` index route; delete the
  `DashboardStub` import + component.
- Styling in `frontend/src/styles/admin.css`, **design tokens only** (`--bg-*` / `--text-*` /
  `--accent-*` / `--space-*`), no raw colors, reusing existing admin card/tile patterns where
  they exist.

## Cleanup (the "delete the old dashboard" half of A4)

- Delete `frontend/src/components/DataCompletionDashboard.jsx` (admin dashboard — **not** the
  public `DataDashboard.jsx`).
- Delete the now-orphaned `GET /api/admin/completion-stats` route in `admin.js` (its only
  consumer was that component; ~150 lines of mock-fallback stats). Verify no other caller first.
- Remove the dead `DataCompletionDashboard`-specific CSS block from `App.css`.
- Delete `frontend/src/components/admin/DashboardStub.jsx`.

## Verification / smoke test

- Backend `node --test` green (existing 42 + new catalogue-stats/recent tests).
- `npm run build` clean; `eslint src/` 0 errors.
- Headless walk: land on `/admin` → tiles show live counts matching `/curation/counts`;
  clicking a tile lands on the matching Songs-area queue; health line matches
  `/curation/catalogue-stats`; recent-activity rows link to the right workbench; Add-a-song
  bumps `to-process` and appears in recent activity; the deleted endpoint returns 404 and no
  frontend imports `DataCompletionDashboard`/`completion-stats`.
- DB queue counts identical before/after (clean up any throwaway probe songs).

## Impact on the 650-song dataset

None. All new backend work is read-only aggregation; the only mutation path on the page is the
pre-existing `AddSongPanel` (quick-capture as pending / Spotify import-as-pending), unchanged.
