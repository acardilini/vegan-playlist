# Audio analysis video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** the curator can mark which YouTube video the audio analysis should use; default is the primary.
**Architecture:** nullable `songs.audio_video_id` pointer + `audio_video_set_at`; service, route, workbench read, Broken-video rule, small UI button, handoff note.
**Tech Stack:** Express, PostgreSQL, node:test, React.
**Spec:** docs/superpowers/specs/2026-11-27-audio-analysis-video-design.md

## Global Constraints
- Only `services/videos.js` writes `songs.audio_video_id`. The analysis tables are never written. Sentinel for tests: `ZZZAVD`.
- Migration 029 is additive and idempotent (`ADD COLUMN IF NOT EXISTS`).

## Review Focus
- Deleting the marked video returns the song to the primary (FK SET NULL).
- A video from another song is refused.
- Choosing the primary video clears the pointer.

### Task 1: Backend
**Files:** Create `backend/database/migrations/029_audio_video.sql`, `backend/test/audioVideo.test.js`; modify `backend/services/videos.js`, `backend/services/curation.js` (workbench videos read), `backend/services/audioAnalysis.js` (`BROKEN_VIDEO_SQL`), `backend/routes/admin.js`.
**Interfaces:** Produces `videos.setAudioVideo(db, songId, videoId|null) -> { audio_video_id }`; workbench `videos[i].is_audio_source`; route `PUT /api/admin/workbench/:id/audio-video`.
- [ ] Tests (RED first): set a non-primary video -> pointer set and `audio_video_set_at` stamped; set the primary -> pointer NULL; another song's video -> `BAD_INPUT`; null clears; deleting the marked video -> pointer NULL via FK; workbench read marks `is_audio_source` on the pointed video, else on the primary; a song with an UNAVAILABLE analysis is in `broken-video` and leaves it after `setAudioVideo` stamps a later time.
- [ ] Implement; apply migration 029 to the dev DB; run `node --test test/audioVideo.test.js test/videos.test.js test/brokenVideo.test.js`, then the full serial `npm test`.
- [ ] Commit `feat(audio-video): choose the audio analysis video`.

### Task 2: Frontend, docs
**Files:** Modify `frontend/src/components/admin/VideoPanel.jsx`, `frontend/src/styles/admin.css` if needed; create `docs/MAIN_PROJECT_AUDIO_VIDEO_HANDOFF.md`; update `docs/PROJECT_STATE.md`, `CLAUDE.md`.
- [ ] **Audio analysis** button per video row + tag on the analysed row (`PUT .../audio-video`, then reload); lint, build, frontend tests; check in a throwaway mock harness.
- [ ] Docs and handoff; commit `docs: audio analysis video`.
