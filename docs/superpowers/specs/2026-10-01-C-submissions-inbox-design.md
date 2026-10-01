# Sub-project C — Submissions Inbox (design)

Date: 2026-10-01 · Status: awaiting curator review · Parent design:
[`2026-07-12-admin-workbench-design.md`](./2026-07-12-admin-workbench-design.md) §7

## 1. Goal

Community song suggestions (public `/submit` → `song_submissions`) become reviewable in the admin.
An **Inbox** queue in the Songs area lists pending submissions, **oldest first (FIFO)**. The curator
either **accepts** one (it enters the *To be processed* queue) or **dismisses** it. Nothing reaches the
public site without the curator's existing Publish click, so the curated dataset is not put at risk.

## 2. Current state (verified 2026-10-01)

- `POST /api/submissions/submit` writes `song_submissions` and flags `existing_song_id` on a title/artist
  match. That match query does **not** consider `status`/`published`.
- `/api/submissions/admin*` (list/get/status/delete) is **unauthenticated**; `SubmissionsManager.jsx`
  is not mounted anywhere in the rebuilt admin, so submissions are currently unviewable.
- `POST /api/admin/submissions/:id/add-to-pending` → `staging.addSubmissionAsPending` already bridges a
  submission to a pending song (Spotify match, else manual).
- Inbox rail slot and dashboard tile exist but are disabled; `curation.inbox` counts
  `existing_song_id IS NULL` (so catalogue matches are hidden).
- `SongSubmissionForm` reads `result.already_exists`, but the API nests it at
  `result.submission.already_exists` — the "already in our playlist" message **never shows** (bug).
- Live data: 2 submissions, both pending.

## 3. Decisions (curator, 2026-10-01)

1. Catalogue-match submissions **appear in the Inbox** with an "Already in catalogue" badge (not hidden,
   not auto-resolved).
2. The submitter is told immediately when the song already exists — **only when the match is live**
   (`included` + `published`); otherwise the normal thank-you. The Inbox still flags any match.
3. **Spam: dismiss only.** No honeypot, no rate limit (YAGNI). Nothing is auto-classified as spam, so a
   genuine submission can never be auto-dropped.
4. **Oldest first.**
5. Close the submissions-admin auth gap **by removal**: delete the unauthenticated routes rather than
   patch them (no parallel moderation APIs).

## 4. Backend

All new routes live in `routes/admin.js` (behind the existing admin-password middleware); logic in
`services/staging.js` or a small inbox section there, tested with `node:test`.

- `GET /api/admin/curation/inbox` — `status='pending'`, `ORDER BY created_at ASC, id ASC`. Row fields:
  id, song_title, artist_name, album_name, release_year, youtube_url, lyrics_excerpt,
  submission_reason, submitter_name, submitter_email, created_at, and the match
  `{ song_id, title, live }` or `null` (`live` = `status='included' AND published=true`).
- `POST /api/admin/curation/inbox/:id/accept` — only while `pending` (else 409). Calls
  `addSubmissionAsPending`; on success sets `status='approved'`, `resolved_at`, returns `{ song_id }`
  (the existing `existing_song_id` song if matched, else the new/found song).
- `POST /api/admin/curation/inbox/:id/dismiss` — only while `pending` (else 409); body `{ note? }`;
  sets `status='rejected'`, `admin_notes`, `resolved_at`.
- `curation.inbox` count becomes `status='pending'` (now includes catalogue matches).
- Remove `GET/PUT/DELETE /api/submissions/admin*` from `routes/submissions.js` and the superseded
  `POST /api/admin/submissions/:id/add-to-pending` (accept replaces it). Keep `POST /submit`.
- `POST /submit`: `already_exists` is true only for a **live** match (the `existing_song_id` link is still
  stored for any match). A CHECK violation on email/year (`23514`) returns **400** with a plain message
  instead of 500.
- **No migration**: existing statuses and constraints cover it.

## 5. Frontend

- `QueueRail.jsx` / `Dashboard.jsx`: enable `inbox`; drop the "until sub-project C" comments.
- `SongsArea.jsx`: add `inbox` to `SELECTABLE_QUEUES`; when active render `InboxList` instead of
  `SongQueueList` (different row shape — a submission is not a song yet).
- New `InboxList.jsx`: oldest first; row = title/artist, age (`relTime`), submitter name/email if given,
  reason, YouTube link and lyrics excerpt if given; **"Already in catalogue"** badge linking to the
  workbench, noting live vs not; **Add to To be processed** and **Dismiss** (optional one-line note inline,
  no modal). After an action the row leaves, rail + tile counts refresh, an accepted row briefly shows
  "Added — open in workbench". Empty state "Inbox is clear"; inline error on failure. No pagination.
- Reuses existing queue-row/`.btn` classes and `--bg-*`/`--space-*` tokens; no new primitives.
- `SongSubmissionForm.jsx`: read `result.submission.already_exists`; distinct "already on the site"
  message for live matches; show the 400 message.
- Delete `SubmissionsManager.jsx` and its `.submissions-manager` block in `App.css`.

## 6. Testing

- Backend `node:test` with a unique fixture prefix (`ZZZINBOX`; shared prefixes race under parallel
  runs): list order is FIFO; match flag incl. live vs not-live; accept (409 when not pending);
  dismiss (note saved, 409 when not pending); count; 400 mapping for bad email/year.
- Puppeteer smoke against the dev DB: submit → appears in Inbox → accept lands in To be processed;
  submit → dismiss. Cleans its own rows; the two real submissions stay untouched. Run from the
  scratchpad (nodemon hazard), not from `backend/`.

## 7. Out of scope / deferred

Spam prevention (honeypot / rate limit), submitter email notifications, bulk actions, public-site
auth, hard-coded `localhost:5000` in the public form (Phase 5).
