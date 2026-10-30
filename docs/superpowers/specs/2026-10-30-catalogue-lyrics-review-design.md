# Lyrics inside the Catalogue review - design

Date: 2026-10-30. Status: **draft for the curator's approval; nothing built.** A follow-up to the Bandcamp lyrics fetch (`2026-10-30-bandcamp-lyrics-fetch-design.md`, built on branch `session-bandcamp-lyrics`, being smoked by the curator, not yet merged). Decisions are the curator's unless marked **(my call)**.

## Why

When the curator reviews a band's catalogue (artist workbench > Catalogue panel, Process or Reject per new song) they judge by **title only**, because looking up lyrics song by song is slow; lyrics get read much later in Needs lyrics. They want to decide on the lyrics during the review. The Bandcamp lyrics fetch (a separate panel at the bottom of the artist workbench, "right down the bottom if there are lots of songs") already reads lyrics from a band's Bandcamp song pages, but it only works on songs that are already in the database, so it cannot help with the new songs being reviewed.

## What gets built

1. **One fetch button in the Catalogue panel**, "Fetch lyrics", with a progress bar (as in the existing fetch). It fetches lyrics for:
   - every **new** catalogue song that is listed on Bandcamp (it already carries its Bandcamp song-page link in the merged catalogue), and
   - every **held** song (already in the database, any status except rejected) that has no real lyrics.
2. **A lyrics chip on each of those rows** (design option A, chosen from mockups): "lyrics found" or "no lyrics found".
   - "lyrics found": a **Read** button opens the lyrics in place under the row (collapsed by default so the list stays compact).
   - "no lyrics found": an **Add lyrics** button opens a paste box under the row.
   - Songs not listed on Bandcamp (Spotify/MusicBrainz only) read "no lyrics found" with the same paste box; no request is made for them.
3. **Saving.**
   - **New songs:** fetched or pasted lyrics are saved **when the curator presses Apply**, for both Process and Reject (the playlist cross-check already works this way), onto the song row Apply creates. Nothing is saved before Apply.
   - **Held songs (already in the database):** Apply does not touch them, so their lyrics row carries its own **Save lyrics** button; it saves immediately through the existing guarded save.
4. **Remove the separate "Lyrics from Bandcamp" panel** from the artist workbench; its job moves here. The song-level "Fetch from Bandcamp" button in the song Lyrics panel and the "More sites" toggle stay as they are. The backend routes for the artist run may be reshaped or removed as the builder sees fit, provided the song-level fetch keeps working.

## Behaviour (my calls)

- **Server derives the Bandcamp URLs.** The fetch takes only the artist and song keys from the client; the server uses its own (5-minute cached) catalogue read to find each song's Bandcamp URL, as `addSelected` already does. The client never supplies a URL to fetch.
- **Matching and safety rules are unchanged** from the Bandcamp lyrics fetch design: a track credited to a different artist is skipped, same-title tracks are ambiguous, one run at a time (`BUSY`), runs live in memory only, fixed-string errors, nothing logs lyrics or URLs, requests spaced about 300 ms. A song on Bandcamp whose page has no lyrics reads "no lyrics found", same as one that is not on Bandcamp.
- **Pasted lyrics** are held in the browser until Apply (new songs) or saved on the row's Save button (held songs); a pasted text wins over a fetched one for the same song.
- **Apply** sends the chosen lyrics along with the keys it already sends; the server validates and saves them through `curation.saveLyrics` with `lyrics_source` "Bandcamp" for fetched text and "Added by curator" **(my call, check the existing label wording)** for pasted text, and never overwrites a song that already has real lyrics. A failure saving one song's lyrics must not undo the songs Apply created; report the song and carry on (same best-effort behaviour as the cross-check).
- **Request size:** pasted lyrics for up to 100 songs must not hit the body limit (the cross-check's 5 MB limit already covers this).

## Constraints

- Lyrics are local only (copyright): never returned by a public route, never committed, never logged.
- The Band check Process/Reject flow, its caps (100 per apply) and its reject-flip safety (only rows this call created) stay intact; fetching lyrics must never change which songs get added or rejected.
- No paid service, no new frontend dependency, no schema change.
- Tests inject the Bandcamp fetch (no network) and give any new test file its own fixture sentinel.

## Non-goals

- Other lyric sources (Genius, Spotify; Metal Archives is Cloudflare-blocked), or fetching lyrics for songs outside this band's catalogue view.
- Judging relevance for the curator, or any LLM step.
- Changing the songs' own Lyrics panel beyond what is already built.

## Anti-goals (a failure even if it works)

- Saving lyrics the curator did not see, or overwriting existing real lyrics.
- Saving another band's lyrics because of a title coincidence.
- A catalogue review that gets slower or less scannable for songs where nobody asks for lyrics (the chips stay small; text is collapsed by default).

## Left to the builder

- Whether the existing artist-run service is extended or replaced by a catalogue-keyed run, and the exact request/response shapes.
- How Apply carries lyrics (e.g. by song key) and how the new rows' ids are mapped back to keys.
- Where the paste text is held and how the review state survives a Refresh of the catalogue (a re-read must not silently drop pasted text; flag it if it would).
- Exact placement of the fetch button and chips within the existing panel layout.
