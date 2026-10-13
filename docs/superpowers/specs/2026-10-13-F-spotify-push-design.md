# Sub-project F — Spotify sync (push + pull button) — design

_2026-10-13. Branch `session-F-spotify-push`. Status: spec awaiting curator review._

## Purpose

Keep the website catalogue and the Spotify playlist ("Animal Lib & Vegan Songs",
`5hVygGomw9zax38quC6mhi`) in step **where that is possible**, with the **website as master**
(it holds songs that are not on Spotify at all). Two directions:

- **Pull (Spotify → website):** when the curator adds a song to the playlist first, bring it into the
  catalogue. The backend already does this (`POST /api/admin/sync-spotify-playlist`, import-only,
  adds as `pending`) but **nothing in the admin UI calls it and nothing runs it automatically**
  (verified 2026-10-13: no timer anywhere in the backend; no frontend caller). It needs a button.
- **Push (website → Spotify):** a live song with a `spotify_id` that is not on the playlist can be
  added to it in one click (per song, or in bulk). New: needs Spotify user authorisation.

## Curator decisions (2026-10-13)

1. **Push is click-only.** Never automatic on publish; publishing stays a deliberate act.
2. **Add-only.** Push never removes tracks. Rejected/unpublished songs that are still on the playlist
   are listed in the report for the curator to remove by hand.
3. **Refresh token lives in a gitignored file** (`backend/.spotify-token.json`), not the database.
   Per-machine; a deployed site repeats the sign-in (Phase 5 concern).

## Non-goals (YAGNI)

Removals; scheduled or automatic sync of either direction; conflict-resolution UI; multiple
playlists (the default playlist id only, as the existing sync); any write to curatorial fields.
Pull stays exactly as it is: tracks land as `pending`, nothing existing is modified.

## Components

### 1. `services/spotifyAuth.js` — one-time sign-in

- `buildAuthorizeUrl()` — Authorization Code flow, scopes `playlist-modify-public` and
  `playlist-modify-private` only. Redirect URI from env `SPOTIFY_REDIRECT_URI`
  (default `http://127.0.0.1:5000/api/spotify-auth/callback`; the curator registers it once in the
  Spotify developer dashboard).
- `handleCallback(code)` — exchanges the code, writes `{refresh_token, scope, obtained_at}` to
  `backend/.spotify-token.json` (added to `.gitignore`).
- `getUserClient()` — a `spotify-web-api-node` client with a fresh access token from the stored
  refresh token (refresh on each use; no access-token caching needed at this volume). Throws a
  typed `NOT_CONNECTED` error if the file is missing, and `REAUTH` if Spotify rejects the refresh
  token (revoked) — the UI maps both to "Connect Spotify".
- `status()` — `{connected: boolean}`; never returns the token.
- Disconnect = delete the file (documented; also a `DELETE` route is **not** built).

**Route placement matters.** `routes/admin.js` applies `authenticateAdmin` (an
`X-Admin-Password` header check) to *every* route via `router.use`, and a browser redirect back
from Spotify cannot carry that header. So the OAuth routes are a **small separate router mounted at
`/api/spotify-auth`** (server.js becomes 9 routers):

- `POST /api/spotify-auth/start` — **authed** (admin header). Generates a random `state`, keeps it
  in memory with a 10-minute expiry, returns `{url}`. The frontend then navigates the browser to it.
- `GET /api/spotify-auth/callback` — **unauthed by header, guarded by `state`**: the `state` must be
  present, unexpired and is single-use (deleted on first use); otherwise 400. On success it stores
  the token and redirects to the admin page (`/admin?spotify=connected`); on a Spotify `error`
  param it redirects with `?spotify=denied`.
- `GET /api/spotify-auth/status` — **authed**; `{connected}`.

The callback never echoes the code or any token, and logs neither.

### 2. `services/spotifyPush.js` — add-only push

- `pushSongs(pool, userClient, {songIds})` (songIds omitted = "all eligible"):
  1. Load candidate songs: `status='included' AND published=true`, `spotify_id IS NOT NULL`
     (restricted to `songIds` when given).
  2. Re-read the **live playlist** (`fetchPlaylistTracks` from `utils/playlistSync.js`) and drop
     anything already on it — so a song added by hand is never doubled, and a double-click or retry
     is harmless (**idempotent**).
  3. Add the remainder to the playlist in chunks of 100 URIs (`spotify:track:<id>`), through
     `withRetry` (429 handling already exists).
  4. Return `{added: [...], alreadyThere: n, notEligible: [{id, reason}]}` where reason is
     `not_live` or `no_spotify_id`.
- **Never writes to the database.** The playlist is the only thing mutated. A partial failure after
  some chunks returns what was added plus the error; re-running is safe because of step 2.
