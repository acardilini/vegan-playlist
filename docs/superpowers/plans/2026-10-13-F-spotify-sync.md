# Spotify Sync (push + pull button) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the curator (a) add live songs to the Spotify playlist from admin (per song or in bulk) and (b) pull songs added on Spotify into the catalogue as `pending`, via buttons — website stays master.

**Architecture:** A small `spotifyAuth` service does the one-time Authorization-Code sign-in and keeps a refresh token in a gitignored file; a separate `/api/spotify-auth` router handles the browser redirect (it cannot carry the admin header). A `spotifyPush` service classifies catalogue vs playlist and adds missing tracks (add-only, idempotent, never writes the DB). Two authed admin routes expose compare + push; the existing import-only sync route is reused for pull. A Dashboard card and a Links-panel button drive it.

**Tech Stack:** Node 22 (global `fetch`), Express, `node:test`, React/Vite. **No new dependencies** — Spotify's token + playlist calls use injected `fetch` (not `spotify-web-api-node`, whose `addTracksToPlaylist` hits the old `/tracks` path that Spotify's March-2026 dev-mode change reportedly 403s; reads via the existing client still work — verified 2026-10-13: both `/tracks` and `/items` GET return 200).

**Spec:** `docs/superpowers/specs/2026-10-13-F-spotify-push-design.md`

## Global Constraints

- Website is master. Push is **add-only** and **click-only**; nothing removes tracks or runs automatically.
- Refresh token lives only in `backend/.spotify-token.json` (gitignored). **Never** log, return or put in an error message: the token, the OAuth `code`, or a request URL carrying one.
- Playlist: `DEFAULT_PLAYLIST_ID = '5hVygGomw9zax38quC6mhi'` from `utils/playlistSync.js`. Scopes: `playlist-modify-public playlist-modify-private` only.
- Redirect URI default `http://127.0.0.1:5000/api/spotify-auth/callback` (already registered in the Spotify dashboard); env `SPOTIFY_REDIRECT_URI` overrides.
- Adding uses `POST https://api.spotify.com/v1/playlists/{id}/items` with body `{"uris": ["spotify:track:<id>", …]}`, ≤100 URIs per call.
- Public eligibility = `status='included' AND published=true` and `spotify_id IS NOT NULL`.
- Tests: `node:test`; no test touches the network or Spotify (inject `fetchImpl`, `fetchTracks`, `sleep`); DB-touching test files use their own fixture prefix **`ZZZPUSH`**; never leave fixtures behind.
- Admin UI code fetches only via `adminFetch` (relative `/api` URLs). Styling uses existing tokens/classes; curator prefers minimal UI (counts, buttons, results — no explanatory paragraphs).
- Run git from the repo root; use explicit `git add` paths (never `git add backend`); commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; long messages via `git commit -F <scratchpad file>`.
- Don't put temp scripts inside `backend/` (nodemon restarts the server); use the scratchpad with absolute requires. Never `taskkill /IM node.exe`.

## Review Focus

