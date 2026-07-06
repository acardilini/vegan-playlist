# The Vegan Playlist — Project Overview

_Last updated: 2026-07-06_

This document is the high-level "what & why" companion to the [PRD](./PRD.md). Where the
PRD describes the **product vision**, this describes the **project itself** — its current
state, its architecture, and the philosophy guiding its modernisation.

## Document Map

| Document | Role |
|---|---|
| [`PRD.md`](./PRD.md) | Product vision and full feature specification (the "what we're building toward"). |
| `PROJECT_OVERVIEW.md` (this file) | Current state, tech stack, and modernisation philosophy. |
| [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) | The phased modernisation roadmap: phases → sessions → smoke tests. |
| [`PROJECT_STATE.md`](./PROJECT_STATE.md) | **Living doc.** Current phase/session, next tasks, decision log, changelog. Read at the start of every session, updated at the end. |
| [`../CLAUDE.md`](../CLAUDE.md) | Working agreement, including the Start-Session / End-Session workflow. |

## What This Project Is

The Vegan Playlist is a web-based resource for vegan-themed music: a curated database of
650+ songs collected over ~7 years, with expert analysis of each song's advocacy approach.
It serves the vegan community as a discovery tool and researchers as a data resource.

## Where It Is Now (2026-07-06)

The project exists as a **working prototype**. Nearly every feature in the PRD has a
functional implementation, backed by a real PostgreSQL database of 650+ songs. However, the
prototype was built without a plan for deployment, visual design, or long-term
maintainability. Three concrete problems motivate this modernisation:

1. **Messy architecture** — the frontend is a single ~2,000-line `App.jsx` with most pages
   defined inline; the backend carries ~40 one-off scripts and duplicated/experimental route
   files (`admin.js` + `admin_simple.js`).
2. **No brand or design system** — the UI predates the brand kit developed with Claude and
   does not reflect it.
3. **Not deployment-ready** — no hosting, environment/secret strategy, or
   deploy-from-GitHub pipeline.

## Modernisation Philosophy

**Modernise, don't rewrite.** The backend routes, PostgreSQL schema, and the 650-song
dataset are the project's crown jewels — they encode years of curation and non-obvious logic
(genre migrations, duplicate detection, Spotify sync, categorisation). A greenfield rewrite
would force re-deriving all of it, which is exactly where subtle features get lost.

So "start again" means **rebuild the frontend and the ops layer while preserving and cleaning
the backend and data.** The safety net that guarantees no feature is lost is the **Feature
Inventory** (Phase 0): a systematic walk of every screen and endpoint, recording for each a
keep / rebuild / drop / defer decision.

### The "Truth Source" shift

A key architectural change accompanies this work. **Today**, Spotify is the source of
truth — songs are pulled from a Spotify playlist and the DB mirrors it. **Going forward**,
the curated dataset becomes authoritative: a song exists because the curator says it belongs,
regardless of Spotify. Spotify becomes an **enrichment layer** — when a song has a Spotify
match, we pull metadata/audio features/artwork, but songs can exist with no Spotify presence
(Bandcamp, YouTube, etc.), and curatorial data (reviews, coding, notes) is never overwritten
by a sync. This directly enables the multi-platform goal already in the PRD.

## Tech Stack (retained through modernisation)

- **Frontend:** React 19 + Vite, React Router 7, Chart.js
- **Backend:** Node.js + Express 5
- **Database:** PostgreSQL (`pg` connection pool)
- **Integrations:** Spotify Web API (client-credentials flow), YouTube Data API
- **Deployment target:** cheap, GitHub-driven. Leading candidates: Render (`render.yaml`
  blueprint for static frontend + Node service + Postgres) or Vercel + a managed Postgres
  (Neon / Supabase). Finalised in Phase 4.

## Guiding Principles

- **YAGNI** — build only what is needed now. No speculative features, abstractions, or
  infrastructure. If the PRD lists something we don't need yet, defer it in the inventory.
- **Preserve the data** — every change is evaluated against "does this risk the 650-song
  curated dataset?"
- **Phased and verifiable** — work proceeds in phases and sessions; code-changing sessions
  end with a smoke test (launch backend + frontend, exercise the affected flow).
