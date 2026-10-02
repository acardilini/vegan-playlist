# Sub-project E — Lyrics-search assist, transcription queue, lyrics shelf

_Date: 2026-10-02 · Status: spec, awaiting curator review · Branch: `session-E-lyrics-assist`_

## 1. Purpose and success

Finding lyrics is the slowest step in processing a song, and many songs are obscure. E should:

1. **Cut the time spent hunting.** One action searches many lyric sites and shows the hits inline, so the
   curator opens only the likely ones (curator: the time goes on *opening many sites* and *judging results*).
2. **Give a failed hunt a clear outcome** instead of a vague pending song: a **To transcribe** queue for songs
   the curator could transcribe by ear, and a **Lyrics on hold** shelf for songs whose lyrics can't be found or
   heard, kept out of the processing queues but open to lyrics arriving later (an album booklet, the community).

Success: from a song's Lyrics panel the curator can search lyric sites in one click, take a hit as the source in
one click, and send a song to *To transcribe* or *Lyrics on hold* in one step, and neither queue clutters
*To be processed* or *Needs lyrics*.

**Curator decisions this spec encodes** (2026-10-02): search-links-plus-results-preview, **no scraping or fetching
of lyric text**; the search source is a web-search API restricted to lyric sites; *To transcribe* is its own
queue; a song with no obtainable lyrics is decided case by case (some are clearly in, some need lyrics to decide)
and sits on a shelf that doesn't clog processing.

## 2. What already exists (built in sub-project A, reused as-is)

`songs.lyrics_status` (`found`/`not_found`/`not_searched`), `song_processing.lyrics_tried` (avenues ticked),
`song_processing.park_reason` (`awaiting_community`, `needs_transcription`, `listened_unclear`; the CHECK
constraint already allows all three), the Lyrics panel's four quick-search links, the Notes panel, and the
`awaiting-community` queue. **No migration is needed.**

## 3. Part 1 — Lyric-site search

### 3.1 Backend: `services/lyricsSearch.js` (new, mirrors `youtubeSearch.js`)

- `searchLyricSites({ title, artists, apiKey, fetch })` → `{ query, hits: [{ url, title, snippet, site, match }] }`.
- Query: the title and first-listed artist in quotes plus `lyrics`, ORed with `site:` terms for a **named
  constant list** `LYRIC_SITES` (genius.com, azlyrics.com, lyrics.com, musixmatch.com, letras.com,
  lyricstranslate.com, darklyrics.com, lyricsfreak.com, bandcamp.com, plus further genre sites the curator
  names). Editing the list is a one-line change.
- `match` is `both` / `title` / `none`, set when the hit's title+snippet contain the song title and the first
  artist (case-insensitive, punctuation-insensitive). It is a **hint to speed judging**, not a filter: `none`
  hits are shown, sorted last.
- `site` is the hit's hostname with `www.` stripped, mapped to a display name.
- **Provider: Brave Search API** (`GET https://api.search.brave.com/res/v1/web/search`, key in the
  `X-Subscription-Token` **header**, so unlike YouTube the key is never in a URL). The provider call is one small
  function in this file, so swapping providers touches nothing else. `fetch` is injected; tests never touch the
  network.
- **Errors carry only an HTTP status and a code, never a URL, request header or error `.cause`:** `QUOTA`
  (429), `CONFIG` (401/403, 502 with a fix-the-key message), `UPSTREAM` (502); an unset key is `CONFIG`
  and disables the button.

### 3.2 Route

`GET /api/admin/workbench/:id/lyrics-search` (behind the admin middleware). Reads the song's title and
first-listed artist (lowest `song_artists.id`, exactly as `findCandidatesForSong` does) and returns the hits.
**Never reads `song_lyrics`.**

### 3.3 Frontend: `LyricsPanel.jsx`

- A **Search lyric sites** button (the four existing quick links stay beside it as the offline fallback).
- Results list: site, title, snippet, **Open ↗** (new tab), and **Use as source**, which saves the hit's URL to
  `lyrics_url` and its display name to `lyrics_source` via the existing `savePanel('lyrics', …)`, and ticks the
  matching avenue in `lyrics_tried` (`genius`, `bandcamp`, otherwise `genre_site`). The curator still pastes the
  lyrics themselves.
- Empty result: "No hits on the lyric sites for *query*" plus a link that runs the same search unrestricted on
  Google. `CONFIG`/`QUOTA` show a plain message and leave the quick links usable.
- A stale-song guard (results for song A never render on song B), as in the D picker.

### 3.4 Cost and a provider caveat (verified 2026-10-02, from public sources, **re-check at sign-up**)

- Brave removed its free tier for new users in February 2026; new accounts get **$5 of monthly credit, about
  1,000 searches**, and the credit is reported to depend on publicly attributing Brave. One curator working one
  song at a time is far under that.
- Google's Programmable Search JSON API is **closed to new customers and discontinued 1 January 2027**, so it is
  not a viable alternative.
- **Decision needed from the curator before the plan starts:** is the Brave sign-up (account, probably a card on
  file for overage, and an attribution line on the About page) acceptable? **If not, E ships parts 2 and 3 only**
  and the existing quick links remain the search; nothing else in this spec depends on part 1.

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
- Browser smoke (Chrome tools, with the curator logged in): search with the real key (one real search),
  Use-as-source, mark to-transcribe then save lyrics and watch the song leave the queue, shelve a song, and a
  390px layout check. Smoke edits must restore any song they touch.
- Gates as always: backend tests, lint 0 errors, clean build; a fresh whole-branch review before merge.
