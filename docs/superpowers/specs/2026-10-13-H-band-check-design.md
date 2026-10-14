# Sub-project H — Band check (multi-source band catalogue checker) (design)

Date: 2026-10-13 (revised 2026-10-14) · Status: spec, awaiting curator review · Branch: `session-band-check`

## 1. Purpose and agreed understanding

The curator wants to find songs by bands **already on the list** that are not yet in the catalogue (example: Bloodmouth). Spotify alone is not enough:
some bands have only part of their catalogue there, or none. For one band the tool therefore **merges its catalogue from several free sources**
(Spotify, Bandcamp, MusicBrainz), marks what the catalogue already has, shows which sources list each song, and lets the curator tick the songs to
add as **To be processed**. Everything stays curator-driven: nothing is added without a click.

**Success:** open Songs -> Band check, find a band in a list of all bands (name search), identify it on each source once, see one merged song list
with per-source chips and the already-held songs marked, tick several, add them to To be processed; they appear in the existing queue tagged
*From band check* (songs not on Spotify carry their Bandcamp link as the play link).

**Curator decisions:** per-band, on demand (no catalogue-wide scan in v1); the view lists **all 850 bands** with a name search; sources for v1 are
**Spotify + Bandcamp + MusicBrainz** (free only); band identity on each source is **searched, confirmed by the curator, and saved**; songs found only on
Bandcamp/MusicBrainz are added as **manual pending songs** with the Bandcamp link as play link; the "From band check" tag is kept.

**Probe findings (Bloodmouth, real data, read-only):**
- *Spotify:* 11 releases, ~35 distinct songs, 4 held. The same song recurs as single + album, on two albums, and with **different track ids** for one song
  ("The Floor"), so match by normalised title as well as id and collapse versions. *Appears on* releases are mostly other artists' songs, so tracks are
  filtered by **credit**. `GET /artists/{id}/albums` and `/albums/{id}/tracks` work with client credentials; `limit` up to 50. Album tracks are simplified
  (no `popularity`/`album`); the release supplies the album.
- *MusicBrainz:* keyless JSON API, 1 request/second, needs a descriptive User-Agent. A name search for "Bloodmouth" returns **two different bands** (US, and AU
  disambiguated "Vegan"), and the top hit had only 8 recordings, none on Spotify — so the confirm step is essential. `inc=url-rels` returns the band's Bandcamp URL.
- *Bandcamp:* no API. `https://<band>.bandcamp.com/music` lists releases (`/album/…`, `/track/…`); each release page embeds a JSON-LD block with the tracklist
  and a per-track URL. 85 songs already carry a `bandcamp_url`, which yields candidate band pages. `artists.website_url` is empty for all 850 artists.

## 2. Scope

In: Songs -> Band check view (band list + search + identify + merged review), source adapters + merge service, a manual-pending add path, authed routes, an origin tag,
migration 014.
Out (YAGNI): Deezer / iTunes / Discogs / YouTube sources (the adapter interface is what lets them be added later); a Bandcamp name search (brittle — candidates come from MusicBrainz's
link, the band's existing song links, or a pasted URL); a catalogue-wide scan; a link from the song workbench; any DB write other than identity columns and pending songs.

## 3. Data — migration 014

`artists.bandcamp_url VARCHAR(500)` and `artists.musicbrainz_id UUID` (nullable; `spotify_id` already exists). Applied to the dev DB; additive only. `artists.website_url` (the public-page button) is **not**
reused, so the curator's public link and the checker's identity stay independent.

## 4. Backend

### 4.1 Adapters (`backend/services/bandCheck/` — one file per source, each with the same shape)

Each adapter exposes `identify(query) -> candidates[]` (where it has one) and `fetchCatalogue(identity, { fetch/api injected }) -> { source, releases: [{ name, album_type, release_date, url, tracks: [{ title, ids, url, artistsCredited }] }] }`.
All take injected `api`/`fetch` so tests never touch the network. **Errors carry fixed strings + `.code`** (`NOT_FOUND`, `RATE_LIMITED`, `UPSTREAM`, `UNREADABLE`); nothing logs or rethrows a token, a request body or a raw fetch error message.

- `spotify.js` — `identify` = `searchArtists` (name, followers, top genre); `fetchCatalogue` pages `getArtistAlbums` (`album,single,compilation,appears_on`, limit 50) then `getAlbumTracks`, keeps tracks **crediting the band**
  (`creditsArtist`), maps with `staging.mapTrack`. Reads use `withRetry(..., { maxWaitS: 30, maxRetries: 3 })`.
- `musicbrainz.js` — `identify` = artist search (name, country, disambiguation, score); `fetchCatalogue` pages `recording?artist=<mbid>` (limit 100, paced at >=1.1s between requests, User-Agent `VeganPlaylist/0.1 (personal curation tool)` — no personal data);
  `bandcampLink(mbid)` reads `url-rels` for a Bandcamp candidate. Recordings become tracks on one pseudo-release.
- `bandcamp.js` — `candidates(artist)` = MusicBrainz's Bandcamp link + `https://<sub>.bandcamp.com/` derived from the band's existing songs' `bandcamp_url` (deduped); a pasted URL is validated to a `*.bandcamp.com` origin. `fetchCatalogue` fetches `/music`, then each release page sequentially (cap 40 releases;
  a single `/track/` entry is its own release), reading the JSON-LD block (`UNREADABLE` if absent or malformed — never throws raw parse errors). A track's `url` is its Bandcamp track URL.

