# Sample source edit (short design)

Date: 2026-11-23. Status: approved in chat by the curator (plain-text source; hint of the AI's guess). Size: small change.

## Intent and why
Some audio samples (a quoted voice from a documentary, a speech) show "Unidentified source" on the song page because the
analysis was not HIGHLY confident who spoke. The curator can often tell. They want to add the source themselves so the
site names it. Why it matters: samples are a distinctive part of the catalogue, and an unnamed quote loses its meaning.

## Goals
- The curator can set, change and clear a source name on any sample that has a quote, from the workbench Audio panel.
- A saved source shows on the public song page (`— <source>`) exactly like a HIGH-confidence one, on songs whose samples
  the curator has approved (`songs.show_audio_samples IS TRUE`, unchanged).
- The analysis' lower-confidence guess is shown to the curator as a hint beside the box (admin only).

## Non-goals / anti-goals
- Never write to `song_audio_analysis` (the analysis project owns it; a re-run would overwrite it).
- No editing of the quote, description or timestamp. No link field (YAGNI; plain text, my call).
- The AI's guess must never become public unless the curator saves it.

## Constraints
- Server-side gating stays: the public block withholds samples unless approved; the overlay changes nothing about that.
- Web app is a read-only consumer of analysis tables; the new table is web-owned.

## Approaches
1. **New table `song_sample_sources`, overlaid when sample details are built (chosen).** Survives analysis re-runs while
   timestamps are unchanged; orphans are visible.
2. Write into `sample_details` JSONB. Rejected: breaks the read-only rule, wiped by the next run.
3. A per-song free-text note. Rejected: cannot attach to a specific sample.

## Design
- Migration `023_song_sample_sources.sql`: `song_id` (FK songs, ON DELETE CASCADE), `sample_type`, `timestamp` (TEXT,
  as the analysis wrote it), `source` (TEXT, trimmed, 1-200 chars), `updated_at`; PK (`song_id`, `sample_type`, `timestamp`).
- `services/audioAnalysis.js` `buildSamples`: a stored source for the item's (type, timestamp) wins and is served as
  `source` with `confirmed: true`; otherwise the HIGH rule applies as today. The admin read also carries `suggested`
  (the analysis' `speaker_or_source` when it is not HIGH) and a list of `orphans` (stored sources matching no item).
  The public block never carries `suggested` or `orphans`.
- Writer: `curation.setSampleSource(songId, {type, timestamp, source})` (empty source deletes the row); it validates that
  the song's latest OK analysis really has a sample with that type and timestamp (the client supplies no other data).
  Route `PUT /api/admin/workbench/:id/sample-source`, returns the reassembled workbench (like `setAudioSamples`).
- `AudioPanel.jsx` `SampleList`: each quoted sample gets an inline Add / Edit source box with Save and Clear, the hint
  as a small "AI guessed: X" line, and an orphan note if any.
- Tests: overlay beats HIGH/MEDIUM/none; clear restores the old behaviour; public block never has `suggested`/`orphans`;
  a sample not in the analysis is rejected; sentinel `ZZZSMS`.

## Left to the builder
Exact wording, styling (use existing `wb-audio-*` classes), and whether the timestamp key should be normalised
(`parseRange`) so "0:44-1:19" and "0:44–1:19" match. My call: match on the raw string, as the analysis writes it.
