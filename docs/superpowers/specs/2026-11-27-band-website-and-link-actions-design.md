# Band website link and conditional link actions - design (small change)

**Why.** (Curator, after smoking the Links panel.) Many bands use their Bandcamp as their site, but some have a dedicated website; the panel mixes them in one "Bandcamp / website" field. A band's website is there to give the band visibility, not to play the song. Also "Add to Spotify playlist" and "Search Bandcamp" should only appear when they are useful.

**Findings (read-only look at the data, 2026-11-27).** 229 songs carry a Bandcamp link (all on band subdomains); 4 carry a non-Bandcamp link in `songs.bandcamp_url`: Maria Daines (maria-daines.com), Antagonist A.D (antagonistad.net), Benjamin Zephaniah (benjaminzephaniah.com) are band websites; `jah-lyrics.com` (Jah Sun) looks like a lyrics site, not the band's own. `artists.website_url` already exists and the public artist page already shows it (and the artist's Bandcamp separately); only 1 of 923 artists has one set.

**Design.**
- **The band website is an artist field** (`artists.website_url`, no schema change). The song's Links panel gets a **Website** row per credited artist (label = the artist's name when there are several), an inline autosaving input that saves through the existing `PUT /api/admin/artists/:id`, with Open. The song's own **Bandcamp** row is relabelled just "Bandcamp" (the play link). The artist workbench's Website field edits the same value.
- **Data move (one-off, curator-requested review):** songs 3, 4 and 329 have their band site moved to the artist's `website_url` (only when the artist has none) and cleared from `songs.bandcamp_url`; song 54 is left as is and flagged for the curator. The song page keeps showing the artist's site on the artist page.
- **Add to Spotify playlist** shows only when the song is not already on the playlist; otherwise a muted "On the Spotify playlist". Source of truth is the live playlist (the 60-second cached read the Dashboard card and the Songs > Spotify lists already share), not `playlist_added_at` (681 of the 1,353 included songs with a Spotify id have no date, so it cannot say). New `spotifyPush.isOnPlaylist(pool, songId, opts)` (cached read, read-only) and `GET /api/admin/spotify/on-playlist/:songId` -> `{ checked, onPlaylist }`. If the check fails or is still loading, the button shows (as today; a push is idempotent).
- **Search Bandcamp** shows only when the song has no Bandcamp link.

**Non-goals.** No public song-page change; no new table or migration; no check that a "Bandcamp" field really is bandcamp.com.