1. **Double-click / retry** must not double-add: push re-reads the live playlist first, so a second run adds nothing (Task 3 test).
2. **More than 100 ids** must be chunked 100/100/50 and a mid-way failure must report what was already added (Task 3 tests).
3. **Spotify 403 on add** (account can't edit the playlist) must become a typed, readable error, not a 500 (Task 3 test).
4. **Bad `songIds`** (strings, 0, negatives, floats, empty array, duplicates) → 400 with duplicates collapsed, never a 500 or an accidental "push everything" (Task 3 test).
5. **OAuth callback abuse:** missing/unknown/expired/reused `state` → 400 and nothing written; the token never appears in any response or error (Task 1/2 tests).
6. **Unpublished / rejected / non-Spotify songs** requested by id come back as `notEligible` with a reason, never pushed (Task 3 test).

---

### Task 1: `spotifyAuth` service + token store

**Files:**
- Create: `backend/services/spotifyAuth.js`
- Create: `backend/test/spotifyAuth.test.js`
- Modify: `.gitignore` (add `backend/.spotify-token.json`)
- Modify: `backend/.env.example` (add `SPOTIFY_REDIRECT_URI`, `ADMIN_RETURN_URL`)

**Interfaces:**
- Produces: `createAuth(opts?)` returning `{ startAuth(): {url, state}, consumeState(state): boolean, handleCallback(code): Promise<void>, status(): {connected: boolean}, getAccessToken(): Promise<string> }`. The module exports exactly `{ createAuth, defaultAuth }`, where `defaultAuth = createAuth()` reads env at call time.
- `opts`: `{ fetchImpl = fetch, tokenFile, clientId, clientSecret, redirectUri, now = Date.now }`; any missing option is read from the environment **at call time** (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` with the default above).
- Errors are `Error`s with `.code` ∈ `NOT_CONNECTED | REAUTH | UPSTREAM`. Messages are fixed strings.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/spotifyAuth.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuth } = require('../services/spotifyAuth');

// No DB and no network: fetch is injected, the token file lives in a temp dir.
const SECRET_REFRESH = 'ZZZPUSH-REFRESH-TOKEN-xyz';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zzzpush-')), 'token.json');
}
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}
const base = (over = {}) => ({
  clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://127.0.0.1:5000/cb', tokenFile: tmpFile(), ...over,
});

test('startAuth builds the authorize URL with scopes, redirect and a fresh state', () => {
  const a = createAuth(base());
  const { url, state } = a.startAuth();
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:5000/cb');
  assert.equal(u.searchParams.get('scope'), 'playlist-modify-public playlist-modify-private');
  assert.equal(u.searchParams.get('state'), state);
  assert.ok(state.length >= 16);
  assert.notEqual(a.startAuth().state, state);
});

test('consumeState: single-use, unknown/missing rejected, expires after 10 minutes', () => {
  let t = 1_000_000;
  const a = createAuth(base({ now: () => t }));
  const { state } = a.startAuth();
  assert.equal(a.consumeState(state), true);
  assert.equal(a.consumeState(state), false, 'reuse');
  assert.equal(a.consumeState('nope'), false);
  assert.equal(a.consumeState(undefined), false);
  const s2 = a.startAuth().state;
  t += 10 * 60 * 1000 + 1;
  assert.equal(a.consumeState(s2), false, 'expired');
});

test('handleCallback stores the refresh token; status reports connected without exposing it', async () => {
  const f = fakeFetch([{ status: 200, body: { access_token: 'AT', refresh_token: SECRET_REFRESH, scope: 'x' } }]);
  const opts = base({ fetchImpl: f });
  const a = createAuth(opts);
  assert.deepEqual(a.status(), { connected: false });
  await a.handleCallback('the-code');
  assert.deepEqual(a.status(), { connected: true });
  assert.equal(JSON.parse(fs.readFileSync(opts.tokenFile, 'utf8')).refresh_token, SECRET_REFRESH);
  const sent = f.calls[0].init.body.toString();
  assert.match(sent, /grant_type=authorization_code/);
  assert.match(sent, /code=the-code/);
  assert.match(f.calls[0].init.headers.Authorization, /^Basic /);
  assert.ok(!JSON.stringify(a.status()).includes(SECRET_REFRESH));
});

test('handleCallback failure throws UPSTREAM and stores nothing; message leaks neither code nor token', async () => {
  const opts = base({ fetchImpl: fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]) });
  const a = createAuth(opts);
  await assert.rejects(() => a.handleCallback('secret-code-123'), (e) => {
    assert.equal(e.code, 'UPSTREAM');
    assert.ok(!e.message.includes('secret-code-123'));
    return true;
  });
  assert.equal(fs.existsSync(opts.tokenFile), false);
});

test('getAccessToken: NOT_CONNECTED without a file; corrupt file also NOT_CONNECTED', async () => {
  const opts = base({ fetchImpl: fakeFetch([]) });
  const a = createAuth(opts);
  await assert.rejects(() => a.getAccessToken(), { code: 'NOT_CONNECTED' });
  fs.writeFileSync(opts.tokenFile, '{not json');
  assert.deepEqual(a.status(), { connected: false });
  await assert.rejects(() => a.getAccessToken(), { code: 'NOT_CONNECTED' });
  fs.writeFileSync(opts.tokenFile, JSON.stringify({ refresh_token: '' }));
  assert.deepEqual(a.status(), { connected: false });
});

test('getAccessToken refreshes, and persists a rotated refresh token when Spotify sends one', async () => {
  const opts = base();
  fs.writeFileSync(opts.tokenFile, JSON.stringify({ refresh_token: 'old' }));
  const f = fakeFetch([
    { status: 200, body: { access_token: 'AT1' } },
    { status: 200, body: { access_token: 'AT2', refresh_token: 'rotated' } },
  ]);
  const a = createAuth({ ...opts, fetchImpl: f });
  assert.equal(await a.getAccessToken(), 'AT1');
  assert.equal(JSON.parse(fs.readFileSync(opts.tokenFile, 'utf8')).refresh_token, 'old');
  assert.equal(await a.getAccessToken(), 'AT2');
  assert.equal(JSON.parse(fs.readFileSync(opts.tokenFile, 'utf8')).refresh_token, 'rotated');
  assert.match(f.calls[0].init.body.toString(), /grant_type=refresh_token/);
});

test('a revoked refresh token (invalid_grant) is REAUTH; network failure is UPSTREAM', async () => {
  const opts = base();
  fs.writeFileSync(opts.tokenFile, JSON.stringify({ refresh_token: SECRET_REFRESH }));
  const revoked = createAuth({ ...opts, fetchImpl: fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]) });
  await assert.rejects(() => revoked.getAccessToken(), { code: 'REAUTH' });
  const down = createAuth({ ...opts, fetchImpl: fakeFetch([new Error(`boom ${SECRET_REFRESH}`)]) });
  await assert.rejects(() => down.getAccessToken(), (e) => {
    assert.equal(e.code, 'UPSTREAM');
    assert.ok(!e.message.includes(SECRET_REFRESH), 'fetch error message must not be rethrown');
    return true;
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `backend/`): `node --test test/spotifyAuth.test.js`
Expected: FAIL — `Cannot find module '../services/spotifyAuth'`.

- [ ] **Step 3: Implement**

Create `backend/services/spotifyAuth.js`:

```js
// Spotify user authorisation (sub-project F): the one-time Authorization-Code sign-in that lets the
// backend ADD tracks to the playlist. Only a refresh token is kept, in a gitignored file.
// SECURITY: nothing here may log or rethrow the OAuth code, a token, a request body, or a fetch
// error's message/cause (it can echo the request). Errors carry fixed strings and a `.code`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCOUNTS = 'https://accounts.spotify.com';
const SCOPES = 'playlist-modify-public playlist-modify-private';
const DEFAULT_TOKEN_FILE = path.join(__dirname, '..', '.spotify-token.json');
const DEFAULT_REDIRECT = 'http://127.0.0.1:5000/api/spotify-auth/callback';
const STATE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

function createAuth(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || Date.now;
  const tokenFile = opts.tokenFile || DEFAULT_TOKEN_FILE;
  const cfg = () => ({
    clientId: opts.clientId ?? process.env.SPOTIFY_CLIENT_ID,
    clientSecret: opts.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: opts.redirectUri ?? process.env.SPOTIFY_REDIRECT_URI ?? DEFAULT_REDIRECT,
  });
  const states = new Map(); // state -> expiry ms

  function readToken() {
    try {
      const t = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      return t && typeof t.refresh_token === 'string' && t.refresh_token ? t : null;
    } catch { return null; }
  }
  function writeToken(refresh_token, scope) {
    fs.writeFileSync(tokenFile, JSON.stringify({ refresh_token, scope: scope || SCOPES, obtained_at: new Date(now()).toISOString() }), { mode: 0o600 });
  }

  async function tokenRequest(params) {
    const { clientId, clientSecret } = cfg();
    let res;
    try {
      res = await fetchImpl(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw coded('UPSTREAM', 'could not reach Spotify'); // drops the error: its message can echo the request
    }
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      if (body && body.error === 'invalid_grant') throw coded('REAUTH', 'Spotify authorisation expired — connect again');
      throw coded('UPSTREAM', `Spotify token request failed (HTTP ${res.status})`);
    }
    return body || {};
  }

  return {
    startAuth() {
      for (const [s, exp] of states) if (exp <= now()) states.delete(s); // sweep
      const state = crypto.randomBytes(24).toString('hex');
      states.set(state, now() + STATE_TTL_MS);
      const { clientId, redirectUri } = cfg();
      const url = `${ACCOUNTS}/authorize?` + new URLSearchParams({
        response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirectUri, state,
      });
      return { url, state };
    },
    consumeState(state) {
      if (typeof state !== 'string' || !states.has(state)) return false;
      const exp = states.get(state);
      states.delete(state);
      return exp > now();
    },
    async handleCallback(code) {
      const { redirectUri } = cfg();
      const body = await tokenRequest({ grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri });
      if (!body.refresh_token) throw coded('UPSTREAM', 'Spotify did not return a refresh token');
      writeToken(body.refresh_token, body.scope);
    },
    status() { return { connected: !!readToken() }; },
    async getAccessToken() {
      const tok = readToken();
      if (!tok) throw coded('NOT_CONNECTED', 'Spotify is not connected');
      const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
      if (!body.access_token) throw coded('UPSTREAM', 'Spotify returned no access token');
      if (body.refresh_token && body.refresh_token !== tok.refresh_token) writeToken(body.refresh_token, tok.scope);
      return body.access_token;
    },
  };
}

module.exports = { createAuth, defaultAuth: createAuth() };
```

Append to `.gitignore`: `backend/.spotify-token.json`. Append to `backend/.env.example`:

```
# Spotify push (sub-project F): must match a Redirect URI registered in the Spotify developer dashboard
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/api/spotify-auth/callback
# Where the OAuth callback sends the browser afterwards (the Vite dev server)
ADMIN_RETURN_URL=http://localhost:5173/admin
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/spotifyAuth.test.js` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/spotifyAuth.js backend/test/spotifyAuth.test.js .gitignore backend/.env.example
git commit -m "feat(spotify): user-auth service with file-backed refresh token"
```
(add the Co-Authored-By trailer)

---

### Task 2: `/api/spotify-auth` router

**Files:**
- Create: `backend/routes/spotifyAuth.js`
- Modify: `backend/server.js` (mount the router)
- Create: `backend/test/spotifyAuthRoutes.test.js`

**Interfaces:**
- Consumes: `createAuth`/`defaultAuth` from Task 1 (`startAuth`, `consumeState`, `handleCallback`, `status`).
- Produces: `module.exports = createRouter(defaultAuth)`; `module.exports.createRouter(auth, {adminPassword?, returnUrl?})`. Routes: `POST /start` (authed) → `{url}`; `GET /status` (authed) → `{connected}`; `GET /callback` (state-guarded) → 302 to `${returnUrl}?spotify=connected|denied|failed`, or 400 `Invalid or expired state` for a bad state.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/spotifyAuthRoutes.test.js` (no DB; spins up a throwaway Express app on port 0):

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createRouter } = require('../routes/spotifyAuth');

const PW = 'ZZZPUSH-pw';
let server, base, auth, handled;

before(async () => {
  handled = [];
  let n = 0;
  auth = {
    startAuth: () => ({ url: 'https://accounts.spotify.com/authorize?x=1', state: `s${++n}` }),
    _live: new Set(),
    consumeState(s) { return this._live.delete(s); },
    async handleCallback(code) { if (code === 'bad') throw Object.assign(new Error('x'), { code: 'UPSTREAM' }); handled.push(code); },
    status: () => ({ connected: false }),
  };
  const orig = auth.startAuth;
  auth.startAuth = () => { const r = orig(); auth._live.add(r.state); return r; };
  const app = express();
  app.use('/api/spotify-auth', createRouter(auth, { adminPassword: PW, returnUrl: 'http://app.test/admin' }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/spotify-auth`;
});
after(() => server.close());

