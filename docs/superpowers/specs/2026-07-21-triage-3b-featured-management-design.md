# Triage 3b — Featured management view (see + quick-unfeature)

_Design spec. 2026-07-21. Curator-approved at brainstorm._
_Follow-up to triage 3 (featured redesign, merged `6718cec`) from a curator smoke-test finding._

## Goal

Make it easy to see which songs are currently featured and turn them off quickly when rotating
the featured set. Today the only control is the per-song workbench toggle — there's no
catalogue-wide view of the featured set.

## Decisions (curator)

- A **"Featured" scope** in the admin Songs area (reuses the existing queue rail + list), showing
  every `featured=true` song with a **live count**, each row with a **quick "Unfeature" button**.
- A **"Featured" badge** on song rows across all scopes (spot them anywhere).
- **No inline Feature/Unfeature toggle in other scopes** — turning songs *on* stays in the workbench
  (curator chose the minimal "see + turn off" scope).
- A **"Featured (N)" tile** on the `/admin` Dashboard linking to the Featured scope.

## Design

### Backend (`services/curation.js`, reuse existing route)

- `queueWhere`: add `case 'featured': return "s.featured=true";` and add `'featured'` to `QUEUE_NAMES`.
  The scope shows **all** featured songs regardless of `published` (so nothing the curator flagged is
  hidden; the row's status badge already shows live/unpublished).
- `queueCounts`: add `'featured'` to the counted `keys` array → `out.featured`.
- `listCurationQueue`: add `s.featured` to the SELECT and ensure `mapQueueRow` carries `featured`
  through to each row (drives the badge + the Unfeature button's presence).
- **Quick action reuses** `POST /api/admin/songs/:id/unfeature` (triage 3) — no new route.
- No change to `queueWhere`'s other cases; `'featured'` is a controlled literal, injection-safe.

### Frontend

- `SongsArea.jsx`: add `'featured'` to `SELECTABLE_QUEUES`.
- `QueueRail.jsx`: add a **Featured** rail item with its count (placed with the status scopes near
  `live`/`all`).
- `SongQueueList.jsx`:
  - `QUEUE_LABELS`: `featured` → `'Featured'`.
  - **Featured badge** on any row where `row.featured` (a small pill beside the status badge).
  - **Quick Unfeature** — only in the `featured` scope, a per-row button calling
    `adminFetch('/api/admin/songs/:id/unfeature', { method:'POST' })` then reloading the list (the
    row drops out). Because the row is currently a single `<button>` (whole-row navigation to the
    workbench), refactor it into a flex **wrapper** holding the navigating button + the action button
    as siblings (no nested interactive elements).
- `Dashboard.jsx`: add a **Featured (N)** tile (from `queueCounts.featured`) linking to
  `/admin/songs?queue=featured`.
- CSS (`components.css` or the admin block): a `.featured-badge` pill and `.song-row-wrap` /
  `.song-row-action` layout rules.

## Testing

- **Backend `node:test`** (`curation.test.js`, `ZZZCUR` sentinel): `listCurationQueue({queue:'featured'})`
  returns a featured song and excludes a non-featured one; `queueCounts(...).featured` is a number and
  increments when a song is featured.
- **Live smoke** (backend restarted; frontend running; admin password): the **Featured** rail scope +
  Dashboard tile show the correct count; the scope lists the featured songs; a row's **Unfeature**
  button removes it from the list (and from the homepage Featured); the **Featured badge** shows on
  featured rows in other scopes (e.g. Live/All).

## Scope / out of scope

- **In:** `services/curation.js` (queue + count + row field), `SongsArea.jsx`, `QueueRail.jsx`,
  `SongQueueList.jsx`, `Dashboard.jsx`, admin CSS, `curation.test.js`.
- **Out:** an inline Feature/Unfeature toggle in non-featured scopes (curator chose unfeature-only);
  any change to the featured *display* model (triage 3 owns that); the homepage. Independent of the
  DB cleaning and of the unmerged triage-4 branch.
