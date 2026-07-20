# Fixes Round 1 — Data-integrity & workbench bugs (design)

_Date: 2026-07-20 · Status: approved for planning_

A small, tightly-scoped round of four independent fixes surfaced by curator use, done
before B4 (Explore vector map). Ordered by severity; #1 is actively losing curatorial data
on every lyrics edit and leads the branch. One combined spec → plan → branch.

**Context:** these came out of a larger triage of curator-reported issues (see
`PROJECT_STATE.md` changelog for the session). The remaining triaged items — thematic
analysis update (`key_focus_pipeline`), browse/search polish, featured redesign,
About/transparency page, and B4 — are their own later rounds and are **out of scope here**.

---

## #1 — Lyrics save must not wipe the source URL or translation 🔴 (data loss)

**Root cause (confirmed):** `backend/services/curation.js` `saveLyrics()`. When lyrics text is
provided, the upsert is:

```sql
INSERT INTO song_lyrics (song_id, lyrics, source_url, translation)
VALUES ($1,$2,$3,$4)
ON CONFLICT (song_id) DO UPDATE SET
  lyrics=EXCLUDED.lyrics, source_url=EXCLUDED.source_url, translation=EXCLUDED.translation
```

with `[id, lyrics, source_url || null, translation || null]`. The Lyrics textarea autosave
sends only `{lyrics}`, so `source_url` and `translation` arrive as `null` and **overwrite**
the stored values. The curator noticed the URL loss; translations were being destroyed the
same way, silently.

**Fix:** write only the columns actually provided on a given save.
- Distinguish "not provided" (`undefined`) from "explicitly cleared" (`''`/`null`), the same
  discipline the function's existing `add()` helper uses for the `songs` columns.
- On a lyrics-text-only save, upsert **lyrics** and leave `source_url`/`translation` untouched.
  Concretely: on `ON CONFLICT`, set `source_url`/`translation` only when they were provided
  (e.g. `source_url = COALESCE($3, song_lyrics.source_url)` when caller may omit; combined with
  a provided/omitted flag so an explicit empty-string can still clear a field).
- **Clearing lyrics text preserves the URL and translation** (curator decision 2026-07-20):
  clearing lyrics no longer `DELETE`s the whole `song_lyrics` row. Instead set
  `lyrics = NULL` (or `''`) and keep `source_url`/`translation`. The row persists so those
  fields survive; the curator removes them explicitly if wanted.
  - Downstream check: the `needs-lyrics` queue and `completeness.lyrics` currently key off
    *row existence* (`EXISTS (SELECT 1 FROM song_lyrics …)`). With the row now surviving a
    lyrics-clear, "has lyrics" must key off `lyrics IS NOT NULL AND lyrics <> ''`, not row
    existence. Update `queueWhere('needs-lyrics')`, the completeness/`has_lyrics` computation,
    and the analogous `awaiting-community`/other lyrics-existence checks in `curation.js`
    consistently. This is part of the fix, not a follow-up.

**"+ Add selection also strips it sometimes":** `saveHighlights()` only writes
`songs.lyrics_highlights`, so it cannot strip `source_url` on its own — the frontend must be
firing a lyrics re-save around the highlight action. Trace the Lyrics panel's save sequencing
during implementation and stop any spurious lyrics-only re-save. The backend fix above removes
the data-loss whatever the trigger, so this is confirmation, not a second root cause.

**Verification / tests (node:test, `test/curation.test.js`):**
- Save `{lyrics}` only against a row with an existing `source_url` **and** `translation` →
  both survive; lyrics updated.
- Save `{lyrics, source_url:''}` → `source_url` explicitly cleared, translation untouched.
- Clear lyrics (`{lyrics:''}`) on a row with URL+translation → row persists, URL+translation
  intact, `has_lyrics`/`needs-lyrics`/completeness now report "no lyrics".
- A genuinely lyrics-less song still reports as needing lyrics.

---

## #2 — Park reason doesn't reflect after selecting 🟠 (display **+ a backend data-loss sibling**)