const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init });

test('start and status require the admin header', async () => {
  assert.equal((await fetch(base + '/start', { method: 'POST' })).status, 401);
  assert.equal((await get('/status')).status, 401);
  const ok = await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).url, /^https:\/\/accounts\.spotify\.com\/authorize/);
  const st = await get('/status', { headers: { 'X-Admin-Password': PW } });
  assert.deepEqual(await st.json(), { connected: false });
});

test('callback: no/unknown state -> 400 and no token exchange', async () => {
  assert.equal((await get('/callback?code=abc')).status, 400);
  assert.equal((await get('/callback?code=abc&state=nope')).status, 400);
  assert.equal(handled.length, 0);
});

test('callback: valid state exchanges the code once, redirects connected; reuse is 400', async () => {
  const { state } = await (await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } })).json().then(() => ({ state: [...auth._live].pop() }));
  const r = await get(`/callback?code=good&state=${state}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'http://app.test/admin?spotify=connected');
  assert.deepEqual(handled, ['good']);
  assert.equal((await get(`/callback?code=good&state=${state}`)).status, 400);
});

test('callback: user denied -> redirect denied, no exchange; exchange failure -> redirect failed (no code in URL)', async () => {
  await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } });
  const s1 = [...auth._live].pop();
  const denied = await get(`/callback?error=access_denied&state=${s1}`);
  assert.equal(denied.headers.get('location'), 'http://app.test/admin?spotify=denied');
  await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } });
  const s2 = [...auth._live].pop();
  const failed = await get(`/callback?code=bad&state=${s2}`);
  assert.equal(failed.headers.get('location'), 'http://app.test/admin?spotify=failed');
  assert.ok(!failed.headers.get('location').includes('bad'));
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/spotifyAuthRoutes.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `backend/routes/spotifyAuth.js`:

```js
// Spotify user-auth routes (sub-project F). A SEPARATE router from admin.js on purpose: admin.js
// applies an X-Admin-Password check to every route, and Spotify's redirect back to us is a plain
// browser navigation that cannot send that header. /start and /status keep the header check; the
// callback is guarded by a single-use, 10-minute `state` issued by the authed /start.
const express = require('express');
const { defaultAuth } = require('../services/spotifyAuth');

function createRouter(auth = defaultAuth, { adminPassword, returnUrl } = {}) {
  const router = express.Router();
  const pw = () => adminPassword ?? process.env.ADMIN_PASSWORD;
  const back = () => returnUrl ?? process.env.ADMIN_RETURN_URL ?? 'http://localhost:5173/admin';

  const authed = (req, res, next) => {
    const given = req.headers['x-admin-password'];
    if (!given || given !== pw()) return res.status(401).json({ error: 'Admin authentication required' });
    next();
  };

  router.post('/start', authed, (req, res) => res.json({ url: auth.startAuth().url }));
  router.get('/status', authed, (req, res) => res.json(auth.status()));

  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (!auth.consumeState(state)) return res.status(400).send('Invalid or expired state');
    if (error || !code) return res.redirect(`${back()}?spotify=denied`);
    try {
      await auth.handleCallback(code);
      res.redirect(`${back()}?spotify=connected`);
    } catch (e) {
      console.error('spotify auth callback failed:', e.code || 'error'); // code only: never the message/cause
      res.redirect(`${back()}?spotify=failed`);
    }
  });
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
```

In `backend/server.js`, after the `/api/content` line add:
`app.use('/api/spotify-auth', require('./routes/spotifyAuth'));`

- [ ] **Step 4: Run to verify pass** — `node --test test/spotifyAuthRoutes.test.js` → all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/spotifyAuth.js backend/server.js backend/test/spotifyAuthRoutes.test.js
git commit -m "feat(spotify): /api/spotify-auth router with state-guarded callback"
```

