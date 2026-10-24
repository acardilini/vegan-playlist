# Sub-project I - Artists area (artist processing like songs)

Date: 2026-10-24. Status: design approved in chat, spec awaiting curator review.

## 1. Problem

The admin Artists page (`ArtistsManager.jsx`) and Songs > Band check grew separately and overlap:

- The page header is cramped (stat cards, title not fitting).
- **Search is broken** ("Failed to fetch artists"): `GET /api/admin/all-artists` reuses the list query's `WHERE` clause (which has a `$3` placeholder) in the count query but passes only the search value, so any search fails. Without a search it works.
- "Discography reviewed", "Need review" and "With advocacy notes" have no processing approach.
- Band check cannot record that a song was deliberately left out unless a song row already exists.
- A Bandcamp URL entered in Band check (`artists.bandcamp_url`) does not appear in artist management, which only edits `website_url`; `PUT /artists/:id` ignores the identity fields.

## 2. Agreed intent

- **Discography reviewed means** "I have checked this band's catalogue and added everything that belongs" - owned by Band check, not a free-floating checkbox.
- **Excluding a song** = saving it as a `rejected` song row (existing status). Never public; blocks re-adding; the rejected count doubles as the record of songs reviewed.
- **One Artists workbench** (rail + workbench, like Songs). Band check's list becomes its queue; the Identify card becomes its Links panel; `ArtistsManager` is retired.
- **Bio and advocacy notes are hand-written** (public content: shown on the artist page, searched publicly), processed through queues, with an explicit "no advocacy notes needed" mark.
- **Bandcamp and Website stay distinct fields** (`bandcamp_url` is Band check identity; `website_url` is the public own-site link). Both are editable in the Links panel; the public artist page shows them as separate buttons.

## 3. Phasing

- **I1 - Artists area.** Search fix, queues, workbench (Details, Links, Catalogue = existing Band check, Notes), retire `ArtistsManager`, Songs > Band check redirects, public page shows both buttons.
- **I2 - Review and exclude.** Exclude in Band check, Mark catalogue reviewed, "N new since reviewed", bio/advocacy queues complete with the none-needed mark.
- I2 follows I1 after the curator's smoke. Each gets its own plan.
- **Deviation recorded at plan time:** the bio / advocacy-notes queues and the none-needed mark (with migration 015) landed in I1, because the queue predicates need the column; the Mark catalogue reviewed / Clear toggle is also in I1 (always offered). I2 is Exclude in Band check and the "N new since reviewed" prompt.

## 4. Data (migration 015, additive, idempotent)

- Reuse `discography_reviewed`, `discography_reviewed_date`, `discography_review_notes`.
- Add `artists.no_advocacy_notes_needed BOOLEAN NOT NULL DEFAULT false`.
- No new table; excluded songs are `rejected` rows created via the staging service, origin tag `bandcheck`.

## 5. Backend

- Fix `/all-artists`: build the filter once as `{where, params}` and use it for both list and count; test with a search term (regression for the bug above).
- `GET /api/admin/artists/queues` (counts) and a list endpoint taking queue, search, page. Queues:
  - *Needs identity* - none of spotify_id / bandcamp_url / musicbrainz_id set.
  - *Needs catalogue check* - `discography_reviewed` false.
  - *Needs bio* - bio blank.
  - *Needs advocacy notes* - notes blank and not marked none-needed.
  - *Done* - none of the above.
  Queue predicates live in one place and the counts and lists share them, so they cannot disagree.
- `PUT /artists/:id` accepts `bandcamp_url` and `no_advocacy_notes_needed`; Spotify and MusicBrainz identity keep a single writer (`bandCheck.saveIdentity`).
- I2: `POST /api/admin/band-check/exclude` inserts the selected songs as rejected through staging (same transaction, dedupe and `BUSY`/cap rules as add). Rejected songs then classify as *rejected*, not *new*.
- I2: *Mark catalogue reviewed* is an explicit action (never automatic), offered when no *new* songs remain. A later check finding new songs shows "N new since reviewed" and offers to clear the mark.
- Existing rule kept: nothing logs or rethrows a fetch error's message, URL or token.

## 6. Frontend

- New admin **Artists** area (top-bar nav, per the curator's preference) with the Songs rail/workbench pattern; queue counts replace the stat-card header.
- Workbench panels: Details (name, bio, advocacy notes + none-needed mark, genres), Links (Spotify / Bandcamp / MusicBrainz identity, Website), Catalogue (Band check review), Notes (review notes).
- Songs > Band check redirects into the Artists area; `ArtistsManager` and its `App.css` blocks are deleted.
- Styling uses the design tokens and admin-standard classes; no new explanatory chrome.

## 7. Safety and verification

- Migration is additive; nothing deletes rows; the 650-song dataset is untouched. Artist writes touch artist fields only; Band check writes only pending/rejected songs.
- Backend `node:test` per file with its own fixture prefix: queue predicates vs counts, search + count, update fields, exclude, reviewed. Frontend: lint, build, and a Chrome pass through the mock harness (the admin is password-gated; never type `ADMIN_PASSWORD`).
- Smoke at the end of each sub-project, per the End-Session guide.

## 8. Out of scope (YAGNI)

Generated or prefilled bios; automatic reviewed marking; bulk artist merge; per-song "excluded" separate from `rejected`.
