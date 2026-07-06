# The Vegan Playlist — Modernisation Project Plan

_Last updated: 2026-07-06_

This is the phased roadmap for modernising the prototype into a clean, branded, deployable
product. See [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md) for the philosophy and
[`PROJECT_STATE.md`](./PROJECT_STATE.md) for where we currently are.

## How This Plan Works

- **Phases** are large, ordered stages of the modernisation. Finish one before starting the
  next (though Phase 0 findings may re-shape later phases).
- **Sessions** are the unit of work inside a phase — one focused chunk completable in a
  single working session. Sessions are a guide, not a contract; split or merge as reality
  demands, and record any change in `PROJECT_STATE.md`.
- **Smoke test** — every session that changes code ends with one: launch the backend and
  frontend and exercise the affected flow (as a user would), confirming nothing broke.
  Audit/design-only sessions have no smoke test (nothing to run) — note that instead.
- **YAGNI governs everything** — defer anything not needed now.

Legend: ☐ not started · ◐ in progress · ☑ complete

---

## Phase 0 — Discovery & Audit
**Goal:** Capture the full current state so nothing is lost. No production code changes.
**Exit criteria:** Feature Inventory complete; DB and Spotify audits documented; truth-source
model designed and recorded as a decision.

- ☑ **Session 0.1 — Feature Inventory.** Walk every screen and every endpoint of the running
  prototype. For each feature record: what it does, where it lives, what data it touches, and
  a decision (keep / rebuild / drop / defer). Output: a Feature Inventory document.
  _Smoke test: n/a (audit only). Done 2026-07-07 → [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md)._
- ☑ **Session 0.2 — Database audit.** Document the real schema (including migration files),
  row counts, data-quality issues, orphaned records, and the categorisation data actually
  present vs. empty. _Smoke test: n/a (read-only audit). Done 2026-07-07 →
  [`DATABASE_AUDIT.md`](./DATABASE_AUDIT.md). Headline: the DB holds NO curatorial data —
  all categorisation/review fields are empty; 1,208 = 674 (2025 import) + 534 (Apr 2026
  import); 18 true duplicate pairs; audio features all NULL and unobtainable from Spotify._
- ☑ **Session 0.3 — Spotify API audit.** Document what is currently pulled, what the API
  offers that we could use, the sync mechanism, auth flow, and rate limits. Identify which
  fields should be "enrichment" vs. "truth". _Done 2026-07-07 →
  [`SPOTIFY_API_AUDIT.md`](./SPOTIFY_API_AUDIT.md). Headlines: album covers still available —
  missing ones are our sync's bug (backfillable); audio features/previews/recommendations
  confirmed dead for this app; live playlist = 1,216 tracks vs 1,208 in DB. Shipped one fix:
  sync endpoints defaulted to the WRONG playlist (a Lofi Girl list) — now the real one._
- ☐ **Session 0.4 — Truth-source & data-source strategy.** Design the authoritative data
  model: how the curated dataset becomes the source of truth, how Spotify enrichment attaches,
  and how the messy new-songs file will be consolidated. Record as a decision. _Smoke test: n/a
  (design only)._

## Phase 1 — Data Foundation (Truth Source)
**Goal:** Stand up the authoritative dataset and the Spotify-enrichment approach.
**Exit criteria:** A single trusted dataset containing existing + newly identified songs;
enrichment pipeline defined; curatorial fields protected from sync overwrites.

- ☐ **Session 1.1 — Consolidate the new-songs file.** Bring the separate messy song lists
  (songs, lyrics, and any categorisation/review data — the 0.2 audit found the DB holds none
  of it) into the authoritative source; de-duplicate against what's in the DB (incl. the 18
  known duplicate pairs). _Smoke test: query the consolidated data via the app / API and
  confirm counts and integrity._
