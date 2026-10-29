# Playlist cross-check - design

Date: 2026-10-29. Status: draft for the curator's review. Tool 1 of 2 (tool 2, the Reddit-thread suggestion finder, is a separate brainstorm and is out of scope here).

## Intent

The curator finds other people's Spotify playlists and works through them to decide which songs belong in The Vegan Playlist. Today this is done by eye, which causes two problems: different versions of songs we already hold get added twice, and songs the curator already ruled out get re-examined every time they appear on another playlist. This tool lets the curator paste a playlist link, see every track classified against the catalogue, decide Import or Reject per track, and apply the whole batch in one action. Rejections are remembered so future playlists show them as already decided. Lyrics found while deciding are saved so they are never searched for twice.

## Goals

- Paste a Spotify playlist URL (or bare id) in the admin area; read its tracks with the existing client-credentials Spotify read (public playlists only).
- Classify each track against the whole catalogue (every status, not only live songs):
  - **Already have it**: the track's Spotify id belongs to a catalogue song. Show that song's status (live / included-unpublished / pending / rejected).
  - **Possible duplicate**: no id match, but the normalised title + first artist (`staging.normalizeName`, the same key the Spotify push and intake dedupe use) matches a catalogue song. Show the matching song so the curator can judge (other album, single, remaster, live version).
  - **New**: neither.
- Per-track choice **Import** or **Reject** on New and Possible-duplicate rows (mutually exclusive, with header "Import all new" / "Reject all new" shortcuts), applied in one action. Possible duplicates default to no choice (the curator opts in); New rows default to no choice too, so nothing is applied that was not chosen.
- **Import** inserts the track as a `pending` song (To be processed) through `staging.insertCandidates`, with a new origin tag **"From playlist cross-check"** (note convention like band check: `added via playlist cross-check (<playlist name>)`, mapped to origin `crosscheck` in `curation.js`'s queue origin CASE and shown as a tag in the queue).
- **Reject** saves the track as a `rejected` song row, exactly as the I2 catalogue check does (insert pending, flip to rejected among only the rows this apply created), so the song is never "New" again and later playlists show it as Already have it / rejected.
- Each row is compact: title, artist, album, a Play link (Spotify open link; the track's preview if Spotify supplies one), the classification, and the choice control. An **Add lyrics** control opens an inline space only on click, containing the existing "Search all lyric sites" link and a paste box. Pasted lyrics are held with the row and saved on apply for **either** choice, via `curation.saveLyrics`, so the junk-lyrics re-check runs as usual. Lyrics stay local only and are never returned by any read route. An imported song with lyrics skips Needs lyrics.
- Re-pasting the same playlist later is harmless: tracks already imported or rejected show as Already have it.

## Non-goals

- No Spotify writes, no playlist push, no changes to any existing catalogue song.
- No automatic import, no scheduling, no saved list of playlists, no history of past cross-checks (YAGNI; rejected rows are the memory).
- No private playlists or user sign-in (client-credentials read only).
- No new migration unless the builder finds the origin tag cannot be derived from `status_notes` (it can for band check; follow that).
- Not the Reddit/LLM tool.

## Anti-goals (a failure even if it technically works)

- Importing or rejecting anything the curator did not explicitly choose.
- Touching, overwriting or re-statusing an existing catalogue song (this puts the 650-song dataset at risk; the apply must only ever flip rows it created in the same call, as I2 does).
- A busy screen: the list must stay a compact table until the curator opens a row's lyrics.
- Lyrics ever leaving the machine (no SELECT of `song_lyrics` text in any API read; no commit).

## Constraints (from this codebase)

- Follow the band check / I2 pattern: a service (suggest `services/playlistCrosscheck.js`) with the Spotify read injected so tests never hit the network, routes under `/api/admin/` (header-authed), coded errors with fixed strings, one apply at a time (`BUSY`), cap per apply (suggest 100, as band check), `rejectKeys`/`importKeys` in neither-both validation (`BAD_INPUT`).
- Reuse `fetchPlaylistTracksLite` (or the full read if it lacks album/preview fields; builder's call) and `spotifyPush`'s title+first-artist keying; the "playlist track that is a distinct live catalogue song" nuance from `classify` is about the other direction and is not needed here.
- Nothing may log or rethrow a Spotify fetch error's message, URL or token.
- Tests: node:test, own sentinel prefix per file (e.g. `ZZZXCHK`), always serial-safe; frontend verified by lint, build and a real-browser check via the throwaway mock-harness approach (admin is login-gated; never type the admin password).
- Admin UI: a new item in the Songs area (curator prefers less chrome; no explanatory copy beyond usage help); styling from the design tokens only.
- Large playlists: read time and the 60s read cache pattern from `spotifyPush` apply; classify in memory against one catalogue query.

## Decided by the curator

- Input is a Spotify playlist link; comparison against the full existing catalogue including slight differences (same song, different album).
- Imports go to To be processed, tagged as from a playlist cross-check.
- Excluded songs are captured for future comparisons.
- Decision happens in the existing song-management tooling, per song, with a play/listen aid; lyrics can be searched and attached from the row, behind an "Add lyrics" control, in a compact list.

- **Possible duplicates allow both Import and Reject** (curator, 2026-10-29: "in case an identified duplicate isn't a real duplicate"). Import adds a second, separate song, so the builder adds an explicit force-insert option to the intake path (title|artist dedupe bypassed for these chosen rows only; Spotify-id dedupe still applies). Reject records that exact Spotify track as a `rejected` row so it is not offered again; a rejected twin with the same title and artist as a live song is acceptable (the catalogue already holds distinct versions).

## Calls made by the author (curator to check)

- Reject stores a `rejected` song row (the I2 mechanism) rather than a new table.
- Lyrics are saved on apply for both Import and Reject.
- No defaults ticked; possible duplicates need an explicit choice.
- Apply cap of 100 songs, one at a time.
- Origin tag name and note format mirror band check.

- Apply is **best effort per song, not one transaction**: each chosen track is inserted, then its lyrics saved; a lyrics failure never undoes the insert and is reported per song in the response (a skipped or failed row is listed with a reason, never silent). The cap of 100 counts chosen tracks.
- Apply **re-classifies server-side**: the client sends only Spotify ids (plus pasted lyrics keyed by id); the server re-reads the playlist (60s cache allowed) and takes titles/artists from Spotify, never from the client. A track that has become Already have it since the preview is skipped and reported.
- Local files / tracks with no Spotify id and unavailable tracks are **ignored**, with a count shown ("N tracks without a Spotify id ignored").
- A non-playlist or malformed link gives a plain "not a Spotify playlist link" error; a private playlist gives "couldn't read that playlist".

## Left to the builder

- Exact route names, component split, how the preview/play link is built, how to model "Already have it" display, paging of long playlists, error messages, and whether a track with multiple artists needs creating several artist rows (follow `insertCandidates`).
