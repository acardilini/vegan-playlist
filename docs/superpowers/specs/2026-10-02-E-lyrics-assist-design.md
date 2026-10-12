# Sub-project E — Lyrics-search assist, transcription queue, lyrics shelf

_Date: 2026-10-02 · Status: spec, revised 2026-10-12 (Brave rejected; Part 1 is link-building only) · Branch: `session-E-lyrics-assist`_

## 1. Purpose and success

Finding lyrics is the slowest step in processing a song, and many songs are obscure. E should:

1. **Cut the time spent hunting.** One click opens a single search covering many lyric sites, plus per-site
   links and tried-ticks (curator: the time goes on *opening many sites*).
2. **Give a failed hunt a clear outcome** instead of a vague pending song: a **To transcribe** queue for songs
   the curator could transcribe by ear, and a **Lyrics on hold** shelf for songs whose lyrics can't be found or
   heard, kept out of the processing queues but open to lyrics arriving later (an album booklet, the community).

Success: from a song's Lyrics panel the curator can search all listed lyric sites in one click, and send a song to *To transcribe* or *Lyrics on hold* in one step, and neither queue clutters
*To be processed* or *Needs lyrics*.

**Curator decisions this spec encodes** (2026-10-02): search links only (revised 2026-10-12: no paid API, no results preview), **no scraping or fetching
of lyric text**; *To transcribe* is its own
queue; a song with no obtainable lyrics is decided case by case (some are clearly in, some need lyrics to decide)
and sits on a shelf that doesn't clog processing.

## 2. What already exists (built in sub-project A, reused as-is)

`songs.lyrics_status` (`found`/`not_found`/`not_searched`), `song_processing.lyrics_tried` (avenues ticked),
`song_processing.park_reason` (`awaiting_community`, `needs_transcription`, `listened_unclear`; the CHECK
constraint already allows all three), the Lyrics panel's four quick-search links, the Notes panel, and the
`awaiting-community` queue. **No migration is needed.**

## 3. Part 1 - Lyric-site search (no API, no cost)

**Curator decision 2026-10-12: no paid search provider (Brave is rejected).** Part 1 is therefore link-building
only: no backend, no key, no fetched results, nothing stored. Inline hit previews are dropped.

- A shared constant `LYRIC_SITES` (frontend, one array of `{ key, name, host, searchUrl(q) | null }`) names the
  sites: genius.com, azlyrics.com, lyrics.com, musixmatch.com, letras.com, lyricstranslate.com, darklyrics.com,
  lyricsfreak.com, bandcamp.com, plus genre sites the curator names. Editing the list is a one-line change.
- **Search all lyric sites** button in `LyricsPanel.jsx`: opens ONE new tab on a Google query of the form
  `"title" "first artist" lyrics (site:a OR site:b ...)`. One tab covers every listed site, which is the time
  saving (no opening many sites to look). The existing four quick links stay.
- A **per-site row** beneath it: each site name links to that site's own search (or to the same Google query
  restricted to that single `site:` where the site has no usable search URL), with a tick that sets the matching
  `lyrics_tried` avenue. Ticking is manual and the existing avenue ticks stay as they are.
- **Use as source:** the curator pastes the lyrics page URL into the existing `lyrics_url` field; E adds nothing
  beyond a small "source site" suggestion derived from that URL's hostname into `lyrics_source` if it is empty.
- First-listed artist only, as `findCandidatesForSong` does (collaboration names defeated the search there).
- Tests: a pure `lyricsSearchUrls` module (query building, quoting/escaping, site OR-list, hostname to source
  name) under `node --test`. Nothing hits the network.
- Not built (YAGNI): result preview, match scoring, quota handling, provider abstraction.

## 4. Part 2 — Not found, transcription, and the shelf

### 4.1 The Lyrics panel's "can't find them" actions (any song status)

Today the park control exists only in the top bar and only for pending songs. A new row in the Lyrics panel,
available for **pending and included** songs, offers:

- **Mark lyrics not found** (`lyrics_status = not_found`; implied by the two actions below).
- **Could transcribe by ear** → `park_reason = needs_transcription`.
- **Put on hold** → `park_reason = awaiting_community` ("crowd-source") or `listened_unclear`
  ("can't make them out"); the Notes panel records *how* they'll be obtained later (booklet, community).
- **Clear** → `park_reason = null`.

### 4.2 Queue changes (`services/curation.js` `queueWhere`)

| Queue | Definition |
|---|---|
| `to-process` | unchanged, plus `park_reason` is none of the three lyric reasons |
| `to-transcribe` (**new**, rail label *To transcribe*) | `park_reason = 'needs_transcription'`, status pending or included, and no lyrics yet |
| `lyrics-on-hold` (**replaces** `awaiting-community`, label *Lyrics on hold*) | `park_reason IN ('awaiting_community','listened_unclear')`, status pending or included, no lyrics yet |
| `needs-lyrics` | unchanged, plus `park_reason` is none of the three, so shelved songs stop clogging it |

Rail: **Parked** gains *To transcribe* and renames *Awaiting community* to *Lyrics on hold*. Queue counts come
from the same single function as every other queue (the existing counts path), so they cannot disagree with the
lists. The rename touches `QueueRail`, `SongQueueList`, `SongsArea`, `NotesPanel`, `WorkbenchTopBar` and the
`curation.test.js` expectations.

### 4.3 Leaving a queue by adding lyrics

`saveLyrics`, when given **non-empty `lyrics`**, in the same transaction:
- sets `lyrics_status = 'found'` unless the caller passed one;
- clears `park_reason` if it is one of the three lyric reasons (the song re-enters normal processing);
- if the prior `park_reason` was `needs_transcription` and no `lyrics_source` was passed, sets
  `lyrics_source = 'Transcribed by curator'`.

**To verify in the plan:** where `songs.lyrics_source` / `lyrics_url` surface on the public song page, so the
transcription label reads sensibly there (and is not shown as a link to nothing).

### 4.4 Songs with no obtainable lyrics

Handled by the existing include/reject controls, unchanged: the curator may include and publish a song with no
lyrics (no lyrics section, no analysis, shown as such), or reject it. Shelved songs keep whatever `status` they
have; the shelf is orthogonal to status, like `published`.

## 5. Out of scope

Fetching or scraping lyric text; lyrics-API integrations; a quota dashboard; any public-page change; the
**no-video-available option** and the **band/album catalogue checker** (separate sub-projects, logged in
`PROJECT_STATE.md`).

## 6. Testing and verification

- `test/lyricsSearch.test.js` (node:test, injected `fetch`, **unique fixture prefix** per the per-file
  sentinel rule): query building, `match` classification, ordering, each error code mapping, and that no error
  message or log contains a URL or key.
- `test/curation.test.js`: the four queue definitions above including the `to-process`/`needs-lyrics`
  exclusions; counts equal list lengths; `saveLyrics` clearing and the transcription source label.
- Browser smoke (Chrome tools, with the curator logged in): the search-all link and a per-site link open the
  right URLs, mark to-transcribe then save lyrics and watch the song leave the queue, shelve a song, and a
  390px layout check. Smoke edits must restore any song they touch.
- Gates as always: backend tests, lint 0 errors, clean build; a fresh whole-branch review before merge.
