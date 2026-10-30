# Bandcamp lyrics fetch (and hiding the lyric-site buttons) - design

Date: 2026-10-30. Status: **draft for the curator's approval; nothing built.** This is piece 1 of a larger line of work agreed in the same brainstorm (see "Where this sits"). Brainstormed in chat with the curator; the decisions below are theirs unless marked **(my call)**.

## Why

Finding lyrics takes the curator longest when working through a band's songs, whether a band is already an artist or is a lead being assessed. They check Bandcamp, Genius, Google, Spotify and Metal Archives by hand and copy-paste each song. A read-only check on 2026-10-30 found Bandcamp track pages carry the artist's own lyrics in the page's embedded data: 12 of 12 catalogue songs sampled, and 27 of 63 tracks (about 43%, anywhere from 0% to 100% by band) across six randomly chosen artists. Metal Archives sits behind a Cloudflare challenge (403 on every page), so it stays a manual source. Genius and Spotify are not usable (earlier scraper produced error stubs; Spotify lyrics are licensed).

## What gets built

1. **Fetch for a whole band.** In the artist workbench, an action "Fetch lyrics from Bandcamp" runs for one artist. It uses that artist's confirmed Bandcamp link (`artists.bandcamp_url`, set in the Links panel). A link to the band page, an album or a song all work: the code reduces any `*.bandcamp.com` URL to the band's origin. It reads the band's catalogue exactly as Band check does (the `/music` page, then each release page's tracklist with per-song URLs), matches Bandcamp tracks to the artist's songs by normalised title (reuse Band check's `keyOf`), then opens each matched song page and reads the lyrics. A progress indicator shows while it runs. When it finishes, the curator sees the **complete list to review**: one row per song with the lyrics found, to **Save** or skip individually. Nothing is saved until the curator saves it.
2. **Fetch for one song.** In the song's Lyrics panel, a "Fetch from Bandcamp" button comes first; the broader search stays one click away as the fallback. It uses the same service for one song and shows the lyrics for review before saving.
3. **Hide the lyric-site list.** The Lyrics panel currently shows "Search the web for lyrics", "Listed lyric sites only", "or one site:" and a long row of per-site buttons plus YouTube. Keep "Search the web for lyrics" visible; put the per-site buttons and the "Listed lyric sites only" button behind a "More sites" toggle, collapsed by default. Opening a site still marks its avenue tried as today.

## Behaviour (the curator's decisions)

- Whole band at once, not song by song; progress indicator, then the full list to review.
- Review before save: fetched lyrics are never written without the curator pressing Save.
- Fetch first, broader search second. When Bandcamp has nothing, the existing search stays available.

## Behaviour (my calls, change if wrong)

- **Which songs:** the artist's songs that have **no lyrics saved** (any status except rejected). A song with lyrics is never overwritten. **(my call)**
- **Matching:** by normalised title only against that band's own Bandcamp catalogue. Where a Bandcamp track page names a different artist than ours (a label or compilation page), the track is skipped, not matched. Songs with no match are listed as "not found on Bandcamp". Bandcamp tracks with no matching song are ignored. **(my call)**
- **What Save does:** saves through the existing `curation.saveLyrics`, with `source_url` = the Bandcamp song page and `lyrics_source` = "Bandcamp"; the existing junk-lyrics re-check runs as it does for any save. **(my call)**
- **Already-limited reader:** inherits Band check's limits: 40 releases (the screen says when a catalogue was cut short), `*.bandcamp.com` only (a custom domain gets a plain "can't read this Bandcamp link" message), redirects stay on the band's own subdomain, requests spaced about 250-400 ms. One run at a time. **(my call)**
- **No Bandcamp link on the artist:** the action explains that a Bandcamp link is needed in the Links panel; it does not search for or guess a link, and never uses another band's page.
- **Failure messages are fixed strings.** Nothing logs or rethrows a fetch error's message or URL, as with the other adapters.

## Settled after the builder check (all my calls)

- **Eligible songs:** a song counts as having no lyrics exactly as `curation.HAS_LYRICS_SQL` does: no lyric text, or lyrics flagged junk (`junk_kind` set). So a junk-flagged song is eligible, and Save replaces the junk (the same thing "Clear lyrics" does). Real lyrics are never overwritten.
- **Where the results wait:** in a server-side in-memory job (one at a time). The status poll reports progress, and once finished it returns the results for review. Nothing is written to the database or disk until Save. A server restart or a long idle loses the run; the curator just runs it again.
- **Save guard:** Save re-checks on the server and refuses with a clear message if the song now has real lyrics (e.g. pasted by hand in the meantime). It then calls `saveLyrics` as-is.
- **Single-song fetch:** if the song has its own Bandcamp song link (`songs.bandcamp_url`, 92 songs today), read that one page directly. Otherwise read the artist's catalogue once and match, which takes longer, so it shows the same progress indicator.
- **Different artist:** compare the track page's credited artist with the song's artist names (any of them) and the artist's own name, ignoring case, accents and punctuation; a match in either direction by containment counts. Anything else is skipped and listed as "not matched (Bandcamp credits a different artist)" so it is visible, never silently dropped.
- **Ambiguous titles:** if two Bandcamp tracks share a normalised title (live, demo, studio), the song is not matched and is listed as "more than one match". The curator can use the single-song button or paste.
- **Cut-short catalogue:** when the 40-release cap applies, unmatched songs read "not found (catalogue was cut short)".

## Constraints

- Lyrics are local only (copyright): never returned by any public route, never committed, never in production dumps. The fetch result goes to the admin response only, and the saved lyrics go to `song_lyrics`, same as a manual paste.
- No schema change is expected; the 650-song catalogue is only touched when the curator presses Save on a lyrics row.
- No paid service, no new frontend dependency.
- Admin routes use `adminFetch` and the password header; nothing hardcodes `localhost:5000`.
- Tests: Bandcamp fetch is injected as in `test/bandCheck*.test.js`, so tests never touch the network; give the new test file its own fixture sentinel.

## Non-goals

- Metal Archives, Genius, Spotify or any other automated source.
- Searching for or confirming a band's Bandcamp page (Band check's identity flow already does that).
- Saving lyrics without review, or analysing the lyrics.
- The Leads queue itself (piece 3), artist facts (piece 2) and the Claude Code skills (piece 4).

## Anti-goals (would make it a failure even if it works)

- Overwriting existing lyrics.
- Saving a different band's lyrics because of a title coincidence.
- Hammering Bandcamp.

## Left to the builder

- How progress reaches the screen (a started-job-and-poll shape or similar; no websockets), and where the buttons sit in the artist workbench.
- The exact review-list layout, following the existing admin styles.
- How to read the lyrics from a song page (the 2026-10-30 check found them in the page's embedded JSON-LD `recordingOf.lyrics.text`, mirrored in a visible lyrics block; prefer the embedded data).

## Where this sits

Order agreed with the curator: (1) this; (2) **Artist facts** (country, year formed, active status, members with a "vegan" mark, each with a source; LLM may only *propose* values and the curator checks them; shown on the public artist page, each element hidden when empty, hero line "Germany · Formed 2009 · Active, last release 2024" and a plain members line under the Biography with a small circled-V mark for vegan members); (3) **Leads queue** in the Artists area; (4) the Claude Code skills (Reddit-thread extractor, artist-facts proposer). Each gets its own design.