- `compare(pool, userless client)` — the report for the card, built on the existing
  `computeDiff` (client-credentials read is enough): counts and short lists for *on playlist, not in
  catalogue* (pullable), *live, not on playlist, has spotify_id* (pushable), *live, no spotify_id*
  (cannot push), *on playlist but rejected/pending/unpublished* (curator info).

### 3. Admin routes (in `routes/admin.js`, Sync banner section, authed)

- `GET /api/admin/spotify/compare` — the report above (read-only; uses client credentials, so it
  works even before Connect).
- `POST /api/admin/spotify/push` — body `{songIds?: number[]}`; requires a connected account
  (`409 NOT_CONNECTED` / `REAUTH` with a fix-it message otherwise). Validates `songIds` as an array
  of integers (non-integers → 400, not 500 — a known recurring defect class in this codebase).
- Pull keeps using the existing `POST /api/admin/sync-spotify-playlist`; no change to it except
  that its response is now consumed by the UI.

### 4. Frontend

- **Spotify sync card** on the admin **Dashboard** (curator may move it to Staging — a one-component
  move). Shows connection state (**Connect Spotify** / Connected) and the compare counts:
  *N on the playlist, not on the site* → **Pull N as pending**; *N live songs not on the playlist*
  → **Push N to Spotify**; *N live songs have no Spotify link (can't be pushed)*; *N on the playlist
  but not live* (info). Push opens a **confirm step listing the songs** (title — artist) before
  sending. Results show added / already there / skipped. Uses `adminFetch`; no hard-coded URLs.
- **Per-song button** in the workbench next to the Spotify URL field: **Add to Spotify playlist**.
  Disabled with a tooltip when the song is not live or has no `spotify_id`; if already on the
  playlist the result simply says "Already on the playlist". Calls `/spotify/push` with one id.
- Curator prefers less UI: no explanatory paragraphs; counts, buttons, results.

## Data / schema

No migration. Env: `SPOTIFY_REDIRECT_URI` (optional, has a default); existing
`SPOTIFY_CLIENT_ID/SECRET` reused. `.gitignore` gains `backend/.spotify-token.json`.
`.env.example` and `CLAUDE.md` updated.

## Failure handling

| Case | Behaviour |
|---|---|
| Not connected / token revoked | push returns 409 with typed code; UI shows Connect Spotify |
| Spotify 429 | existing `withRetry` |
| Spotify 403 on add (e.g. playlist not owned by the signed-in account) | surface "this Spotify account can't edit the playlist" — not a raw stack |
| Partial push failure | response lists what was added + the error; re-run is safe |
| Callback with bad/expired/reused `state` | 400, nothing stored |
| Token file unreadable/corrupt | treated as NOT_CONNECTED |

Errors never log or rethrow request URLs, the code, or tokens (same rule as `youtubeSearch.js`).

## Testing

`node:test`, fixture prefix unique to this file (`ZZZPUSH`), `fetch`/Spotify client **injected** so
no test touches the network (pattern from `youtubeSearch.js`):

- state: single-use, expiry, missing → rejected.
- token store: round-trip, missing file → NOT_CONNECTED, corrupt → NOT_CONNECTED.
- push: filters to live+spotify_id; drops ids already on the playlist (idempotence — running twice
  adds nothing the second time); chunks 250 ids into 100/100/50; reports `not_live` /
  `no_spotify_id`; partial failure returns progress; never calls any DB write.
- compare: the four buckets from a fixed fixture.
- routes: `songIds` validation (400s), 409 when disconnected.

**Live smoke (curator-assisted, because it mutates the real playlist):** Connect once; compare
counts agree with `GET /spotify-playlist-mismatch`; push **one** obscure real song, confirm it
appears on the playlist and a second push reports "already there"; pull button on a song added to
Spotify first. The test song is removed from the playlist by hand afterwards if the curator wants.

## Plan-time checks (must be verified, not assumed)

- Spotify changed playlist endpoints in 2026 (playlist-item routes). Confirm the installed
  `spotify-web-api-node` version's `addTracksToPlaylist` still works against the current API; if
  not, call the endpoint directly via an injected `fetch` in `spotifyPush.js` (keeps the
  no-network tests).
- Confirm the playlist is owned by the account the curator will sign in with (add-to-playlist
  403s otherwise).
- Confirm `http://127.0.0.1:5000/...` is accepted as a redirect URI by the dashboard (Spotify
  requires loopback IP literals, not `localhost`).

## Docs to update at end of session

`PROJECT_STATE.md`, `PROJECT_PLAN.md` (F ☑), `CLAUDE.md` (9 routers; the stale "Staging tab's Sync"
claim — the Sync button no longer exists, this restores it), `.env.example`, `PRD.md` inventory.