---

### Task 3: `spotifyPush` service (compare + add-only push)

**Files:**
- Create: `backend/services/spotifyPush.js`
- Create: `backend/test/spotifyPush.test.js`

**Interfaces:**
- Consumes: `fetchPlaylistTracks`, `getSpotifyClient`, `DEFAULT_PLAYLIST_ID` from `../utils/playlistSync` (track shape: `{spotify_id, title, artists:[{name}], …}`).
- Produces (all exported):
  - `parseSongIds(v)` → `undefined` when `v === undefined`; else a de-duplicated `number[]`; throws `Error` with `.code='BAD_INPUT'` for a non-array, an empty array, or any element that is not a positive safe integer.
  - `chunk(arr, n)` → array of arrays.
  - `compare(pool, { playlistId?, fetchTracks? })` → `{ playlistTrackCount, pullable: [{spotify_id,title,artists}], pushable: [{id,title,artists}], noSpotifyId: [{id,title,artists}], onPlaylistNotLive: [{id,title,artists,status,published}] }`. `fetchTracks(playlistId)` defaults to a client-credentials read via `fetchPlaylistTracks`.
  - `pushSongs(pool, { songIds?, accessToken, playlistId?, fetchTracks?, fetchImpl?, sleep? })` → `{ added: [{id,title,artists}], alreadyThere: number, notEligible: [{id, reason}] }`; `reason ∈ not_found | not_live | no_spotify_id` (only computed when `songIds` was given). Failure throws `Error` with `.code ∈ REAUTH | FORBIDDEN | UPSTREAM` and `.added` = the `added` list so far.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/spotifyPush.test.js`:

```js
const { test, after, before } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const push = require('../services/spotifyPush');

// Unique fixture sentinel for this file: ZZZPUSH. No network: fetchTracks/fetchImpl/sleep are injected.
let live, live2, unpub, rejected, nospot, onPlaylistRejected;

async function mk(title, { sid, status = 'included', published = true }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, spotify_id, status, published, data_source) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [title, sid, status, published, sid ? 'spotify' : 'manual'])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [`ZZZPUSH Artist ${title}`])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}
before(async () => {
  live = await mk('ZZZPUSH live', { sid: 'ZZZPUSH_live' });
  live2 = await mk('ZZZPUSH live2', { sid: 'ZZZPUSH_live2' });
  unpub = await mk('ZZZPUSH unpub', { sid: 'ZZZPUSH_unpub', published: false });
  rejected = await mk('ZZZPUSH rejected', { sid: 'ZZZPUSH_rej', status: 'rejected', published: false });
  nospot = await mk('ZZZPUSH nospot', { sid: null });
  onPlaylistRejected = await mk('ZZZPUSH onpl', { sid: 'ZZZPUSH_onpl', status: 'rejected', published: false });
});
after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZPUSH%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZPUSH%'`);
  await pool.end();
});

