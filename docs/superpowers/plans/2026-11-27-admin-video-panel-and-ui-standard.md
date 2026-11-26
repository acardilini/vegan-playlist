# Admin video panel and a standard for admin lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** a tidy table-style Video panel, a small Listen link in the workbench top bar, and a written admin-list standard with reusable CSS.
**Architecture:** frontend only (no data-model or route changes): a pure helper for the audio-source rule, the top-bar link, the Video panel table, `.adm-list` CSS, `docs/ADMIN_UI.md`.
**Tech Stack:** React/Vite, node:test for pure utils, CSS tokens.
**Spec:** docs/superpowers/specs/2026-11-27-admin-video-panel-and-ui-standard-design.md

## Global Constraints
- Tokens only in CSS (`--bg-*`, `--text-*`, `--space-*`, ...); no raw colours. Panel body text 0.85rem, secondary 0.75rem, `btn-sm` / `input-sm`.
- **Listen is NOT a big button** (curator): a small text link in the top bar's existing links row, styled like "See song page ↗" (a ruling from the spec's word "button").
- The Audio radio on the primary's row clears the override (existing server behaviour); the old "Use for audio" / "Use primary" buttons and the "audio analysis" tag are removed.

## Review Focus
- A song with no video shows no Listen link; a song with videos but no primary falls back to the first video.
- A song with one video shows no radios or header, only title, type and ✕; the link is never squeezed by controls at a narrow panel width.
- Delete keeps its confirm; changing primary or audio reloads the workbench.

### Task 1: The audio-source rule and the Listen link
**Files:** Create `frontend/src/utils/videoSource.js` + `videoSource.test.js`; modify `frontend/src/components/admin/WorkbenchTopBar.jsx`, `frontend/src/styles/admin.css`.
**Interfaces:** Produces `audioSourceVideo(videos) -> video | null` (the one with `is_audio_source`, else the `is_primary` one, else the first, else null; tolerant of a non-array) and `listenUrl(videos) -> string | null` (`https://www.youtube.com/watch?v=<youtube_id>` only for an 11-char id).
- [ ] Test first (RED): marked video wins over the primary; no mark -> primary; no primary -> first; empty/undefined -> null; `listenUrl` null for a bad id.
- [ ] Implement; add `<a className="wb-public-link" ...>▶ Listen ↗</a>` first in `PublicLinks` (new tab, `rel="noopener noreferrer"`, `title="Play the video the audio analysis uses"`), only when `listenUrl` is non-null; a live/not-live class is not applied (it is about the song page).
- [ ] `node --test` the util; lint; build. Commit `feat(admin): Listen link in the workbench top bar`.

### Task 2: The Video panel table, the standard, docs
**Files:** Modify `frontend/src/components/admin/VideoPanel.jsx`, `frontend/src/styles/admin.css`; create `docs/ADMIN_UI.md`; update `CLAUDE.md`, `docs/PROJECT_STATE.md`.
- [ ] Add reusable `.adm-list` styles (header row, row, `.adm-col-choice` narrow radio column, `.adm-col-name` flexible with ellipsis, `.adm-pill`, `.adm-x` icon button) and remove the now-unused `.wb-videos` rules.
- [ ] Rebuild the rows: header + Show and Audio radios only when 2+ videos; title link; type pill; ✕ delete (existing confirm). Remove the audio buttons and tag.
- [ ] `docs/ADMIN_UI.md` (the six rules from the spec, with the `.adm-list` class names) and a CLAUDE.md pointer; PROJECT_STATE entries (Current State incl. what was not seen and smoke steps, Next Tasks follow-ups, Decision Log, Changelog).
- [ ] Mock-harness check at a narrow width (1 video, 3 videos, audio override); lint, build, frontend tests. Commit `feat(admin): video panel as a table, admin list standard`.
