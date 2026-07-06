# The Vegan Playlist — Project State

_This is the **living document**. Read it at the start of every session; update it at the end._
_See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full roadmap._

---

## Current State

- **Phase:** Phase 0 — Discovery & Audit
- **Current session:** _not yet started_
- **Next session:** Session 0.1 — Feature Inventory
- **Last updated:** 2026-07-06

### Next Tasks (start here)
1. **Session 0.1 — Feature Inventory:** walk every screen + endpoint, record keep/rebuild/drop/defer.
2. **Session 0.2 — Database audit** (schema, counts, data quality).
3. **Session 0.3 — Spotify API audit** (what's pulled, what's available, sync, rate limits).
4. **Session 0.4 — Truth-source strategy** (design authoritative model + consolidation plan).

### Known Context / Watch-outs
- Frontend is a ~2,000-line `App.jsx` monolith with inline pages — Phase 2 target.
- Backend has duplicate route files (`admin.js` / `admin_simple.js`) and ~40 one-off scripts — Phase 2 target.
- A separate, messy file of newly identified songs needs consolidating into the truth source — Phase 1.
- Deployment must be cheap and GitHub-driven — decided in Phase 4.
- There is an untracked `backend/nul` file (likely a stray Windows redirect artifact) — remove during cleanup.

---

## Decision Log

Newest first. Each entry: date · decision · why.

- **2026-07-06 — One living state doc.** Current-state and decision log live together in this
  file (not split) — simplest thing that works (YAGNI). Revisit if it grows unwieldy.
- **2026-07-06 — Modernise, don't rewrite.** Preserve backend + PostgreSQL + 650-song dataset;
  rebuild frontend and ops layer. A greenfield rewrite risks losing subtle, hard-won logic and
  curation. Feature Inventory (Phase 0) is the safety net.
- **2026-07-06 — Truth source becomes the curated dataset; Spotify becomes enrichment.** A song
  exists because the curator says so, not because it's on a Spotify playlist. Spotify fills
  details where a match exists and never overwrites curatorial data. Enables multi-platform
  songs (Bandcamp, YouTube, etc.).
- **2026-07-06 — Retain the tech stack** (React/Vite, Node/Express, PostgreSQL). The pain is
  architecture/brand/deployment, not the stack itself.
- **2026-07-06 — Phased approach adopted** (Phases 0–4). Code-changing sessions end with a
  smoke test.

---

## Changelog

Newest first. What actually happened each session.

- **2026-07-06** — Modernisation planning established: created `PROJECT_OVERVIEW.md`,
  `PROJECT_PLAN.md`, `PROJECT_STATE.md`; updated `PRD.md` with the as-built feature inventory;
  updated `CLAUDE.md` with the Start/End-Session workflow and YAGNI principle.