const track = (id, title = id) => ({ spotify_id: id, title, artists: [{ name: 'Someone' }] });
const fetchTracksOf = (...tracks) => async () => tracks;
// Records POSTs; script = array of status codes (default 201).
function fakeFetch(script = []) {
  const calls = [];
  const fn = async (url, init) => {
    const status = script.length ? script.shift() : 201;
    calls.push({ url: String(url), init, uris: JSON.parse(init.body).uris, status });
    return { ok: status >= 200 && status < 300, status, headers: { get: () => '0' }, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};
const ours = (list) => list.filter((x) => String(x.title || '').startsWith('ZZZPUSH'));

test('parseSongIds: undefined passes through; dedupes; rejects bad shapes', () => {
  assert.equal(push.parseSongIds(undefined), undefined);
  assert.deepEqual(push.parseSongIds([3, 3, 4]), [3, 4]);
  for (const bad of [[], 'x', null, {}, [1, '2'], [0], [-1], [1.5], [NaN], [Number.MAX_SAFE_INTEGER + 2], [null]]) {
    assert.throws(() => push.parseSongIds(bad), { code: 'BAD_INPUT' }, JSON.stringify(bad));
  }
});

test('chunk splits 250 into 100/100/50', () => {
  const sizes = push.chunk([...Array(250).keys()], 100).map((c) => c.length);
  assert.deepEqual(sizes, [100, 100, 50]);
});

test('compare buckets: pullable / pushable / noSpotifyId / onPlaylistNotLive', async () => {
  const r = await push.compare(pool, {
    fetchTracks: fetchTracksOf(track('ZZZPUSH_live2'), track('ZZZPUSH_onpl'), track('ZZZPUSH_brandnew', 'ZZZPUSH brandnew')),
  });
  assert.equal(r.playlistTrackCount, 3);
  assert.deepEqual(ours(r.pullable).map((x) => x.title), ['ZZZPUSH brandnew']);
  assert.deepEqual(ours(r.pushable).map((x) => x.id), [live], 'live2 is already on the playlist; unpublished/rejected are not pushable');
  assert.deepEqual(ours(r.noSpotifyId).map((x) => x.id), [nospot]);
  assert.deepEqual(ours(r.onPlaylistNotLive).map((x) => x.id), [onPlaylistRejected]);
});

test('pushSongs adds only what is missing, via POST /items with spotify:track URIs and a Bearer token', async () => {
  const f = fakeFetch();
  const r = await push.pushSongs(pool, {
    songIds: [live, live2], accessToken: 'TOK', fetchTracks: fetchTracksOf(track('ZZZPUSH_live2')), fetchImpl: f, sleep: noSleep,
  });
  assert.deepEqual(r.added.map((x) => x.id), [live]);
  assert.equal(r.alreadyThere, 1);
  assert.deepEqual(r.notEligible, []);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/v1\/playlists\/5hVygGomw9zax38quC6mhi\/items$/);
  assert.deepEqual(f.calls[0].uris, ['spotify:track:ZZZPUSH_live']);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOK');
});

test('IDEMPOTENT: pushing again after the playlist has the track adds nothing and makes no POST', async () => {
  const f = fakeFetch();
  const r = await push.pushSongs(pool, {
    songIds: [live], accessToken: 'TOK', fetchTracks: fetchTracksOf(track('ZZZPUSH_live')), fetchImpl: f, sleep: noSleep,
  });
  assert.deepEqual(r.added, []);
  assert.equal(r.alreadyThere, 1);
  assert.equal(f.calls.length, 0);
});

test('requested ids that are not eligible come back with a reason and are never pushed', async () => {
  const f = fakeFetch();
  const r = await push.pushSongs(pool, {
    songIds: [unpub, rejected, nospot, 999999999], accessToken: 'TOK', fetchTracks: fetchTracksOf(), fetchImpl: f, sleep: noSleep,
  });
  assert.deepEqual(r.notEligible, [
    { id: unpub, reason: 'not_live' }, { id: rejected, reason: 'not_live' },
    { id: nospot, reason: 'no_spotify_id' }, { id: 999999999, reason: 'not_found' },
  ]);
  assert.equal(f.calls.length, 0);
});

test('more than 100 URIs are chunked, and a failure part-way reports what was already added', async () => {
  // Drive chunking through the injectable adder with synthetic songs to avoid inserting 250 rows.
  const uris = [...Array(250).keys()].map((i) => `spotify:track:X${i}`);
  const f = fakeFetch([201, 201, 201]);
  await push._addUris(uris, { accessToken: 'T', playlistId: 'P', fetchImpl: f, sleep: noSleep });
  assert.deepEqual(f.calls.map((c) => c.uris.length), [100, 100, 50]);

  const g = fakeFetch([201, 500]);
  await assert.rejects(
    () => push._addUris(uris, { accessToken: 'T', playlistId: 'P', fetchImpl: g, sleep: noSleep }),
    (e) => { assert.equal(e.code, 'UPSTREAM'); assert.equal(e.addedCount, 100); return true; });
});

test('Spotify statuses map to typed errors: 401 REAUTH, 403 FORBIDDEN (readable), 429 retried then succeeds', async () => {
  const one = ['spotify:track:A'];
  await assert.rejects(() => push._addUris(one, { accessToken: 'T', playlistId: 'P', fetchImpl: fakeFetch([401]), sleep: noSleep }), { code: 'REAUTH' });
  await assert.rejects(() => push._addUris(one, { accessToken: 'T', playlistId: 'P', fetchImpl: fakeFetch([403]), sleep: noSleep }),
    (e) => { assert.equal(e.code, 'FORBIDDEN'); assert.match(e.message, /can.t edit this playlist/i); return true; });
  const f = fakeFetch([429, 201]);
  await push._addUris(one, { accessToken: 'T', playlistId: 'P', fetchImpl: f, sleep: noSleep });
  assert.equal(f.calls.length, 2);
});

test('pushSongs attaches progress (.added) to a mid-way failure', async () => {
  const f = fakeFetch([403]);
  await assert.rejects(
    () => push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(), fetchImpl: f, sleep: noSleep }),
    (e) => { assert.equal(e.code, 'FORBIDDEN'); assert.deepEqual(e.added, []); return true; });
});

test('push never writes to the songs table', async () => {
  const before = (await pool.query(`SELECT count(*)::int n, max(updated_at) m FROM songs`)).rows[0];
  await push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(), fetchImpl: fakeFetch(), sleep: noSleep });
  const after = (await pool.query(`SELECT count(*)::int n, max(updated_at) m FROM songs`)).rows[0];
  assert.deepEqual(after, before);
});
```

(If `songs.updated_at` does not exist, drop `max(updated_at)` from the last test and compare `count(*)` only. If the `songs` CHECK constraints reject the fixture insert — e.g. `data_source`/`spotify_id` pairing — adjust the fixture values, not the service.)

- [ ] **Step 2: Run to verify failure** — `node --test test/spotifyPush.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `backend/services/spotifyPush.js`:

```js
// Spotify sync (sub-project F): compare the catalogue with the playlist, and ADD live songs that
// are missing from it. Add-only and idempotent; never writes the database.
// SECURITY: errors carry fixed strings + `.code`; never the access token, a request body or a fetch
// error's message/cause.
const { fetchPlaylistTracks, getSpotifyClient, DEFAULT_PLAYLIST_ID } = require('../utils/playlistSync');

const API = 'https://api.spotify.com/v1';
const CHUNK = 100;
const TIMEOUT_MS = 10000;
const MAX_429_RETRIES = 3;

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

function parseSongIds(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0) throw coded('BAD_INPUT', 'songIds must be a non-empty array of song ids');
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x <= 0) throw coded('BAD_INPUT', 'songIds must be positive integers');
  }
  return [...new Set(v)];
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const defaultFetchTracks = async (playlistId) => fetchPlaylistTracks(await getSpotifyClient(), playlistId);

async function loadSongs(pool) {
  return (await pool.query(`
    SELECT s.id, s.title, s.spotify_id, s.status, s.published,
           COALESCE(string_agg(a.name, ', ' ORDER BY sa.id), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    GROUP BY s.id`)).rows;
}

const isLive = (s) => s.status === 'included' && s.published === true;
const brief = (s) => ({ id: s.id, title: s.title, artists: s.artists });

function classify(songs, tracks) {
  const onPlaylist = new Set(tracks.map((t) => t.spotify_id));
  const known = new Set(songs.filter((s) => s.spotify_id).map((s) => s.spotify_id));
  return {
    onPlaylist,
    pullable: tracks.filter((t) => !known.has(t.spotify_id)),
    pushable: songs.filter((s) => isLive(s) && s.spotify_id && !onPlaylist.has(s.spotify_id)),
    noSpotifyId: songs.filter((s) => isLive(s) && !s.spotify_id),
    onPlaylistNotLive: songs.filter((s) => s.spotify_id && onPlaylist.has(s.spotify_id) && !isLive(s)),
  };
}

async function compare(pool, { playlistId = DEFAULT_PLAYLIST_ID, fetchTracks = defaultFetchTracks } = {}) {
  const [songs, tracks] = [await loadSongs(pool), await fetchTracks(playlistId)];
  const c = classify(songs, tracks);
  return {
    playlistTrackCount: tracks.length,
    pullable: c.pullable.map((t) => ({ spotify_id: t.spotify_id, title: t.title, artists: (t.artists || []).map((a) => a.name).join(', ') })),
    pushable: c.pushable.map(brief),
    noSpotifyId: c.noSpotifyId.map(brief),
    onPlaylistNotLive: c.onPlaylistNotLive.map((s) => ({ ...brief(s), status: s.status, published: s.published })),
  };
}

// POST the URIs in chunks of 100. Throws coded errors; `.addedCount` = URIs added before the failure.
async function addUris(uris, { accessToken, playlistId = DEFAULT_PLAYLIST_ID, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let addedCount = 0;
  for (const part of chunk(uris, CHUNK)) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${API}/playlists/${playlistId}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: part }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        const e = coded('UPSTREAM', 'could not reach Spotify'); e.addedCount = addedCount; throw e;
      }
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const wait = (parseInt(res.headers && res.headers.get && res.headers.get('retry-after')) || 1) + 1;
        await sleep(wait * 1000);
        continue;
      }
      if (res.ok) { addedCount += part.length; break; }
      const e = res.status === 401 ? coded('REAUTH', 'Spotify authorisation expired — connect again')
        : res.status === 403 ? coded('FORBIDDEN', "This Spotify account can't edit this playlist — it must own it or be a collaborator")
        : coded('UPSTREAM', `Spotify rejected the request (HTTP ${res.status})`);
      e.addedCount = addedCount;
      throw e;
    }
  }
  return addedCount;
}

async function pushSongs(pool, { songIds, accessToken, playlistId = DEFAULT_PLAYLIST_ID, fetchTracks = defaultFetchTracks, fetchImpl, sleep } = {}) {
  const ids = songIds === undefined ? undefined : parseSongIds(songIds);
  const songs = await loadSongs(pool);
  const tracks = await fetchTracks(playlistId);
  const onPlaylist = new Set(tracks.map((t) => t.spotify_id));

  let pool_ = songs;
  const notEligible = [];
  if (ids) {
    const byId = new Map(songs.map((s) => [s.id, s]));
    pool_ = [];
    for (const id of ids) {
      const s = byId.get(id);
      if (!s) notEligible.push({ id, reason: 'not_found' });
      else if (!isLive(s)) notEligible.push({ id, reason: 'not_live' });
      else if (!s.spotify_id) notEligible.push({ id, reason: 'no_spotify_id' });
      else pool_.push(s);
    }
  }
  const eligible = pool_.filter((s) => isLive(s) && s.spotify_id);
  const alreadyThere = eligible.filter((s) => onPlaylist.has(s.spotify_id)).length;
  const bySpotify = new Map();
  for (const s of eligible) if (!onPlaylist.has(s.spotify_id) && !bySpotify.has(s.spotify_id)) bySpotify.set(s.spotify_id, s);
  const toAdd = [...bySpotify.entries()];

  const added = [];
  try {
    for (const part of chunk(toAdd, CHUNK)) {
      await addUris(part.map(([sid]) => `spotify:track:${sid}`), { accessToken, playlistId, fetchImpl, sleep });
      for (const [, s] of part) added.push(brief(s));
    }
  } catch (e) {
    // addUris chunks internally, but each call here is already <=100, so a failure means nothing in this part landed
    e.added = added;
    throw e;
  }
  return { added, alreadyThere, notEligible };
}

module.exports = { parseSongIds, chunk, compare, pushSongs, _addUris: addUris };
```

- [ ] **Step 4: Run to verify pass** — `node --test test/spotifyPush.test.js` → all pass. Then run the whole backend suite once (`cd backend && npm test`) and confirm nothing else regressed (expect 230 + the new tests, 0 failing).

- [ ] **Step 5: Commit**

```bash
git add backend/services/spotifyPush.js backend/test/spotifyPush.test.js
git commit -m "feat(spotify): compare + add-only push service"
```

---

### Task 4: Admin routes (compare, push, pull button support)

**Files:**
- Modify: `backend/routes/admin.js` (requires near the other service requires; two routes in the `Sync` banner section after `/spotify-playlist-mismatch`, ~line 1441)

**Interfaces:**
- Consumes: `spotifyPush.compare/pushSongs/parseSongIds`, `spotifyAuth.defaultAuth.getAccessToken/status`.
- Produces (authed by the router-level middleware):
  - `GET /api/admin/spotify/compare` → `{ success, connected, ...compareResult }`.
  - `POST /api/admin/spotify/push` body `{ songIds?: number[] }` → `{ success, added, alreadyThere, notEligible }`. Errors: 400 `{error}` (BAD_INPUT); 409 `{error:'NOT_CONNECTED'|'REAUTH', message}`; 502 `{error:'FORBIDDEN'|'UPSTREAM', message, added}`.

- [ ] **Step 1: Add the routes**

Next to the other `require`s at the top of `admin.js` add:

```js
const spotifyPush = require('../services/spotifyPush');
const { defaultAuth: spotifyAuth } = require('../services/spotifyAuth');
```

After the `/spotify-playlist-mismatch` route add:

```js
// Spotify sync (sub-project F): live comparison + add-only push. Pull reuses POST /sync-spotify-playlist.
router.get('/spotify/compare', async (req, res) => {
  try {
    res.json({ success: true, connected: spotifyAuth.status().connected, ...(await spotifyPush.compare(pool)) });
  } catch (e) {
    console.error('spotify compare error:', e.code || e.message);
    res.status(502).json({ error: 'Failed to read the Spotify playlist' });
  }
});
router.post('/spotify/push', async (req, res) => {
  try {
    const songIds = spotifyPush.parseSongIds((req.body || {}).songIds);
    const accessToken = await spotifyAuth.getAccessToken();
    res.json({ success: true, ...(await spotifyPush.pushSongs(pool, { songIds, accessToken })) });
  } catch (e) {
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    if (e.code === 'NOT_CONNECTED' || e.code === 'REAUTH') return res.status(409).json({ error: e.code, message: e.message });
    if (e.code === 'FORBIDDEN' || e.code === 'UPSTREAM') return res.status(502).json({ error: e.code, message: e.message, added: e.added || [] });
    console.error('spotify push error:', e.code || e.message); // never the token / body
    res.status(500).json({ error: 'Failed to push to Spotify' });
  }
});
```

- [ ] **Step 2: Verify with a throwaway HTTP check (no real Spotify write)**

Start the backend the usual way (check the process tree first; do not kill other node processes), then from the **scratchpad**:
- `GET /api/admin/spotify/compare` with the admin header → 200, `connected:false`, counts consistent with `GET /api/admin/spotify-playlist-mismatch` (`pullable.length == playlistTracksNotInCatalogue`).
- `POST /api/admin/spotify/push` `{"songIds":[]}` → 400; `{"songIds":["a"]}` → 400; `{}` while not connected → 409 `NOT_CONNECTED`; no header → 401.

Expected: all as listed. (Do not run a push with ids yet — that is Task 6, after Connect.)

- [ ] **Step 3: Run backend suite** — `cd backend && npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat(spotify): admin compare + push routes"
```

---

### Task 5: Frontend — Spotify sync card + per-song button

**Files:**
- Create: `frontend/src/components/admin/SpotifySyncCard.jsx`
- Modify: `frontend/src/components/admin/Dashboard.jsx` (render the card in a new `dash-section`)
- Modify: `frontend/src/components/admin/LinksPanel.jsx` (button next to the Spotify URL actions)
- Modify: `frontend/src/styles/admin.css` (only if a needed class doesn't exist; reuse `dash-section`, `dash-heading`, `btn`, `btn-primary`, `btn-secondary`, `btn-sm`, `modal-result`, `queue-empty` first)

**Interfaces:**
- Consumes: `adminFetch` (`frontend/src/api/adminApi.js`); the Task 2/4 endpoints; existing `POST /api/admin/sync-spotify-playlist` (response: `{summary:{addedAsPending}, …}`).
- Produces: `<SpotifySyncCard />` (no props). The Links-panel button calls `POST /api/admin/spotify/push` with `{songIds:[id]}`.

No frontend test runner exists; verification is lint + build here and the live smoke in Task 6.

- [ ] **Step 1: Write `SpotifySyncCard.jsx`**

Behaviour (keep markup minimal, existing classes):
- On mount, `adminFetch('/api/admin/spotify/compare')` → state `data`; `error` string on failure ("Couldn't read the Spotify playlist").
- Also on mount read `new URLSearchParams(location.search).get('spotify')`; show one line: `connected` → "Spotify connected.", `denied` → "Spotify sign-in was cancelled.", `failed` → "Spotify sign-in failed — try again." Then `history.replaceState` to strip the param.
- Connection row: if `!data.connected` → `<button className="btn btn-secondary btn-sm">Connect Spotify</button>` which does `POST /api/admin/../spotify-auth/start` — **note the path is `/api/spotify-auth/start`, not under `/api/admin`** — then `window.location.href = (await r.json()).url`. If connected → text "Spotify connected".
- Counts, each only if > 0 except push/pull rows which always show: 
  - `{pullable.length} on the playlist, not on the site` + `<button>Pull {n} as pending</button>` (disabled when 0 or busy) → `POST /api/admin/sync-spotify-playlist` (no body) → show `Added {summary.addedAsPending} to To be processed.` and reload compare.
  - `{pushable.length} live songs not on the playlist` + `<button>Push {n} to Spotify</button>` (disabled when 0, busy, or not connected). Click opens an inline confirm: a scrollable `<ul>` of `title — artists` for every pushable song and `Confirm push` / `Cancel`. Confirm → `POST /api/admin/spotify/push` with `{}` → result line `Added {added.length}, already there {alreadyThere}.`; reload compare.
  - `{noSpotifyId.length} live songs have no Spotify link (can't be pushed)` — text only.
  - `{onPlaylistNotLive.length} on the playlist but not live` — text only.
- Error mapping for push: 409 → "Connect Spotify first." (and refresh compare so the Connect button shows); 502 with `message` → show the message plus `Added so far: n` from `added`; other → "Push failed."
- `busy` state disables all buttons during any request. Use a `useCallback` `load`, same style as `Dashboard.jsx`.

- [ ] **Step 2: Wire into `Dashboard.jsx`**

Import the card and render, between "Catalogue health" and "Recent activity":

```jsx
<section className="dash-section">
  <h2 className="dash-heading">Spotify playlist</h2>
  <SpotifySyncCard />
</section>
```

- [ ] **Step 3: Per-song button in `LinksPanel.jsx`**

Add state `pushMsg` and a handler:

```jsx
const live = wb.status === 'included' && wb.published;
const canPush = live && !!wb.spotify_id;
const pushToSpotify = async () => {
  setPushMsg('Adding…');
  try {
    const r = await adminFetch('/api/admin/spotify/push', { method: 'POST', body: { songIds: [Number(id)] } });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setPushMsg(d.added && d.added.length ? 'Added to the Spotify playlist.' : 'Already on the playlist.');
    else if (r.status === 409) setPushMsg('Connect Spotify first (Dashboard → Spotify playlist).');
    else setPushMsg(d.message || d.error || 'Push failed.');
  } catch { setPushMsg('Request failed.'); }
};
```

In the Spotify `wb-linkactions` div, after the attach button, add:

```jsx
<button type="button" className="btn btn-secondary btn-sm" disabled={!canPush} onClick={pushToSpotify}
  title={canPush ? undefined : (live ? 'This song has no Spotify link' : 'Only live songs can be added to the playlist')}>
  Add to Spotify playlist
</button>
```

and render `{pushMsg && <div className="modal-result">{pushMsg}</div>}` beside the existing `msg` line. Reset `pushMsg` when `id` changes (add `useEffect(() => setPushMsg(''), [id])`; import `useEffect`).

- [ ] **Step 4: Lint + build**

Run (from `frontend/`): `npm run lint` → 0 errors (6 pre-existing warnings are fine); `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/SpotifySyncCard.jsx frontend/src/components/admin/Dashboard.jsx frontend/src/components/admin/LinksPanel.jsx
git commit -m "feat(spotify): dashboard sync card and per-song add button"
```
(include `frontend/src/styles/admin.css` only if it changed)

---

### Task 6: Live smoke (curator-assisted) + docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`, `docs/PRD.md` (feature inventory), `backend/.env.example` already done

This task mutates the real playlist, so **stop and ask the curator before the first real push** and use one obscure live song.

- [ ] **Step 1: Connect.** Start backend + frontend. In admin → Dashboard → Spotify playlist → **Connect Spotify**; approve in Spotify as the curator (a playlist collaborator). Expect to land back on `/admin` with "Spotify connected." and `backend/.spotify-token.json` present and **untracked/ignored** (`git status` must not list it).
- [ ] **Step 2: Compare agrees.** Card counts equal `GET /spotify-playlist-mismatch` (`pullable` == `playlistTracksNotInCatalogue`; `pushable` + `noSpotifyId` consistent with live songs not on the playlist).
- [ ] **Step 3: Per-song push (with curator OK).** Pick one obscure live song with a `spotify_id` not on the playlist → workbench → **Add to Spotify playlist** → "Added to the Spotify playlist." Confirm in Spotify that the track appears. Click again → "Already on the playlist." Card's push count drops by one after reload. If Spotify answers 403 for a collaborator, record the exact status/body in the Decision Log and stop (the `/items` path may need a different scope or the account may not be a collaborator).
- [ ] **Step 4: Pull.** Curator adds one track to the playlist in Spotify → card shows `1 on the playlist, not on the site` → **Pull 1 as pending** → it appears in Songs → To be processed.
- [ ] **Step 5: Bulk push is NOT run in the smoke** (it would add ~149 tracks). Only verify the confirm list renders and click **Cancel**. The curator runs the bulk push themselves when ready.
- [ ] **Step 6: Gates.** `cd backend && npm test` (all pass), `cd frontend && npm run lint && npm run build` (clean). Record counts.
- [ ] **Step 7: Docs.** Update `PROJECT_STATE.md` (current session, Next Tasks, Decision Log: add-only/click-only/file-token decisions + the finding that the March-2026 `/tracks` change led to using `/items` via direct fetch; the playlist is owned by another Spotify user and the curator is a collaborator; changelog), `PROJECT_PLAN.md` (F ☑), `CLAUDE.md` (9 routers incl. `/api/spotify-auth`; new `services/spotifyAuth.js` + `spotifyPush.js` entries; **correct the stale claim that the Staging tab has a Sync button** — sync now lives in the Dashboard Spotify card), `PRD.md` inventory. Remove the "NEXT: F" notes.
- [ ] **Step 8: Commit** with explicit paths, then ask the curator whether to merge `session-F-spotify-push` to `main` (no-ff, as with C/D/E) — do not merge unasked.

```bash
git add docs/PROJECT_STATE.md docs/PROJECT_PLAN.md docs/PRD.md CLAUDE.md
git commit -F <scratchpad commit message file>
```