**Root cause — display half (confirmed):** `frontend/src/components/admin/WorkbenchTopBar.jsx`
renders an action-style `<select>` that resets to the "Park…" placeholder immediately after a
pick (`e.target.value = ''`), so the control never shows what you chose; the "Parked: …" banner
lives in the distant `NotesPanel`.

**Root cause — backend half (found during planning):** `setProcessing()` (`curation.js`) has the
**same partial-update data-loss bug as #1**. Only `lyrics_tried` is COALESCE'd; `snooze_until`,
`park_reason`, and `processing_note` are overwritten from `EXCLUDED.*` on every call. So a
single-field save clobbers the others — e.g. toggling a "lyrics avenue tried" nulls the park
reason and the processing note; parking nulls a pending snooze and note. This is very likely why
a park "doesn't stick": park it, toggle an avenue, park is gone.

**Fix:**
- **Backend:** rewrite `setProcessing` to update only the fields actually provided (the same
  provided-fields-only pattern as #1), with explicit-clear support (`park_reason: ''` clears).
- **Frontend:** make the Park `<select>` controlled on `wb.processing.park_reason` (shows the
  current reason, with a "Not parked" option to clear) and the Remind date input controlled on
  `snooze_until`, so the parked state is visible at the point of action.

**Verification:** park a song as "Listened — unclear" → the active reason is visible on the
workbench without reloading; re-opening the song still shows it.

---

## #3 — Duplicate detector flags same-title / different-band 🟠

**Root cause (confirmed):** `backend/routes/admin.js` `calculateSimilarity()` scores title up
to 50, artist up to 30, duration up to 15, album 10, and flags pairs at score ≥ 60. An exact
title match (50) plus a coincidentally close duration (10) reaches 60 with **zero artist
agreement**, so two different bands sharing a title get grouped.

**Fix:** make artist agreement a **gate**, not a weighted addend — a pair is only a duplicate
candidate when normalised **title AND artist** both match (same conservative rule the 1.2/1.3
dedup used). Keep duration/album as tie-break/confidence signals, but never enough to flag
without artist agreement. Preserve the existing response shape
(`duplicateGroups`/`confidence`/`recommendedAction`) so the Data-quality UI is unchanged.

**Verification:** two same-title / different-artist rows no longer group; a real duplicate
(same title + same artist) still groups; endpoint response shape unchanged.

---

## #4 — Reach and fix any song by search (the song/1 wrong-video case) 🟡

**Root cause (confirmed):** `curation.js` `listCurationQueue()` always ANDs the search term
with a specific queue's `queueWhere(queue)` filter. There is no "search the whole catalogue"
scope, so a live/published song (e.g. song/1, which has a Rick Astley video instead of its
own) is only reachable by first knowing to look in the Live queue.

**Fix:**
- Add an **all-catalogue** search scope — a queue key (e.g. `'all'`) whose `queueWhere`
  imposes no status/queue restriction (all songs), reusing the same title/artist `ILIKE`
  search already in `listCurationQueue`. Wire it into the Songs-area search UI as an
  "All songs" scope so any result links straight to its workbench.
- **Data correction:** fix song/1's YouTube video to its real video (done through the now-
  reachable workbench Video panel, or a direct DB correction if cleaner — a data fix, not code).

**Verification:** search a live song by title under "All songs" → open its workbench → correct
the video → the public song page shows the right video; existing queue-scoped search is
unchanged.

---

## Locked decisions
- Clearing lyrics text **preserves** `source_url` + `translation` (no longer deletes the row).
- One combined round/branch; #1 lands first within it.
- Duplicate detection gates on **title AND artist**.

## Out of scope (later rounds)
Thematic `key_focus_pipeline` switch; browse/search polish (sidebar scroll, sort overlap,
bidirectional sort, analysis-dimension filters); featured-songs redesign + card chip/date
inconsistencies; About/AI-disclosure page; B4 Explore map + vector "You might also like".

## Dataset-safety note
Every change is curator-data-protective by construction: #1 and #2 both stop active data loss
(partial-update clobbering) and add tests proving preservation; #3 makes the detector more
conservative (fewer false merges); #4 adds a read path plus one manual data correction. No
migration; no bulk writes.
