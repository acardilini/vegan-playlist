# Platform links: Deezer, Apple Music (and Tidal later) on the song page (short design)

**Status:** approved by the curator in chat on 2026-11-26 (platforms: Spotify, Apple Music, Deezer, Tidal later; YouTube left out because the page already shows the videos; no logos; **Apple matches are confirmed one by one**). Branch `session-platform-links` from `main`.

## Intent and why
A prospective user said they do not use Spotify and asked for other platforms. Today the song page leads with the artist's own site, then SoundCloud, then a large "Open in Spotify" button. The curator wants small buttons per platform instead.

## Goals / non-goals / anti-goals
- Goals: a "Listen on" row of small **text** buttons (Spotify, Apple Music, Deezer, Tidal when it exists); links found by a click-only admin run; nothing wrong reaches the public page.
- Non-goals: logos (no licensing); YouTube Music; Tidal matching now (needs the curator's own developer registration; the table and page take it with no change); paid services; manual URL entry for the new platforms.
- Anti-goals: a link to a different version of a song; the run overwriting a curator's decision; any third-party call carrying anything but public song data.

## Findings (read-only dry run, 60 random live songs)
Spotify still returns an ISRC to our app (60/60). Deezer's free API finds a track by ISRC: 57/60, exact. Apple's free lookup does not accept an ISRC (0/60); title + artist search found 39/60 but carries no ISRC, so a hit can be another version. Odesli's public API is closed (`PUBLIC_API_ACCESS_DEPRECATED`).

## Approaches considered
1. Cross-platform service (Odesli): closed. 2. **Each platform's free API, ISRC first (chosen)**: exact where an ISRC works (Deezer), curator-confirmed where it cannot (Apple). 3. Auto-save strict Apple matches: faster, wrong versions get through (rejected by the curator).

## Design
- **Data (migration 028):** `songs.isrc TEXT`; table `song_platform_links` (`song_id` FK cascade, `platform` in `deezer | apple_music | tidal`, `url`, `status` `proposed | confirmed | rejected`, `source` `isrc | search`, `match_title`, `match_artist` (what the platform called it, for the review), `created_at`; PK `(song_id, platform)`). Spotify stays on `songs.spotify_url`.
- **Service `services/platformLinks.js`** (adapters take an injected `fetch`; nothing may log or rethrow a URL or a fetch error's message): `spotifyIsrc` (client credentials), `deezerByIsrc` -> saved `confirmed`/`isrc`; `appleSearch` (iTunes Search, strict match: normalised title equal and first artist matches) -> saved `proposed`/`search` with its title and artist. Inserts are `ON CONFLICT DO NOTHING`, so a confirmed or rejected row is never replaced. A run is an **in-memory job** (start, poll, one at a time `BUSY`, paced: Deezer ~120 ms, Apple ~3.2 s), over live songs that have a Spotify id and lack a row for a platform; results persist as they are found, so a restart loses only the unfinished tail.
- **Admin:** a Dashboard card "Platform links" (Find links, progress, counts); a Songs rail **Check links** (songs with a `proposed` row; counted like the others); the workbench Links panel shows each proposed link beside what the platform called it, with **Confirm** / **Reject** and an Open link. Routes under `/api/admin/platform-links/...`.
- **Public:** `GET /api/spotify/songs/:id` adds `platform_links: [{platform, url}]` from **confirmed** rows only, in a fixed order. The song page replaces the big Spotify button with the small "Listen on" row (text buttons in the existing `btn` styles); the artist's own site still leads, then SoundCloud, then the row, then the lyrics link. Spotify keeps its dormant rule.

## Left to the builder
Exact rail wording and CSS; how the strict Apple match normalises titles (reuse `staging.normalizeName`'s idea); job result shape.

## Docs to update
`PROJECT_STATE.md`, `CLAUDE.md` (new service, table, routes, rail), `docs/PRD.md` feature inventory if it lists the song page buttons.
