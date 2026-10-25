# Sub-project I2 - Reject inside the catalogue check, and reviewed prompts

Date: 2026-10-25. Status: design approved in chat, spec awaiting curator review.
Follows I1 (Artists area, merged to `main` as `8872cb6`). Parent spec: `2026-10-24-I-artists-area-design.md` (section 3, I2).

## 1. Problem

In the artist workbench's Catalogue panel (Band check) the curator can only *add* songs as pending, then has to open each unwanted song in the song queues to reject it.
The curator's workflow is to work down the list, ticking songs to go to processing and songs that should be rejected, and finishing the artist in one pass.
Also, "Mark catalogue reviewed" is always offered and never guided, and an artist marked reviewed gives no signal when a later check finds new songs.

## 2. Agreed intent

- Rejecting a song from the list saves it as a `rejected` **song row** (decided in the I design: a visible record of how many songs were reviewed; blocks re-adding).
- Per-row choice, **two mutually exclusive checkboxes: Process and Reject**; untouched rows are left alone.
- Reviewed stays **manual and explicit** (never automatic), but is **prompted**: "Nothing new left. Mark catalogue reviewed?" and, for a reviewed artist, "N new since you marked this reviewed".

## 3. UI (frontend: `CatalogueReview.jsx`)

- Each *new* song row: checkbox **Process** and checkbox **Reject**; ticking one clears the other. Held / pending / rejected rows show no checkboxes (as now).
- Release header: **Process all new** and **Reject all new** (the existing "Select new" becomes "Process all new").
- Counts line: "Select all new" becomes **Process all new (N)** and **Reject all new (N)**.
- Footer button: **Apply: process P - reject R**, shown when P+R > 0. No confirm dialog (both outcomes are recoverable: a rejected song is an ordinary `rejected` row the curator can restore from its workbench).
- Result line: `Added A, rejected R` (plus the existing skipped / no-longer-listed counts); focus moves to the result as today. After an apply the catalogue is re-read, so applied songs show their held / rejected chip and "N new" falls.
- Reviewed prompts, using the live `counts.new` of the last read:
  - `counts.new === 0` and the artist is not marked reviewed: a line "Nothing new left." with a **Mark catalogue reviewed** button.
  - artist marked reviewed and `counts.new > 0`: a note "N new since you marked this reviewed." with a **Back to Needs catalogue check** button that clears the mark.
  - The existing toolbar toggle stays.
- Styling uses existing admin classes only; no new explanatory chrome.

## 4. Backend (`services/bandCheck/index.js`, route in `routes/admin.js`)

- `addSelected(db, artistId, keys, { adapters, rejectKeys })` - `rejectKeys` optional. Validation: each list must be an array of non-empty strings; `keys` and `rejectKeys` must not share a key (`BAD_INPUT`); `keys.length + rejectKeys.length` is 1..`MAX_ADD` (100). `keys` alone behaves exactly as before.
- Same live re-read as today; any failed source aborts everything before any write.
- Songs to reject are inserted through the **same inserters** as songs to process (`staging.insertCandidates` for Spotify-mapped songs, `staging.insertManualCandidate` otherwise), with note `rejected via band check (<name>)`, so the same duplicate checks apply (a rejected song cannot return as *new*). Then, in the same apply, **only the rows this apply just created** (matched by that unique note, and by `spotify_id` / returned `song_id`) are set to `status='rejected'`, `published=false`, `published_at=NULL`. An existing catalogue song is never touched.
- Process songs keep the current behaviour, including the Bandcamp play-link update.
- Return `{ added, rejected, skippedExisting, notFound }` (`rejected` = rows created and rejected by this apply). Route: `POST /api/admin/band-check/bands/:id/add` accepts `{ keys, rejectKeys }`.
- `counts.rejected` on the next read already counts these (they are `rejected` catalogue songs).
- Nothing may log or rethrow a fetch error's message, URL or token (unchanged rule).

## 5. Safety

- No migration. Writes are limited to songs created by this very apply; a failed source writes nothing; the one-add-at-a-time `BUSY` guard and the cap of 100 cover the combined list.
- Rejected songs are never public (`status='rejected'`, `published=false`).

## 6. Tests and verification

- Backend `node:test` (own sentinel): reject-only apply; mixed apply; a key in both lists is `BAD_INPUT` and writes nothing; combined cap; a rejected song is `rejected` and unpublished and reads as *rejected* (not *new*) on the next check; existing catalogue songs untouched; a failed source writes nothing; `keys` alone unchanged.
- Frontend: lint, build, and a real-Chrome pass through the throwaway mock harness (checkbox exclusivity, header and counts buttons, footer text, result line, both reviewed prompts, phone width, keyboard).
- Curator smoke on the real admin.

## 7. Out of scope (YAGNI)

Bulk restore of rejected songs; rejection reasons; automatic reviewed marking; a separate exclusions table.