- ☐ **Session 1.2 — Spotify enrichment pipeline.** Implement/adjust so the truth source is
  authoritative and Spotify fills details where a match exists, without overwriting
  curatorial data. Includes the queued backfill: re-enrich the 534 Apr-2026 songs (275 bare
  albums — covers/dates — and ~245 bare artists), and close the 8-track gap to the live
  playlist. Replaces all three legacy import paths (see `SPOTIFY_API_AUDIT.md` §3).
  _Smoke test: run enrichment on a sample, confirm reviews/coding untouched._
- ☐ **Session 1.3 — Data integrity pass.** Reconcile artists/albums, fix orphans surfaced in
  the audit. _Smoke test: browse songs/artists in the app, confirm relationships render._

## Phase 2 — Architecture Cleanup
**Goal:** A maintainable codebase, same behaviour.
**Exit criteria:** `App.jsx` decomposed into pages/components; dead scripts and duplicate
routes pruned; clear frontend/backend structure and conventions documented.

- ☐ **Session 2.1 — Frontend decomposition.** Extract inline pages (Home, Song Detail,
  Artists, Playlists, About) from `App.jsx` into their own files; establish folder structure.
  _Smoke test: every route loads and behaves as before._
- ☐ **Session 2.2 — Backend consolidation.** Resolve `admin.js` vs `admin_simple.js`; group
  routes; retire experimental/test endpoints. _Smoke test: exercise admin + public endpoints._
- ☐ **Session 2.3 — Script cleanup.** Archive/remove the ~40 one-off scripts; keep the few
  still needed (import, sync, migrations) in a documented location. _Smoke test: run a retained
  script against a safe target; confirm app unaffected._

## Phase 3 — Brand & UI Rebuild
**Goal:** Apply the brand kit onto the now-clean frontend.
**Exit criteria:** Design system in place; all pages restyled to brand; responsive and
accessible.

- ☐ **Session 3.1 — Design system foundation.** Tokens (colour, type, spacing), global
  styles, and core reusable components from the brand kit. _Smoke test: component gallery /
  key pages render with brand styling._
- ☐ **Session 3.2 — Public pages restyle.** Home, Browse/Search, Song Detail, Artists.
  _Smoke test: walk each page on desktop + mobile widths._
- ☐ **Session 3.3 — Remaining pages & polish.** Playlists, Submit, Dashboard, About, Admin.
  Accessibility and responsive pass. _Smoke test: full walkthrough of every route._

## Phase 4 — Deployment Hardening
**Goal:** Ship it, cheaply, from GitHub.
**Exit criteria:** Live deployment; secrets managed; DB hosted; documented deploy process.

- ☐ **Session 4.1 — Environment & security.** Externalise config/secrets; input validation
  and basic hardening on public + admin endpoints; admin access control. _Smoke test: run
  locally from env config; confirm secrets not committed._
- ☐ **Session 4.2 — Deploy pipeline & DB hosting.** Choose final platform; add deploy config
  (e.g. `render.yaml`); provision hosted Postgres; migrate data. _Smoke test: deploy a branch
  and load the live site._
- ☐ **Session 4.3 — Launch checklist.** Domain, HTTPS, performance/load-time check, backups.
  _Smoke test: full production walkthrough against the PRD's launch success criteria._

---

## Backlog / Deferred (YAGNI)

Items intentionally deferred until needed (from the PRD and the Session 0.1
[Feature Inventory](./FEATURE_INVENTORY.md)). Nothing here is built until it earns its place.

- **Public playlist creation/editing with accounts.** Today anyone can create playlists and
  remove songs from any playlist, anonymously. Deferred until there is an auth/spam story
  (Phase 4 at the earliest); curated playlists remain browsable.
- **Audio previews / embedded player.** Song-card play buttons currently show a "coming soon"
  alert.
- **Clickable stat tiles** ("show all songs/artists" from the homepage stats).
- **Analytics event tracking** (PRD §3.4).
- **Custom visualisation builder** (PRD §3.4).
- **Offline capability / PWA** (PRD deferral).
