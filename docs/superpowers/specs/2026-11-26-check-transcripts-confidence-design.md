# Check transcripts: confidence details, sort and filter (short design)

**Status:** approved by the curator in chat on 2026-11-26 (including "UNINTELLIGIBLE in All"). Small change; branch `session-check-transcripts` from `main`, independent of the artist admin work.

## Intent and why
The analysis project now scores every AI draft transcript (`song_audio_transcripts`: `confidence_score` 0-100, `estimated_word_accuracy_pct`, `audio_clarity`, `inaudible_segments`, `confidence_notes`; handoff `docs/MAIN_PROJECT_LYRIC_V2_HANDOFF.md`). The curator wants to approve the cleanest drafts first and spend little time on patchy ones, so the **Check transcripts** rail must show these details, sort by confidence and filter by tier.

## Goals / non-goals / anti-goals
- Goals: show confidence in each rail row and in the draft panel; sort best-first or worst-first; filter All / HIGH / MEDIUM / LOW / UNINTELLIGIBLE; nothing silently hidden.
- Non-goals: any change to how a draft becomes lyrics (still edit, then `saveLyrics`); no new tables or migration; no counts on the filter options; the language-suggestion path stays OK-only.
- Anti-goals: transcript text reaching a list response or any public route; a sort that buries unscored clean drafts.

## Findings that shaped it (live data, read-only)
- 622 rows: 570 OK, 52 UNINTELLIGIBLE (all 52 have text, mostly `[inaudible]`). The rail today needs `status = 'OK'`, so those 52 are hidden; the rail has 496 songs, 548 with them.
- Score bands per tier do not overlap (HIGH 82-99, MEDIUM 55-79, LOW 20-49; UNINTELLIGIBLE 0-25). 91 older spoken-word rows have no score (77 of them HIGH), so `score DESC NULLS LAST` alone would sink clean HIGH drafts below every scored LOW.
- One transcript row per song today (no song has two), but the key is (`song_id`, `model_used`), so the newest usable row is chosen.

## Approaches considered
1. **Sort by score only** (the analysis agent's literal ask): simple, but buries unscored HIGH drafts. Rejected.
2. **Tier first, then score** (chosen): matches the score bands, keeps unscored rows inside their own tier.
3. A separate "tier counts" endpoint for the filter: not needed now (YAGNI).

## Design
**Backend (`services/curation.js`, the only file that may name `song_audio_transcripts`):**
- A draft is a row with status `OK` or `UNINTELLIGIBLE` and non-blank text, for `HAS_DRAFT_SQL`, the `check-transcripts` queue and `draftTranscript` (newest by `transcribed_at`). So the queue and its Dashboard tile count include the 52. `needs-lyrics` and `to-transcribe` are unchanged.
- Tier = `UNINTELLIGIBLE` when the row's status is `UNINTELLIGIBLE`, else its `confidence`. Tier rank HIGH 3, MEDIUM 2, LOW 1, UNINTELLIGIBLE 0.
- `listCurationQueue` takes `sort` (`best` | `worst`) and `tier`, valid only for `check-transcripts` (otherwise `BAD_QUEUE` / 400, like `pair`). Order for `best`: tier rank desc, then `COALESCE(confidence_score, tier midpoint)` desc (midpoints HIGH 90, MEDIUM 67, LOW 35, UNINTELLIGIBLE 10; my call, only used to place unscored rows), then `s.id`; `worst` reverses it. With no `sort` the order stays `s.id`. Applied in SQL before `LIMIT`, so paging is right; the workbench Prev/Next follows the sorted ids.
- For that queue each row carries `transcript: { tier, confidence, confidence_score, estimated_word_accuracy_pct, audio_clarity, inaudible_segments }` and **never** transcript text or notes.
- `getWorkbench.draft_transcript` adds `status`, `tier`, the same five fields and `confidence_notes`. Null fields stay null.
- Route `GET /api/admin/curation/queue` passes `sort` and `tier` through.

**Frontend:**
- Pure, node-tested `utils/transcriptConfidence.js`: tier, badge text (`HIGH · 95/100`, or just `HIGH` when the score is null), tone class, clarity label (`Clear`, `Moderate`, `Muddy / Buried`, `Extreme / Unintelligible`), pills (`~95% words`, `6 [inaudible]` only when > 0, nothing for null fields).
- `SongQueueList`: for `check-transcripts` only, a sort select (**Highest confidence first** is the UI default, **Lowest** the other) and a tier select (All, HIGH, MEDIUM, LOW, UNINTELLIGIBLE); both reset page to 0; each row shows the badge and pills as small tags.
- `DraftTranscript`: the same badge and pills, `confidence_notes` as a short note above the textarea, and a clear warning for UNINTELLIGIBLE (Save as lyrics stays available; the curator decides).
- Colours: green for HIGH, amber for MEDIUM, red for LOW and UNINTELLIGIBLE, from existing design tokens only.

**Privacy and tests:** `lyrics_privacy.test.js` must still pass (only `curation.js` names the table). New backend test (sentinel `ZZZCKT`, fixture transcript rows deleted with their songs) covers: the 52-style UNINTELLIGIBLE row is in the queue and has a tier; sort best/worst order including an unscored HIGH row sitting above a scored LOW; tier filter; bad `sort`/`tier`/wrong queue is 400; list rows carry no text; the draft carries the new fields. Frontend node tests for the helper.

## Left to the builder
Exact CSS class names and token choice for the three tones; select labels' wording beyond the above; whether the lateral join or a subquery picks the newest row.

## Docs to update when built
`PROJECT_STATE.md` (Current State, Changelog, a Decision Log line for tier-first ordering and UNINTELLIGIBLE in All), `CLAUDE.md` (the `curation.js` draft-transcript description).
