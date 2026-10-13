# Sub-project H — Band check (band/album catalogue checker) (design)

Date: 2026-10-13 · Status: spec, awaiting curator review · Branch: `session-band-check`

## 1. Purpose and agreed understanding

The curator wants to find songs by bands **already on the list** that are not yet in the catalogue (example: Bloodmouth). For one band
the tool shows its Spotify discography, marks what the catalogue already has, and lets the curator tick the songs to add as
**To be processed**. Everything stays curator-driven: nothing is added without a click.

**Success:** open Songs -> Band check, find a band in a list of all bands (with a name search), see its Spotify releases and songs with the
ones already held marked, tick several, and add them to To be processed; they then appear in the existing queue tagged *From band check*.

**Curator decisions (2026-10-13):** per-band, on demand (no catalogue-wide scan in v1); the Band check view **lists all bands** with a search
by artist name; bands without a Spotify link are listed but cannot be checked in v1, and checking them is an **explicit planned follow-up**
(see §8); the "From band check" tag is kept.

**Probe findings that shape the design (Bloodmouth, real Spotify data, read-only):**
- 11 releases, ~35 distinct songs, 4 held in the catalogue.
- The same song recurs: as a single and on an album ("Rubble From Bone", "Autothysis", "Copcrocalypse 1312", "Spoiled Gaze"), on two albums
  ("Bloodmouth Apocalypse"), and with **different Spotify track ids** for one song ("The Floor": single vs album) — so matching must be by
  normalised title as well as id, and the list must collapse versions.
- *Appears on* releases are mostly other artists' songs; only "Black Mass" (Baconhead/Bloodmouth) credits the band — so tracks are filtered by
  **credit**, not by release.
- Album-track reads return simplified tracks (no `popularity`, no `album` object); the release supplies the album.
- `GET /artists/{id}/albums` and `GET /albums/{id}/tracks` work with the existing client-credentials client; `limit` up to 50.

## 2. Scope

In: a Songs -> Band check view (band list + search + per-band discography review), the read service, three authed routes, an origin tag.
Out (YAGNI, deferred in §8): checking bands with no Spotify link; other repositories (Bandcamp etc.); a catalogue-wide scan; a link from the song
workbench; any DB write other than through `staging.insertCandidates`.

## 3. Backend — `backend/services/bandCheck.js` (new)

Pure functions (no DB, no network; node:test):

- `creditsArtist(track, artistSpotifyId) -> boolean` — the track's `artists[]` includes that Spotify id.
- `preferRelease(a, b)` ordering for choosing the representative version of one song: `album_type` rank album (0) < compilation (1) < single (2),
  then earliest `release_date`, then lowest spotify id (deterministic).
- `groupSongs(tracks) -> songs[]` — collapses tracks by `staging.normalizeName(title)` (the same key the Spotify-push duplicate check uses),
  keeping the preferred version as the representative and listing the other releases it also appears on (`also_on: [releaseName…]`) and every
  alternate Spotify track id (`alt_ids`), so catalogue matching considers all of them.
- `classify(songs, catalogue) -> songs[]` — each song gets `state`: `new`, or `in_catalogue` with `{ song_id, status, published, matched_by: 'spotify_id'|'title' }`. Matched by
  any of the song's Spotify ids against `songs.spotify_id`, or by normalised title among songs credited to **this** artist. `status`
  `rejected` is reported as such (shown muted, never offered for ticking).

Service functions (take `db`, and an injected `api` Spotify client so tests never touch the network):

- `listBands(db, { q, limit, offset })` -> `{ rows: [{ id, name, spotify_id|null, songs, live_songs }], total }` — **all** artists (case-insensitive name search, `ORDER BY name`), counts from `song_artists`.
  `has_spotify` is derived from a real `artists.spotify_id`.
- `fetchDiscography(api, spotifyArtistId)` — pages `getArtistAlbums` (`include_groups: album,single,compilation,appears_on`, `limit: 50`), then `getAlbumTracks` per release
  (paged), mapping each track with the shape `staging.mapTrack` produces (the release supplies `album`). Reads use `withRetry(..., { maxWaitS: 30, maxRetries: 3 })`; a 429 beyond that fails fast
  with `RATE_LIMITED`. Errors carry fixed strings + `.code` (`NOT_FOUND`, `NO_SPOTIFY`, `RATE_LIMITED`, `UPSTREAM`); **nothing logs or rethrows a token or a raw fetch error message.**
- `checkBand(db, artistId, { api, fresh })` — loads the artist (404 if missing, `NO_SPOTIFY` if no real spotify id), fetches the discography (cached 5 minutes per artist; `fresh` bypasses but re-caches),
  filters to tracks crediting the band, `groupSongs`, loads the catalogue slice, `classify`, and returns
  `{ artist: { id, name, spotify_id }, releases: [{ id, name, album_type, release_date, songs: [...] }], counts: { new, in_catalogue, rejected } }` with releases newest first. A song is listed under
  its representative release only (so ticking it once adds it once).
