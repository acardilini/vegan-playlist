# Links panel on the admin standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** the Links panel and its Other platforms section follow `docs/ADMIN_UI.md`, behaviour unchanged.
**Architecture:** frontend only: `AutoText inline`, new `.adm-*` classes, `LinksPanel.jsx` and `PlatformLinksSection.jsx` rebuilt as tables.
**Tech Stack:** React/Vite, CSS tokens.
**Spec:** docs/superpowers/specs/2026-11-27-links-panel-standard-design.md

## Global Constraints
- Tokens only; text 0.85rem / 0.8rem; no behaviour, route or API change; `AutoText` without `inline` renders exactly as before.

## Review Focus
- Every action still reachable: attach, push, add anyway, dormant, Bandcamp search, Confirm, Reject.
- Open links appear only for a set URL and only http(s)-safe as before (hrefs come from stored values, rendered as before); an empty Spotify row still has an input to paste into.

### Task 1: Rebuild the panel
**Files:** modify `frontend/src/components/admin/SavedField.jsx`, `LinksPanel.jsx`, `PlatformLinksSection.jsx`, `frontend/src/styles/admin.css`, `docs/ADMIN_UI.md`; docs in `docs/PROJECT_STATE.md` (incl. the Next Tasks note: the artist analysis was updated, see `docs/MAIN_PROJECT_ARTIST_ENRICHMENT_HANDOFF.md`, review it, then redesign the artist admin page on the standard).
- [ ] Implement per the spec; lint, build, frontend tests; check in a mock page at 400px (spotify set / empty, platform rows proposed + confirmed, an action message). Commit `feat(admin): Links panel on the admin standard`.