### 4.2 Pure merge (`backend/services/bandCheck/merge.js`, no DB, no network)

- `creditsArtist(track, spotifyArtistId)`.
- `preferRelease(a, b)` — representative ordering: `album_type` album(0) < compilation(1) < single(2), then earliest `release_date`, then lowest id (deterministic).
- `mergeCatalogues(catalogues[]) -> songs[]` — collapses every source's tracks by `staging.normalizeName(title)` (the key the Spotify-push duplicate check uses). Each song: `{ title, key, sources: { spotify?: { ids[], url }, bandcamp?: { url }, musicbrainz?: { count } }, release (representative: prefers a Spotify/Bandcamp release over MusicBrainz's pseudo-release), also_on: [release names] }`.
- `classify(songs, catalogue) -> songs[]` — `state`: `new`, or `in_catalogue` with `{ song_id, status, published, matched_by: 'spotify_id'|'bandcamp_url'|'title' }`; matches by any Spotify id vs `songs.spotify_id`, Bandcamp URL vs `songs.bandcamp_url`, or normalised title among songs credited to **this** artist. `rejected` is shown muted and never offered for ticking.

### 4.3 Service (`backend/services/bandCheck/index.js`; takes `db` + injected adapters)

- `listBands(db, { q, limit, offset })` -> `{ rows: [{ id, name, identity: { spotify, bandcamp, musicbrainz } (each true/false), songs, live_songs }], total }` — all artists, case-insensitive name search, `ORDER BY name`.
- `identifyCandidates(db, artistId, source, { query })` -> candidates for one source (Spotify/MusicBrainz name search, defaulting to the band name; Bandcamp candidates per 4.1).
- `saveIdentity(db, artistId, source, value)` -> writes only the matching identity column (`spotify_id` / `musicbrainz_id` / `bandcamp_url`), validated per source (22-char Spotify id, UUID, `*.bandcamp.com` origin); `value: null` clears it, except that a Spotify identity can be replaced but not cleared (`artists_source_check` ties `spotify_id` to `data_source='spotify'`). Never touches other artist fields.
  A Spotify id already used by a **different** artist row is refused (`CONFLICT`).
- `checkBand(db, artistId, { adapters, fresh })` — 404 if missing; runs each source the band has an identity for (**at least one required**, else `NO_IDENTITY`), each cached 5 minutes per artist+source (`fresh` bypasses but re-caches), **sources run independently**: a failed source returns
  `{ status: 'error', code }` while the others still merge. Result: `{ artist, sources: { spotify: { status, releases }, … }, releases: [{ name, album_type, release_date, songs: [...] }], counts: { new, in_catalogue, rejected, single_source } }`, releases newest first, each song listed under its representative release only.
- `addSelected(db, artistId, keys, { adapters })` — re-reads the catalogue (**never trusts client-supplied song data**; the client sends song `key`s), keeps only songs currently `new`, max 100, one add at a time per process (`BUSY`). Songs with a Spotify id go through `staging.insertCandidates(db, tracks, { note })`;
  songs found only elsewhere go through the new `staging.insertManualCandidate(db, { title, artistId, bandcamp_url, note })`: a `songs` row with `data_source='manual'`, `status='pending'`, `bandcamp_url` set, linked to the **existing** artist row — same dedupe by normalised title|artist as `insertCandidates`.
  A song with both gets the Spotify path, then its `bandcamp_url` is saved with `COALESCE` (never overwriting). Returns `{ added, skippedExisting, notFound }`. Note text: `added via band check (<band name>)`.

`staging.insertCandidates` gains an optional `{ note }` (default unchanged). `curation.listCurationQueue`'s `origin` CASE gains `WHEN s.status_notes LIKE 'added via band check%' THEN 'bandcheck'`; the admin label is **From band check**.

## 5. Routes (authed, `admin.js`, new "Band check" banner)

- `GET /api/admin/band-check/bands?q=&limit=&offset=` -> `{ rows, total }`.
- `GET /api/admin/band-check/bands/:id/candidates?source=spotify|musicbrainz|bandcamp&q=` -> `{ candidates }` (502/429 with readable message).
- `PUT /api/admin/band-check/bands/:id/identity` body `{ source, value }` -> `{ identity }` (400 bad value, 409 `CONFLICT`).
- `GET /api/admin/band-check/bands/:id?fresh=1` -> the `checkBand` result (404 unknown band, 409 `{ error: 'NO_IDENTITY' }`).
- `POST /api/admin/band-check/bands/:id/add` body `{ keys: [...] }` -> `{ added, skippedExisting, notFound }` (400 bad body, 409 `BUSY`).

## 6. Frontend

- `QueueRail`: **Band check** under *Capture* (no count). `SongsArea` renders `<BandCheck />` for the `band-check` view.
- `BandCheck.jsx` (one file per view like `InboxList`; single-consumer helpers stay inside): a searchable, paged list of **all** bands (name, "N songs · M live", three small source dots filled when identified). Choosing a band sets `?artist=<id>` (back button works).
- **Identify panel** (shown when no source is identified, and via an **Identify sources** toggle thereafter): per source a candidate list (name + distinguishing facts), a Choose button, a "Not on this source" option, and for Bandcamp a paste box. Saving triggers the check.
- **Review:** header (name, counts, **Refresh**, per-source status chips — a failed source reads e.g. "Bandcamp: couldn't read this time"), releases newest first, songs with a checkbox for `new`, muted rows with state chip (*live / pending / rejected*, linking to the admin song) for held songs, a **source chip per song** (Spotify / Bandcamp / MusicBrainz; songs on a single source are visibly flagged), an "also on …" hint for collapsed versions, **Select all new** (per release and overall), footer **Add N to To be processed** with an inline result. After adding, the review reloads so the new songs show as *pending*.
- `adminFetch`, design tokens, existing admin classes; no new dependency.

## 7. Risks

- **Wrong band on a source** (the two Bloodmouths): mitigated by the confirm step showing country/disambiguation and by saving only a curator-chosen identity; a wrong choice is fixed by re-identifying.
- **Bandcamp is scraped:** markup can change. Reads use the embedded JSON-LD, fail as `UNREADABLE` for that source only, and the check still returns the rest. Low volume (one band at a time, curator-triggered, sequential, capped at 40 releases, cached 5 minutes); read-only; no content stored beyond the title and link the curator adds.
- **MusicBrainz recordings are noisy** (live/alt versions, misspellings): they only ever add `musicbrainz` chips and gaps for the curator to judge; they are never the sole reason a song is silently added.
- **Quota/latency:** Spotify ~1 + releases calls, MusicBrainz ~1 per 100 recordings at 1/s, Bandcamp 1 + releases; the three run in parallel across sources, sequential within one.
- **Whole-discography adds:** a band can add 30+ pending songs at once; the confirm is the visible count and rows carry the tag. Nothing touches the 650-song dataset except pending rows via intake.
- **Match gaps:** a catalogue song under a different title spelling shows as *new*; the title|artist dedupe in the insert paths is the second net. A different song with the same normalised title shows as held (chip tooltip: "matched by title").
- **Secrets / privacy:** no token, request body or raw fetch error is logged; the MusicBrainz User-Agent carries no personal data.

## 8. Testing

- Pure: `creditsArtist`; `preferRelease`; `mergeCatalogues` (single+album collapse, two albums, alternate Spotify ids, Bandcamp + Spotify + MusicBrainz of one song gives one song with three source chips, Bandcamp-only song stays single-source, normalisation matches the push check); `classify` (id / Bandcamp URL / title match, rejected, none).
- Adapters with fixture responses (Bloodmouth-shaped JSON; a saved Bandcamp `/music` + release page snippet; a MusicBrainz search with two same-name bands): Spotify credit filtering; Bandcamp parses JSON-LD, caps releases, `UNREADABLE` on a page with no block, rejects non-`*.bandcamp.com` pasted URLs; MusicBrainz paces requests (injected clock) and surfaces disambiguation.
- Service (fake adapters, sentinel prefix `ZZZBAND`): `checkBand` merges and marks held songs; one source failing still returns the others; `NO_IDENTITY`; caching and `fresh`; `saveIdentity` validation, clear, and `CONFLICT`; `addSelected` adds only `new` keys, ignores junk keys, Spotify path vs manual path (`data_source='manual'`, `bandcamp_url` set, linked to the existing artist), `COALESCE` never overwrites, idempotent second add, cap 100, `BUSY`.
- `listBands`: search, paging, counts, identity flags.
- Live check on Bloodmouth (US + AU candidates both shown, choose AU "Vegan" if that is the Spotify band, open, confirm held songs marked and at least one Bandcamp-only song visible); **stop before adding** — the curator adds in their smoke. Admin UI is login-gated: curator smokes it, as in earlier sessions.