- `addSelected(db, artistId, trackIds, { api })` — re-reads the discography (**never trusts client-supplied track data**), keeps only ids that belong to a song currently `new`, and calls
  `staging.insertCandidates(db, tracks, { note })` (note `added via band check` plus the release name). Returns `{ added, skippedExisting, notFound }`. One add at a time per process (`BUSY`),
  at most 100 ids per call.

`staging.insertCandidates` gains an optional `{ note }` argument (default unchanged) passed through to `addTracksAsPending`. `curation.listCurationQueue`'s `origin` CASE gains
`WHEN s.status_notes LIKE 'added via band check%' THEN 'bandcheck'`, and the admin list label is **From band check**.

## 4. Routes (authed, `admin.js`, new "Band check" banner)

- `GET /api/admin/band-check/bands?q=&limit=&offset=` -> `{ rows, total }`.
- `GET /api/admin/band-check/bands/:id?fresh=1` -> the `checkBand` result (404 unknown band, 409 `{ error: 'NO_SPOTIFY' }`, 429/502 for Spotify limits/outages with a readable message).
- `POST /api/admin/band-check/bands/:id/add` body `{ trackIds: [...] }` -> `{ added, skippedExisting, notFound }` (400 for a bad body, 409 `BUSY`).

## 5. Frontend

- `QueueRail`: **Band check** under *Capture* (no count). `SongsArea` renders `<BandCheck />` for the `band-check` view.
- `BandCheck.jsx` (new, one file per view like `InboxList`): a searchable, paged list of **all** bands (name, "N songs · M live", a "No Spotify link — not checkable yet" note and a disabled Check button for unlinked bands).
  Choosing a band sets `?artist=<id>` (back button works) and shows the review below; "← All bands" returns.
- Review: header (band name, counts, **Refresh from Spotify**), releases newest first, each a section of songs with a checkbox for `new` songs, muted rows with a state chip
  (*live / pending / rejected*, linking to the admin song) for held songs, an "also on …" hint for collapsed versions, **Select all new** (per release and overall), and a footer **Add N to To be processed**
  with an inline result ("Added 31, 2 already held"). After adding, the review reloads so the new songs show as *pending*.
- Uses `adminFetch`, design tokens, existing admin classes; no new dependency. Single-consumer helpers stay inside `BandCheck.jsx`.

## 6. Risks

- **Spotify quota/latency:** ~1 + releases calls per band (11 for Bloodmouth, a few seconds); cached 5 minutes; rate-limit fails fast with a message. One band at a time, curator-triggered, so no bulk exposure.
- **Whole-discography adds:** a band can add 30+ pending songs at once; the confirm is the visible count, and rows carry the *From band check* tag. Nothing touches the 650-song dataset except pending rows via the existing intake.
- **Match gaps:** a catalogue song stored under a different title spelling will show as *new*; the existing `insertCandidates` title|artist dedupe is the second net. Conversely a different song with the same normalised title is shown as held — acceptable for v1, noted in the UI chip's tooltip ("matched by title").
- **Secrets:** the Spotify client is created per call by the existing `getSpotifyClient`; no token or request body is logged.

## 7. Testing

- Pure: `creditsArtist`; `preferRelease` ordering; `groupSongs` collapses single+album and two albums, keeps all alternate ids, normalises like the push check; `classify` (id match, title match, rejected, none).
- Service with an injected fake `api` (fixed Bloodmouth-shaped fixtures, sentinel prefix `ZZZBAND`): `checkBand` filters by credit, collapses versions, marks held songs, `NO_SPOTIFY`/`NOT_FOUND`; caching (second call makes no API calls, `fresh` does); `addSelected` adds only `new` ids, ignores client-supplied junk ids, writes pending songs tagged `bandcheck`, is idempotent (second add -> all `skippedExisting`), caps at 100.
- `listBands`: search, paging, counts, `has_spotify`.
- Live check on Bloodmouth: list, open, confirm the held songs are marked, **stop before adding** (the curator adds in their smoke).

## 8. Planned follow-up (recorded, not built): bands without a Spotify link

210 of 850 artists have no Spotify link. The curator wants these checkable later, in two steps:
1. **Is the band on Spotify?** Name-search Spotify, show candidates (name, followers, top album), the curator confirms one, and the id is saved to `artists.spotify_id` — after which the normal v1 check works.
2. **If not on Spotify:** search other repositories (Bandcamp and similar) for the band's songs, with the same review-and-add flow. Needs its own brainstorm (which sources, and given the "no paid services" rule, free ones only).
Until then the Band check list shows these bands with the note "No Spotify link — not checkable yet".
