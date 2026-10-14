# Band check (multi-source) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Songs > Band check view that merges a band's catalogue from Spotify, Bandcamp and MusicBrainz, marks what the catalogue already holds, and lets the curator tick songs to add as pending.

**Architecture:** Three source adapters (injected `fetch`/Spotify client, so tests never hit the network) feed a pure merge/classify module; a service orchestrates identity, caching, checking and adding; five authed routes expose it; one React view drives it. Identity per source is searched, confirmed by the curator, and saved on the `artists` row.

**Tech Stack:** Node/Express 5, PostgreSQL (`pg`), `spotify-web-api-node`, node:test, React + Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-H-band-check-design.md`

## Global Constraints

- Free sources only; **no new npm dependency** (use built-in `fetch`).
- Nothing is added without a curator click; the only DB writes are the three identity columns on `artists` and pending songs (`status='pending'`, never touching an existing song except `COALESCE`-filling `bandcamp_url` on a song this same add just created).
- **Nothing may log or rethrow a token, a request body, or a raw fetch error's message/cause.** Errors are fixed strings plus `.code` in `NOT_FOUND | RATE_LIMITED | UPSTREAM | UNREADABLE | BAD_INPUT | CONFLICT | BUSY | NO_IDENTITY`.
- MusicBrainz: >= 1.1 s between requests; User-Agent `VeganPlaylist/0.1 (personal curation tool)` — **no personal data in it**.
- Bandcamp: only `https://<sub>.bandcamp.com` origins (`/^[a-z0-9-]+\.bandcamp\.com$/i`); sequential fetches; at most 40 releases per check.
- Add: at most 100 song keys per call; one add at a time per process (`BUSY`).
- Backend tests are serial: `cd backend && npm test` (= `node --test --test-concurrency=1`). New test files use the **unique fixture sentinel `ZZZBAND`** (each file its own: `ZZZBANDSVC`, `ZZZBANDSTG`). Scratchpad scripts must not live in `backend/` and must load `.env` by absolute path.
- Admin copy: usage help only, no definitional chrome (curator prefers less UI). Styling uses existing admin classes/tokens; no raw colours.
- Git: stage **explicit paths** (never `git add backend`/`-A`; `backend/docs/` and `docs/examples/` stay untracked). Commit messages via `git commit -F <file>` and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Spec deviations decided while planning (apply in Task 1): migration is **014** (013 is taken); MusicBrainz candidates omit the per-candidate recording count (it would cost one 1.1 s request each); the insert note is `added via band check (<band name>)` once per add, not per release; a Spotify identity can be **replaced but not cleared** (clearing would orphan a real Spotify artist; `artists_source_check` ties `spotify_id` to `data_source='spotify'`).

## Review Focus

1. **Two bands, one name** (the two Bloodmouths): identify lists both with country/disambiguation (Task 3 test).
2. **Non-Latin or symbol-only titles** (`normalizeName` returns `''`): they must not collapse into one song or be dropped (Task 1 test).
3. **Pasted Bandcamp URL that is not a `*.bandcamp.com` origin** (custom domain, `javascript:`, a `.bandcamp.com.evil.com` lookalike) is rejected with a readable message (Task 4 test).
4. **Spotify id already belonging to a different artist row** -> `CONFLICT`, nothing written (Task 6 test).
5. **Double-click / repeated Add**: second add is all `skippedExisting`; an overlapping add is `BUSY` (Task 7 test).

---

### Task 1: Migration 014 + pure merge module

**Files:**
- Create: `backend/database/migrations/014_band_check_identity.sql`
- Create: `backend/services/bandCheck/merge.js`
- Create: `backend/services/bandCheck/errors.js`
- Test: `backend/test/bandCheckMerge.test.js`
- Modify: `docs/superpowers/specs/2026-10-13-H-band-check-design.md` (the four deviations listed in Global Constraints)

**Interfaces:**
- Produces (`errors.js`): `coded(code, message) -> Error` with `.code`; `MESSAGES` (fixed strings); `fromStatus(status) -> Error` (429/503 -> RATE_LIMITED, 404 -> NOT_FOUND, else UPSTREAM); `sourceError(e) -> Error` (passes through an error whose `.code` is already ours, else maps `e.statusCode || e.status` via `fromStatus`, else UPSTREAM — never copies `e.message`).
- Produces (`merge.js`): `keyOf(title) -> string`; `normUrl(url) -> string|null`; `creditsArtist(track, spotifyArtistId) -> boolean`; `preferRelease(a, b) -> number`; `mergeCatalogues(catalogues) -> song[]`; `buildIndex(rows) -> { bySpotify, byBandcamp, byTitle }`; `classify(songs, index) -> song[]`.
- Catalogue contract (all adapters return this): `{ source: 'spotify'|'bandcamp'|'musicbrainz', releases: [{ id, name, album_type|null, release_date|null, url|null, tracks: [{ title, id|null, url|null, mapped? }] }] }`. `mapped` (Spotify only) is `staging.mapTrack` output.
- Merged song: `{ key, title, sources: { spotify?: { ids: string[], url, mapped }, bandcamp?: { url }, musicbrainz?: { count } }, release: { source, id, name, album_type, release_date }, also_on: string[] }`; after `classify` also `state: 'new'|'in_catalogue'` and `match: { song_id, status, published, matched_by: 'spotify_id'|'bandcamp_url'|'title' } | null`.
- Index rows (input to `buildIndex`): `{ id, title, status, published, spotify_id, bandcamp_url, by_artist }`.

- [ ] **Step 1: Write the migration**

```sql
-- 014 — band check identity (sub-project H). Where a band lives on the two non-Spotify sources the
-- Band check merges; set only by the curator's confirm step. Additive, idempotent. spotify_id already exists.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS bandcamp_url VARCHAR(500);
ALTER TABLE artists ADD COLUMN IF NOT EXISTS musicbrainz_id UUID;
```

Apply it to the dev DB: `cd backend && node -e "require('dotenv').config({quiet:true});const db=require('./database/db');db.query(require('fs').readFileSync('database/migrations/014_band_check_identity.sql','utf8')).then(()=>{console.log('ok');process.exit()})"`. Expected: `ok`.

- [ ] **Step 2: Write `errors.js`**

```js
// Shared error shape for the Band check. Messages are fixed strings: nothing here may carry a token,
// a URL, a request body or a fetch error's message/cause.
const MESSAGES = {
  NOT_FOUND: 'Not found on that source',
  RATE_LIMITED: 'The source is rate-limiting requests - try again in a minute',
  UPSTREAM: 'The source could not be reached',
  UNREADABLE: 'The source page could not be read',
};
const OURS = new Set(['NOT_FOUND', 'RATE_LIMITED', 'UPSTREAM', 'UNREADABLE', 'BAD_INPUT', 'CONFLICT', 'BUSY', 'NO_IDENTITY']);

function coded(code, message) { const e = new Error(message || MESSAGES[code] || code); e.code = code; return e; }

function fromStatus(status) {
  if (status === 429 || status === 503) return coded('RATE_LIMITED');
  if (status === 404) return coded('NOT_FOUND');
  return coded('UPSTREAM');
}

// Normalise anything thrown by a source client into one of our coded errors, dropping its message.
function sourceError(e) {
  if (e && OURS.has(e.code)) return e;
  const status = e && (e.statusCode || e.status);
  return status ? fromStatus(status) : coded('UPSTREAM');
}

module.exports = { MESSAGES, coded, fromStatus, sourceError };
```

- [ ] **Step 3: Write the failing tests** (`backend/test/bandCheckMerge.test.js`)

```js
const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../services/bandCheck/merge');
const { sourceError } = require('../services/bandCheck/errors');

const sp = (id, name, type, date, tracks) => ({ id, name, album_type: type, release_date: date, url: null, tracks });
const tr = (title, id, url) => ({ title, id, url: url || null, mapped: { spotify_id: id, title } });

test('creditsArtist matches on the Spotify artist id only', () => {
  assert.equal(m.creditsArtist({ artists: [{ id: 'A' }, { id: 'B' }] }, 'B'), true);
  assert.equal(m.creditsArtist({ artists: [{ id: 'A' }] }, 'B'), false);
  assert.equal(m.creditsArtist({ artists: [{ id: 'A' }] }, null), false);
  assert.equal(m.creditsArtist({}, 'A'), false);
});

test('preferRelease: album beats compilation beats single, then earliest date, then id; MusicBrainz last', () => {
  const rel = (o) => ({ source: 'spotify', id: 'x', album_type: 'album', release_date: '2020', ...o });
  assert.ok(m.preferRelease(rel({}), rel({ album_type: 'single' })) < 0);
  assert.ok(m.preferRelease(rel({ album_type: 'compilation' }), rel({ album_type: 'single' })) < 0);
  assert.ok(m.preferRelease(rel({ release_date: '2019' }), rel({ release_date: '2020' })) < 0);
  assert.ok(m.preferRelease(rel({ id: 'a' }), rel({ id: 'b' })) < 0);
  assert.ok(m.preferRelease(rel({ source: 'bandcamp', album_type: 'single' }), rel({ source: 'musicbrainz', album_type: 'album' })) < 0);
});

test('mergeCatalogues collapses a single and its album, keeping every alternate Spotify id', () => {
  const songs = m.mergeCatalogues([{ source: 'spotify', releases: [
    sp('r1', 'The Floor (single)', 'single', '2019-01-01', [tr('The Floor', 'id1')]),
    sp('r2', 'Album', 'album', '2020-05-05', [tr('The Floor', 'id2'), tr('Other', 'id3')]),
  ] }]);
  assert.equal(songs.length, 2);
  const floor = songs.find(s => s.key === 'the floor');
  assert.deepEqual(floor.sources.spotify.ids.sort(), ['id1', 'id2']);
  assert.equal(floor.release.name, 'Album');
  assert.deepEqual(floor.also_on, ['The Floor (single)']);
});

test('one song on three sources is one song with three source entries', () => {
  const songs = m.mergeCatalogues([
    { source: 'spotify', releases: [sp('r1', 'Alb', 'album', '2020', [tr('Rubble From Bone', 's1', 'https://open.spotify.com/track/s1')])] },
    { source: 'bandcamp', releases: [{ id: '/album/alb', name: 'Alb', album_type: 'album', release_date: '2020-01-01', url: null,
      tracks: [{ title: 'Rubble from Bone', id: null, url: 'https://x.bandcamp.com/track/rubble' }] }] },
    { source: 'musicbrainz', releases: [{ id: 'mb', name: 'MusicBrainz recordings', album_type: null, release_date: null, url: null,
      tracks: [{ title: 'rubble from bone', id: 'm1', url: null }, { title: 'rubble from bone', id: 'm2', url: null }] }] },
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(Object.keys(songs[0].sources).sort(), ['bandcamp', 'musicbrainz', 'spotify']);
  assert.equal(songs[0].sources.bandcamp.url, 'https://x.bandcamp.com/track/rubble');
  assert.equal(songs[0].sources.musicbrainz.count, 2);
  assert.notEqual(songs[0].release.source, 'musicbrainz');
  assert.ok(!songs[0].also_on.includes('MusicBrainz recordings'));
});

test('a Bandcamp-only song stays single-source', () => {
  const songs = m.mergeCatalogues([{ source: 'bandcamp', releases: [{ id: '/track/t', name: 'T', album_type: 'single', release_date: null, url: null,
    tracks: [{ title: 'Only Here', id: null, url: 'https://x.bandcamp.com/track/t' }] }] }]);
  assert.deepEqual(Object.keys(songs[0].sources), ['bandcamp']);
});

test('non-Latin and symbol-only titles neither vanish nor collapse together', () => {
  const songs = m.mergeCatalogues([{ source: 'bandcamp', releases: [{ id: '/album/a', name: 'A', album_type: 'album', release_date: null, url: null, tracks: [
    { title: 'Смерть', id: null, url: null }, { title: 'Жизнь', id: null, url: null }, { title: '???', id: null, url: null }, { title: '   ', id: null, url: null },
  ] }] }]);
  assert.deepEqual(songs.map(s => s.title).sort(), ['???', 'Жизнь', 'Смерть'].sort());
});

test('classify: spotify id, bandcamp url and title matches; rejected flagged; none is new', () => {
  const index = m.buildIndex([
    { id: 1, title: 'Held By Id', status: 'included', published: true, spotify_id: 'idA', bandcamp_url: null, by_artist: true },
    { id: 2, title: 'Zzz', status: 'pending', published: false, spotify_id: null, bandcamp_url: 'https://X.bandcamp.com/track/held/?utm=1', by_artist: true },
    { id: 3, title: 'Held By Title (Live)', status: 'rejected', published: false, spotify_id: null, bandcamp_url: null, by_artist: true },
    { id: 4, title: 'Not This Band', status: 'included', published: true, spotify_id: null, bandcamp_url: null, by_artist: false },
  ]);
  const songs = [
    { key: 'a', sources: { spotify: { ids: ['nope', 'idA'] } } },
    { key: 'b', sources: { bandcamp: { url: 'https://x.bandcamp.com/track/held' } } },
    { key: 'held by title', sources: { musicbrainz: { count: 1 } } },
    { key: 'not this band', sources: { musicbrainz: { count: 1 } } },
  ];
  const out = m.classify(songs, index);
  assert.deepEqual(out.map(s => s.state), ['in_catalogue', 'in_catalogue', 'in_catalogue', 'new']);
  assert.deepEqual(out.map(s => s.match && s.match.matched_by), ['spotify_id', 'bandcamp_url', 'title', null]);
  assert.equal(out[2].match.status, 'rejected');
});

test('sourceError drops the original message and maps statuses', () => {
  const e = sourceError(Object.assign(new Error('secret token in here'), { statusCode: 429 }));
  assert.equal(e.code, 'RATE_LIMITED');
  assert.ok(!/secret/.test(e.message));
  assert.equal(sourceError(new Error('boom')).code, 'UPSTREAM');
  assert.equal(sourceError(Object.assign(new Error('x'), { code: 'UNREADABLE' })).code, 'UNREADABLE');
});
```

- [ ] **Step 4: Run to verify failure** — `cd backend && node --test test/bandCheckMerge.test.js`. Expected: FAIL `Cannot find module '../services/bandCheck/merge'`.

- [ ] **Step 5: Write `merge.js`**

```js
// Pure (no DB, no network): the cross-source merge and the catalogue classification behind the Band check.
const { normalizeName } = require('../staging'); // same key the Spotify-push duplicate check uses

const TYPE_RANK = { album: 0, compilation: 1, single: 2 };
const SOURCE_RANK = { spotify: 0, bandcamp: 0, musicbrainz: 1 }; // MusicBrainz is one pseudo-release: never the representative if another source has the song
const STATUS_RANK = { included: 0, pending: 1, rejected: 2 };

// normalizeName() is '' for non-Latin / symbol-only titles; fall back to the lowercased title so they stay distinct.
function keyOf(title) {
  const t = String(title || '').trim();
  return normalizeName(t) || t.toLowerCase();
}

// host + path, no query/hash/trailing slash, lowercase host — for comparing Bandcamp URLs.
function normUrl(u) {
  try {
    const x = new URL(u);
    return x.hostname.toLowerCase() + x.pathname.replace(/\/+$/, '');
  } catch { return null; }
}

function creditsArtist(track, spotifyArtistId) {
  return !!spotifyArtistId && (track.artists || []).some(a => a.id === spotifyArtistId);
}

// Negative when `a` is the better representative of a song.
function preferRelease(a, b) {
  const s = (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
  if (s) return s;
  const t = (TYPE_RANK[a.album_type] ?? 3) - (TYPE_RANK[b.album_type] ?? 3);
  if (t) return t;
  const da = a.release_date || '9999', db = b.release_date || '9999';
  if (da !== db) return da < db ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

function mergeCatalogues(catalogues) {
  const byKey = new Map();
  for (const cat of catalogues) {
    for (const rel of cat.releases) {
      const info = { source: cat.source, id: rel.id, name: rel.name, album_type: rel.album_type || null, release_date: rel.release_date || null };
      for (const t of rel.tracks) {
        const key = keyOf(t.title);
        if (!key) continue;
        let s = byKey.get(key);
        if (!s) { s = { key, title: String(t.title).trim(), sources: {}, _rels: [] }; byKey.set(key, s); }
        s._rels.push({ ...info, title: String(t.title).trim() });
        if (cat.source === 'spotify') {
          const cur = s.sources.spotify;
          if (!cur) s.sources.spotify = { ids: [t.id], url: t.url || null, mapped: t.mapped || null, _rel: info };
          else {
            if (t.id && !cur.ids.includes(t.id)) cur.ids.push(t.id);
            if (preferRelease(info, cur._rel) < 0) Object.assign(cur, { url: t.url || null, mapped: t.mapped || null, _rel: info });
          }
        } else if (cat.source === 'bandcamp') {
          const cur = s.sources.bandcamp;
          if (!cur) s.sources.bandcamp = { url: t.url || null, _rel: info };
          else if (preferRelease(info, cur._rel) < 0) Object.assign(cur, { url: t.url || null, _rel: info });
        } else {
          s.sources.musicbrainz = { count: (s.sources.musicbrainz ? s.sources.musicbrainz.count : 0) + 1 };
        }
      }
    }
  }
  return [...byKey.values()].map(s => {
    s._rels.sort(preferRelease);
    const best = s._rels[0];
    const also = [...new Set(s._rels.filter(r => r.source !== 'musicbrainz' && r.name !== best.name).map(r => r.name))];
    for (const k of ['spotify', 'bandcamp']) if (s.sources[k]) delete s.sources[k]._rel;
    const { _rels, ...song } = s;
    return { ...song, title: best.title, release: { source: best.source, id: best.id, name: best.name, album_type: best.album_type, release_date: best.release_date }, also_on: also };
  });
}

// rows: songs relevant to ONE band — { id, title, status, published, spotify_id, bandcamp_url, by_artist }.
// Spotify-id and Bandcamp-url matches may be any catalogue song; title matches only songs credited to this band.
function buildIndex(rows) {
  const idx = { bySpotify: new Map(), byBandcamp: new Map(), byTitle: new Map() };
  const put = (map, k, row) => {
    if (!k) return;
    const cur = map.get(k);
    if (!cur || (STATUS_RANK[row.status] ?? 3) < (STATUS_RANK[cur.status] ?? 3)) map.set(k, row);
  };
  for (const r of rows) {
    put(idx.bySpotify, r.spotify_id, r);
    put(idx.byBandcamp, normUrl(r.bandcamp_url), r);
    if (r.by_artist) put(idx.byTitle, keyOf(r.title), r);
  }
  return idx;
}

function classify(songs, index) {
  return songs.map(s => {
    let hit = null, by = null;
    for (const id of (s.sources.spotify && s.sources.spotify.ids) || []) {
      if (index.bySpotify.has(id)) { hit = index.bySpotify.get(id); by = 'spotify_id'; break; }
    }
    if (!hit && s.sources.bandcamp && s.sources.bandcamp.url) {
      const h = index.byBandcamp.get(normUrl(s.sources.bandcamp.url));
      if (h) { hit = h; by = 'bandcamp_url'; }
    }
    if (!hit && index.byTitle.has(s.key)) { hit = index.byTitle.get(s.key); by = 'title'; }
    return hit
      ? { ...s, state: 'in_catalogue', match: { song_id: hit.id, status: hit.status, published: hit.published, matched_by: by } }
      : { ...s, state: 'new', match: null };
  });
}

module.exports = { keyOf, normUrl, creditsArtist, preferRelease, mergeCatalogues, buildIndex, classify };
```

- [ ] **Step 6: Run to verify pass** — `cd backend && node --test test/bandCheckMerge.test.js`. Expected: all PASS.

- [ ] **Step 7: Apply the spec deviations** — in the spec: §3 "migration 013" -> "014" (two places, incl. §2); §4.1 MusicBrainz `identify` drop "recording count"; §4.3 `addSelected` note -> `added via band check (<band name>)`; §4.3 `saveIdentity` add "a Spotify identity can be replaced but not cleared (`artists_source_check` ties `spotify_id` to `data_source='spotify'`)". Use the Edit tool per hunk.

- [ ] **Step 8: Commit**

```bash
git add backend/database/migrations/014_band_check_identity.sql backend/services/bandCheck/merge.js backend/services/bandCheck/errors.js backend/test/bandCheckMerge.test.js docs/superpowers/specs/2026-10-13-H-band-check-design.md
git commit -F <scratchpad msg: "feat(band-check): migration 014 + pure cross-source merge">
```

---

### Task 2: Spotify adapter

**Files:**
- Create: `backend/services/bandCheck/spotify.js`
- Modify: `backend/services/staging.js` (export `mapTrack` — change the final `module.exports` to include it)
- Test: `backend/test/bandCheckSpotify.test.js`

**Interfaces:**
- Consumes: `creditsArtist` (merge.js), `sourceError` (errors.js), `mapTrack` (staging), `getSpotifyClient`/`withRetry` (`utils/playlistSync`).
- Produces: `createSpotifyAdapter({ getApi?, retry? }) -> { source: 'spotify', identify(query) -> Candidate[], fetchCatalogue(spotifyArtistId) -> Catalogue }`. `Candidate = { value, label, detail, url }`.

- [ ] **Step 1: Export `mapTrack`** — in `staging.js` `module.exports` add `mapTrack`. (No test of its own; Task 2's test covers it through the adapter.)

- [ ] **Step 2: Write the failing tests** (`backend/test/bandCheckSpotify.test.js`)

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createSpotifyAdapter } = require('../services/bandCheck/spotify');

const BAND = 'bandid0000000000000000';
const album = (id, name, type, date) => ({ id, name, album_type: type, release_date: date, images: [], total_tracks: 2, external_urls: { spotify: `https://open.spotify.com/album/${id}` } });
const track = (id, name, artistIds) => ({ id, name, track_number: 1, disc_number: 1, duration_ms: 1000, explicit: false, external_urls: { spotify: `https://open.spotify.com/track/${id}` }, artists: artistIds.map(a => ({ id: a, name: a })) });

function fakeApi({ albums, tracksByAlbum, calls = [] }) {
  return {
    calls,
    searchArtists: async (q) => { calls.push(['search', q]); return { body: { artists: { items: [{ id: BAND, name: 'Bloodmouth', followers: { total: 1234 }, genres: ['grindcore'], external_urls: { spotify: 'https://open.spotify.com/artist/x' } }] } } }; },
    getArtistAlbums: async (id, o) => { calls.push(['albums', id, o.offset]); return { body: { items: albums.slice(o.offset, o.offset + o.limit) } }; },
    getAlbumTracks: async (id, o) => { calls.push(['tracks', id, o.offset]); return { body: { items: (tracksByAlbum[id] || []).slice(o.offset, o.offset + o.limit) } }; },
  };
}
const adapterFor = (api) => createSpotifyAdapter({ getApi: async () => api, retry: (fn) => fn() });

test('fetchCatalogue keeps only tracks crediting the band and maps them with the release as album', async () => {
  const api = fakeApi({
    albums: [album('r1', 'Own Album', 'album', '2020'), album('r2', 'Comp', 'compilation', '2021'), album('r3', 'Others', 'compilation', '2022')],
    tracksByAlbum: {
      r1: [track('t1', 'Song A', [BAND]), track('t2', 'Song B', [BAND, 'guest'])],
      r2: [track('t3', 'Other Band Song', ['other']), track('t4', 'Black Mass', ['other', BAND])],
      r3: [track('t5', 'Nope', ['other'])],
    },
  });
  const cat = await adapterFor(api).fetchCatalogue(BAND);
  assert.equal(cat.source, 'spotify');
  assert.deepEqual(cat.releases.map(r => r.name), ['Own Album', 'Comp']); // 'Others' credits nobody -> dropped
  assert.deepEqual(cat.releases[1].tracks.map(t => t.title), ['Black Mass']);
  const t = cat.releases[0].tracks[0];
  assert.equal(t.id, 't1');
  assert.equal(t.mapped.album.name, 'Own Album');
  assert.equal(t.mapped.spotify_id, 't1');
});

test('fetchCatalogue pages albums and tracks of exactly 50', async () => {
  const albums = Array.from({ length: 51 }, (_, i) => album('r' + i, 'A' + i, 'single', '2020'));
  const tracksByAlbum = Object.fromEntries(albums.map(a => [a.id, [track('t' + a.id, 'S' + a.id, [BAND])]]));
  const api = fakeApi({ albums, tracksByAlbum });
  const cat = await adapterFor(api).fetchCatalogue(BAND);
  assert.equal(cat.releases.length, 51);
  assert.deepEqual(api.calls.filter(c => c[0] === 'albums').map(c => c[2]), [0, 50]);
});

test('identify maps artist search results to candidates', async () => {
  const c = await adapterFor(fakeApi({ albums: [], tracksByAlbum: {} })).identify('Bloodmouth');
  assert.deepEqual(c, [{ value: BAND, label: 'Bloodmouth', detail: '1,234 followers · grindcore', url: 'https://open.spotify.com/artist/x' }]);
});

test('a 429 surfaces as RATE_LIMITED without the original message', async () => {
  const api = { getArtistAlbums: async () => { throw Object.assign(new Error('Bearer abc123'), { statusCode: 429 }); } };
  await assert.rejects(adapterFor(api).fetchCatalogue(BAND), (e) => e.code === 'RATE_LIMITED' && !/abc123/.test(e.message));
});
```

- [ ] **Step 3: Run to verify failure** — `node --test test/bandCheckSpotify.test.js` -> FAIL `Cannot find module`.

- [ ] **Step 4: Write `spotify.js`**

```js
// Spotify source for the Band check. Reads only (client credentials). Errors are coded, never raw.
const { getSpotifyClient, withRetry } = require('../../utils/playlistSync');
const { mapTrack } = require('../staging');
const { creditsArtist } = require('./merge');
const { sourceError } = require('./errors');

const PAGE = 50;

function createSpotifyAdapter({ getApi = getSpotifyClient, retry = withRetry } = {}) {
  const call = (fn) => retry(fn, { maxWaitS: 30, maxRetries: 3 });

  async function pageAll(fetchPage) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const items = await fetchPage(PAGE, offset);
      out.push(...items);
      if (items.length < PAGE) return out;
    }
  }

  async function identify(query) {
    try {
      const api = await getApi();
      const res = await call(() => api.searchArtists(query, { limit: 8 }));
      return res.body.artists.items.map(a => ({
        value: a.id,
        label: a.name,
        detail: [`${(a.followers && a.followers.total || 0).toLocaleString('en-US')} followers`, (a.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
        url: (a.external_urls && a.external_urls.spotify) || null,
      }));
    } catch (e) { throw sourceError(e); }
  }

  async function fetchCatalogue(spotifyId) {
    try {
      const api = await getApi();
      const albums = await pageAll((limit, offset) => call(() =>
        api.getArtistAlbums(spotifyId, { include_groups: 'album,single,compilation,appears_on', limit, offset })).then(r => r.body.items));
      const releases = [];
      for (const alb of albums) {
        const tracks = await pageAll((limit, offset) => call(() => api.getAlbumTracks(alb.id, { limit, offset })).then(r => r.body.items));
        const credited = tracks.filter(t => creditsArtist(t, spotifyId));
        if (credited.length === 0) continue; // an "appears on" release that does not credit the band
        releases.push({
          id: alb.id, name: alb.name, album_type: alb.album_type || null, release_date: alb.release_date || null,
          url: (alb.external_urls && alb.external_urls.spotify) || null,
          tracks: credited.map(t => ({
            title: t.name, id: t.id, url: (t.external_urls && t.external_urls.spotify) || null,
            mapped: mapTrack({ ...t, album: alb }),
          })),
        });
      }
      return { source: 'spotify', releases };
    } catch (e) { throw sourceError(e); }
  }

  return { source: 'spotify', identify, fetchCatalogue };
}

module.exports = { createSpotifyAdapter };
```

- [ ] **Step 5: Run to verify pass** — `node --test test/bandCheckSpotify.test.js` -> PASS. Also `node --test test/staging.test.js` still passes.

- [ ] **Step 6: Commit** (`backend/services/bandCheck/spotify.js backend/services/staging.js backend/test/bandCheckSpotify.test.js`; message "feat(band-check): Spotify source adapter").

---

### Task 3: MusicBrainz adapter

**Files:**
- Create: `backend/services/bandCheck/musicbrainz.js`
- Test: `backend/test/bandCheckMusicbrainz.test.js`

**Interfaces:**
- Consumes: `coded`, `fromStatus` (errors.js).
- Produces: `createMusicBrainzAdapter({ fetch, sleep?, now?, userAgent?, gapMs? }) -> { source: 'musicbrainz', identify(query), fetchCatalogue(mbid), bandcampLink(mbid) -> string|null }`. `fetch(url, { headers }) -> { ok, status, json() }`.

- [ ] **Step 1: Write the failing tests**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createMusicBrainzAdapter } = require('../services/bandCheck/musicbrainz');

const MBID = 'bd59cf43-e0b1-4e09-a912-4a35a78bb446';
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

function harness(handler) {
  const urls = [], sleeps = [];
  let t = 1_000_000;
  const adapter = createMusicBrainzAdapter({
    fetch: async (url, opts) => { urls.push({ url, opts }); return handler(url); },
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    now: () => t,
  });
  return { adapter, urls, sleeps };
}

test('identify lists same-named bands with country and disambiguation', async () => {
  const { adapter, urls } = harness(() => ok({ artists: [
    { id: MBID, name: 'Bloodmouth', country: 'US', score: 100 },
    { id: '6d9f3695-6647-4def-9780-7ec235fba0b8', name: 'Bloodmouth', country: 'AU', disambiguation: 'Vegan', score: 98 },
  ] }));
  const c = await adapter.identify('Bloodmouth');
  assert.deepEqual(c.map(x => x.detail), ['US', 'AU · Vegan']);
  assert.equal(c[0].url, `https://musicbrainz.org/artist/${MBID}`);
  assert.match(urls[0].url, /query=artist%3A%22Bloodmouth%22/);
  assert.match(urls[0].opts.headers['User-Agent'], /^VeganPlaylist\/0\.1 \(personal curation tool\)$/);
});

test('fetchCatalogue pages recordings into one pseudo-release and paces requests >= 1.1s apart', async () => {
  const page = (n, start) => ({ 'recording-count': 150, recordings: Array.from({ length: n }, (_, i) => ({ id: 'r' + (start + i), title: 'Rec ' + (start + i) })) });
  const { adapter, urls, sleeps } = harness((url) => ok(/offset=100/.test(url) ? page(50, 100) : page(100, 0)));
  const cat = await adapter.fetchCatalogue(MBID);
  assert.equal(cat.source, 'musicbrainz');
  assert.equal(cat.releases.length, 1);
  assert.equal(cat.releases[0].tracks.length, 150);
  assert.equal(urls.length, 2);
  assert.ok(sleeps.length >= 1 && sleeps.every(ms => ms >= 1000));
});

test('fetchCatalogue rejects a non-UUID id without calling the network', async () => {
  const { adapter, urls } = harness(() => ok({}));
  await assert.rejects(adapter.fetchCatalogue('../../x'), (e) => e.code === 'NOT_FOUND');
  assert.equal(urls.length, 0);
});

test('bandcampLink reads the bandcamp url-rel, or null', async () => {
  const withLink = harness(() => ok({ relations: [{ type: 'official homepage', url: { resource: 'https://x.org' } }, { type: 'bandcamp', url: { resource: 'https://bloodmouth.bandcamp.com/' } }] }));
  assert.equal(await withLink.adapter.bandcampLink(MBID), 'https://bloodmouth.bandcamp.com/');
  const none = harness(() => ok({ relations: [] }));
  assert.equal(await none.adapter.bandcampLink(MBID), null);
});

test('503 -> RATE_LIMITED, a thrown fetch -> UPSTREAM with no message leaked', async () => {
  const limited = harness(() => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(limited.adapter.identify('x'), (e) => e.code === 'RATE_LIMITED');
  const a = createMusicBrainzAdapter({ fetch: async () => { throw new Error('connect ECONNRESET https://secret'); }, sleep: async () => {}, now: () => 1 });
  await assert.rejects(a.identify('x'), (e) => e.code === 'UPSTREAM' && !/secret/.test(e.message));
});
```

- [ ] **Step 2: Run to verify failure** — FAIL `Cannot find module`.

- [ ] **Step 3: Write `musicbrainz.js`**

```js
// MusicBrainz source for the Band check: keyless JSON API, 1 request/second, descriptive User-Agent (no personal data).
const { coded, fromStatus } = require('./errors');

const BASE = 'https://musicbrainz.org/ws/2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;
const MAX_PAGES = 10; // 1,000 recordings is far past any band here

function createMusicBrainzAdapter({
  fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), now = Date.now,
  userAgent = 'VeganPlaylist/0.1 (personal curation tool)', gapMs = 1100,
}) {
  let last = 0;

  async function get(path) {
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    let res;
    try { res = await fetch(BASE + path, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } }); }
    catch { throw coded('UPSTREAM'); }
    if (!res.ok) throw fromStatus(res.status);
    try { return await res.json(); } catch { throw coded('UNREADABLE'); }
  }

  async function identify(query) {
    const q = String(query || '').replace(/["\\]/g, ' ').trim();
    if (!q) return [];
    const j = await get(`/artist?query=${encodeURIComponent(`artist:"${q}"`)}&fmt=json&limit=6`);
    return (j.artists || []).map(a => ({
      value: a.id,
      label: a.name,
      detail: [a.country || '?', a.disambiguation].filter(Boolean).join(' · '),
      url: `https://musicbrainz.org/artist/${a.id}`,
    }));
  }

  async function fetchCatalogue(mbid) {
    if (!UUID.test(String(mbid))) throw coded('NOT_FOUND');
    const tracks = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const j = await get(`/recording?artist=${mbid}&fmt=json&limit=${PAGE}&offset=${page * PAGE}`);
      const items = j.recordings || [];
      for (const r of items) tracks.push({ title: r.title, id: r.id, url: `https://musicbrainz.org/recording/${r.id}` });
      if (items.length < PAGE || tracks.length >= (j['recording-count'] || 0)) break;
    }
    return { source: 'musicbrainz', releases: [{ id: 'mb', name: 'MusicBrainz recordings', album_type: null, release_date: null, url: null, tracks }] };
  }

  // The band's Bandcamp page, if MusicBrainz knows it (a candidate for the Bandcamp identity).
  async function bandcampLink(mbid) {
    if (!UUID.test(String(mbid))) return null;
    const j = await get(`/artist/${mbid}?inc=url-rels&fmt=json`);
    const rel = (j.relations || []).find(r => r.type === 'bandcamp' && r.url && r.url.resource);
    return rel ? rel.url.resource : null;
  }

  return { source: 'musicbrainz', identify, fetchCatalogue, bandcampLink };
}

module.exports = { createMusicBrainzAdapter };
```

- [ ] **Step 4: Run to verify pass** -> PASS.
- [ ] **Step 5: Commit** (`musicbrainz.js` + test; "feat(band-check): MusicBrainz source adapter").

---

### Task 4: Bandcamp adapter

**Files:**
- Create: `backend/services/bandCheck/bandcamp.js`
- Create: `backend/services/bandCheck/http.js`
- Test: `backend/test/bandCheckBandcamp.test.js`

**Interfaces:**
- Consumes: `coded`, `fromStatus`.
- Produces (`bandcamp.js`): `normalizeBandcampOrigin(input) -> 'https://sub.bandcamp.com' | null`; `createBandcampAdapter({ fetch, sleep? }) -> { source: 'bandcamp', fetchCatalogue(origin) }`. (No `identify`; candidates are built by the service from song links + MusicBrainz.)
- Produces (`http.js`): `defaultFetch(url, opts)` = global `fetch` with a 10 s `AbortSignal.timeout`, exposing `{ ok, status, json(), text() }`.

- [ ] **Step 1: Write the failing tests**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeBandcampOrigin, createBandcampAdapter } = require('../services/bandCheck/bandcamp');

const ORIGIN = 'https://bloodmouth.bandcamp.com';
const page = (body) => ({ ok: true, status: 200, text: async () => body });
const ld = (obj) => `<html><script type="application/ld+json">${JSON.stringify(obj)}</script></html>`;
const album = (name, tracks, date = '13 Jun 2019 12:32:59 GMT') => ld({
  '@type': 'MusicAlbum', name, datePublished: date,
  track: { itemListElement: tracks.map((t, i) => ({ position: i + 1, item: { name: t, '@id': `${ORIGIN}/track/${t.replace(/ /g, '-')}` } })) },
});
const MUSIC = '<a href="/album/one">x</a><a href="/album/one">dup</a><a href="/track/lone">y</a><a href="/album/two?label=1">z</a>';

function adapterFor(map) {
  const urls = [];
  const a = createBandcampAdapter({
    fetch: async (url) => { urls.push(url); const v = map[url]; return v === undefined ? { ok: false, status: 404, text: async () => '' } : v; },
    sleep: async () => {},
  });
  return { a, urls };
}

test('normalizeBandcampOrigin accepts only https *.bandcamp.com and returns the bare origin', () => {
  assert.equal(normalizeBandcampOrigin('https://Bloodmouth.bandcamp.com/album/x?y=1'), ORIGIN);
  assert.equal(normalizeBandcampOrigin('http://bloodmouth.bandcamp.com/'), ORIGIN);
  assert.equal(normalizeBandcampOrigin('bloodmouth.bandcamp.com'), null); // needs a scheme
  for (const bad of ['https://bandcamp.com/', 'https://bloodmouth.bandcamp.com.evil.com/', 'https://evil.com/bloodmouth.bandcamp.com', 'javascript:alert(1)', 'https://music.example.org/', '', null, undefined]) {
    assert.equal(normalizeBandcampOrigin(bad), null, String(bad));
  }
});

test('fetchCatalogue reads releases from /music and tracks from each page JSON-LD', async () => {
  const { a } = adapterFor({
    [ORIGIN + '/music']: page(MUSIC),
    [ORIGIN + '/album/one']: page(album('One', ['Prism Warden', 'Paleo Christ'])),
    [ORIGIN + '/track/lone']: page(ld({ '@type': 'MusicRecording', name: 'Lone Song', '@id': ORIGIN + '/track/lone', datePublished: '01 Jan 2020 00:00:00 GMT' })),
    [ORIGIN + '/album/two']: page(album('Two', ['Third'])),
  });
  const cat = await a.fetchCatalogue(ORIGIN);
  assert.equal(cat.source, 'bandcamp');
  assert.deepEqual(cat.releases.map(r => r.name), ['One', 'Lone Song', 'Two']);
  assert.deepEqual(cat.releases[0].tracks.map(t => t.title), ['Prism Warden', 'Paleo Christ']);
  assert.equal(cat.releases[0].tracks[0].url, ORIGIN + '/track/Prism-Warden');
  assert.equal(cat.releases[0].release_date, '2019-06-13');
  assert.equal(cat.releases[1].album_type, 'single');
  assert.equal(cat.releases[1].tracks[0].url, ORIGIN + '/track/lone');
});

test('one unreadable release is skipped; all unreadable is UNREADABLE', async () => {
  const some = adapterFor({ [ORIGIN + '/music']: page('<a href="/album/one">x</a><a href="/album/two">y</a>'), [ORIGIN + '/album/one']: page('<html>no json</html>'), [ORIGIN + '/album/two']: page(album('Two', ['T'])) });
  assert.deepEqual((await some.a.fetchCatalogue(ORIGIN)).releases.map(r => r.name), ['Two']);
  const none = adapterFor({ [ORIGIN + '/music']: page('<a href="/album/one">x</a>'), [ORIGIN + '/album/one']: page('<script type="application/ld+json">{not json</script>') });
  await assert.rejects(none.a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
  const empty = adapterFor({ [ORIGIN + '/music']: page('<html>nothing</html>') });
  await assert.rejects(empty.a.fetchCatalogue(ORIGIN), (e) => e.code === 'UNREADABLE');
});

test('caps at 40 releases and refuses a non-bandcamp origin without fetching', async () => {
  const links = Array.from({ length: 60 }, (_, i) => `<a href="/album/a${i}">x</a>`).join('');
  const map = { [ORIGIN + '/music']: page(links) };
  for (let i = 0; i < 60; i++) map[ORIGIN + '/album/a' + i] = page(album('A' + i, ['T' + i]));
  const { a, urls } = adapterFor(map);
  assert.equal((await a.fetchCatalogue(ORIGIN)).releases.length, 40);
  assert.equal(urls.length, 41);
  const bad = adapterFor({});
  await assert.rejects(bad.a.fetchCatalogue('https://evil.com'), (e) => e.code === 'NOT_FOUND');
  assert.equal(bad.urls.length, 0);
});

test('a 404 on /music is NOT_FOUND and a thrown fetch is UPSTREAM without its message', async () => {
  await assert.rejects(adapterFor({}).a.fetchCatalogue(ORIGIN), (e) => e.code === 'NOT_FOUND');
  const a = createBandcampAdapter({ fetch: async () => { throw new Error('ECONNRESET secret'); }, sleep: async () => {} });
  await assert.rejects(a.fetchCatalogue(ORIGIN), (e) => e.code === 'UPSTREAM' && !/secret/.test(e.message));
});
```

- [ ] **Step 2: Run to verify failure** — FAIL `Cannot find module`.

- [ ] **Step 3: Write `http.js`**

```js
// The real network call the Band check adapters use. Adapters take `fetch` by injection so tests never reach this.
async function defaultFetch(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
}
module.exports = { defaultFetch };
```

- [ ] **Step 4: Write `bandcamp.js`**

```js
// Bandcamp source for the Band check. Bandcamp has no API: this reads the public /music page and each release
// page's embedded JSON-LD tracklist. Markup changes fail as UNREADABLE for this source only.
const { coded, fromStatus } = require('./errors');

const HOST = /^[a-z0-9-]+\.bandcamp\.com$/i;
const MAX_RELEASES = 40;
const UA = 'VeganPlaylist/0.1 (personal curation tool)';

// Any https/http *.bandcamp.com URL -> its bare https origin; everything else (custom domains, lookalikes, non-http) -> null.
function normalizeBandcampOrigin(input) {
  if (typeof input !== 'string') return null;
  let u;
  try { u = new URL(input.trim()); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !HOST.test(u.hostname) || u.username || u.password) return null;
  return 'https://' + u.hostname.toLowerCase();
}

function isoDate(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function readLd(html) {
  const m = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function createBandcampAdapter({ fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), gapMs = 250 }) {
  async function getText(url) {
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA } }); }
    catch { throw coded('UPSTREAM'); }
    if (!res.ok) throw fromStatus(res.status);
    try { return await res.text(); } catch { throw coded('UNREADABLE'); }
  }

  async function fetchCatalogue(originInput) {
    const origin = normalizeBandcampOrigin(originInput);
    if (!origin) throw coded('NOT_FOUND');
    const host = new URL(origin).hostname;
    const music = await getText(origin + '/music');
    const paths = [...new Set([...music.matchAll(/href="(\/(?:album|track)\/[^"#?]+)/g)].map(m => m[1]))].slice(0, MAX_RELEASES);
    if (paths.length === 0) throw coded('UNREADABLE');

    const releases = [];
    for (const path of paths) {
      await sleep(gapMs);
      let ldObj = null;
      try { ldObj = readLd(await getText(origin + path)); } catch (e) { if (e.code === 'UPSTREAM' || e.code === 'RATE_LIMITED') throw e; }
      if (!ldObj || !ldObj.name) continue; // this release page could not be read; keep going
      const trackUrl = (u, fallback) => { try { return new URL(u).hostname === host ? u : fallback; } catch { return fallback; } };
      const items = ldObj.track && ldObj.track.itemListElement;
      const tracks = Array.isArray(items)
        ? items.filter(i => i && i.item && i.item.name).map(i => ({ title: i.item.name, id: null, url: trackUrl(i.item['@id'], origin + path) }))
        : [{ title: ldObj.name, id: null, url: trackUrl(ldObj['@id'], origin + path) }];
      if (tracks.length === 0) continue;
      releases.push({
        id: path, name: ldObj.name, album_type: path.startsWith('/track/') ? 'single' : 'album',
        release_date: ldObj.datePublished ? isoDate(ldObj.datePublished) : null, url: origin + path, tracks,
      });
    }
    if (releases.length === 0) throw coded('UNREADABLE');
    return { source: 'bandcamp', releases };
  }

  return { source: 'bandcamp', fetchCatalogue };
}

module.exports = { normalizeBandcampOrigin, createBandcampAdapter };
```

- [ ] **Step 5: Run to verify pass** -> PASS. (If the cap test shows 41 fetched URLs wrong, the cap is `slice(0, 40)` of paths, so 1 + 40 = 41 — matches.)
- [ ] **Step 6: Commit** (`bandcamp.js http.js` + test; "feat(band-check): Bandcamp source adapter").

---

### Task 5: Staging changes — note argument, manual candidate, origin tag

**Files:**
- Modify: `backend/services/staging.js` (`insertCandidates` at ~line 98; add `insertManualCandidate`; exports)
- Modify: `backend/services/curation.js` (the `origin` CASE at ~line 138)
- Modify: `frontend/src/components/admin/SongQueueList.jsx:6` (`ORIGIN_LABELS`)
- Test: `backend/test/bandCheckStaging.test.js` (sentinel `ZZZBANDSTG`)

**Interfaces:**
- Produces: `staging.insertCandidates(db, tracks, { note } = {})` (default note unchanged); `staging.insertManualCandidate(db, { title, artistId, bandcamp_url?, note }) -> { added: 0|1, skippedExisting: 0|1, song_id: number|null }`; `origin = 'bandcheck'` in the curation queue rows; UI label **From band check**.

- [ ] **Step 1: Write the failing tests**

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const staging = require('../services/staging');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZBANDSTG.
async function mkArtist(name = 'ZZZBANDSTG Band') {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0].id;
}
after(async () => {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBANDSTG%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZBANDSTG%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZBANDSTG%'`);
  await pool.end();
});

test('insertManualCandidate adds a pending manual song linked to the existing artist, with the bandcamp link', async () => {
  const artistId = await mkArtist();
  const r = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Lone Song', artistId, bandcamp_url: 'https://zzzbandstg.bandcamp.com/track/lone', note: 'added via band check (ZZZBANDSTG Band)' });
  assert.equal(r.added, 1);
  const s = (await pool.query(`SELECT status, published, data_source, bandcamp_url, status_notes FROM songs WHERE id=$1`, [r.song_id])).rows[0];
  assert.deepEqual([s.status, s.published, s.data_source, s.bandcamp_url], ['pending', false, 'manual', 'https://zzzbandstg.bandcamp.com/track/lone']);
  const links = (await pool.query(`SELECT artist_id FROM song_artists WHERE song_id=$1`, [r.song_id])).rows;
  assert.deepEqual(links.map(l => l.artist_id), [artistId]);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM artists WHERE name LIKE 'ZZZBANDSTG%'`)).rows[0].n, 1); // no duplicate artist created
});

test('insertManualCandidate skips a normalised-title duplicate for the same artist and a same-url duplicate', async () => {
  const artistId = await mkArtist('ZZZBANDSTG Band 2');
  const first = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Dupe (Live)', artistId, note: 'n' });
  assert.equal(first.added, 1);
  const again = await staging.insertManualCandidate(pool, { title: 'zzzbandstg dupe', artistId, note: 'n' });
  assert.deepEqual([again.added, again.skippedExisting, again.song_id], [0, 1, null]);
  await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Url One', artistId, bandcamp_url: 'https://zzzbandstg.bandcamp.com/track/u', note: 'n' });
  const sameUrl = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Url Two', artistId, bandcamp_url: 'https://zzzbandstg.bandcamp.com/track/u', note: 'n' });
  assert.equal(sameUrl.skippedExisting, 1);
});

test('a band-check song shows origin "bandcheck" in the To be processed queue', async () => {
  const artistId = await mkArtist('ZZZBANDSTG Band 3');
  await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Origin', artistId, note: 'added via band check (ZZZBANDSTG Band 3)' });
  const { rows } = await curation.listCurationQueue(pool, { queue: 'to-process', q: 'ZZZBANDSTG Origin' });
  assert.equal(rows.find(r => r.title === 'ZZZBANDSTG Origin').origin, 'bandcheck');
});

test('insertCandidates accepts a custom note and keeps its default', async () => {
  const track = (id, title) => ({ spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: null, added_at: null,
    artists: [{ spotify_id: 'ZZZBANDSTG' + id, name: 'ZZZBANDSTG Spot ' + id, spotify_url: null }], album: null });
  await staging.insertCandidates(pool, [track('n1', 'ZZZBANDSTG Noted')], { note: 'added via band check (x)' });
  await staging.insertCandidates(pool, [track('n2', 'ZZZBANDSTG Plain')]);
  const notes = Object.fromEntries((await pool.query(`SELECT title, status_notes FROM songs WHERE title IN ('ZZZBANDSTG Noted','ZZZBANDSTG Plain')`)).rows.map(r => [r.title, r.status_notes]));
  assert.equal(notes['ZZZBANDSTG Noted'], 'added via band check (x)');
  assert.equal(notes['ZZZBANDSTG Plain'], 'added as candidate via staging intake');
});
```
(The `after` hook deletes `song_artists`, then songs, then every `ZZZBANDSTG%` artist — including the Spotify-sourced ones these inserts create.)

- [ ] **Step 2: Run to verify failure** — `node --test test/bandCheckStaging.test.js` -> FAIL (`insertManualCandidate` undefined).

- [ ] **Step 3: Edit `insertCandidates`** — signature `async function insertCandidates(db, tracks, { note } = {})` and the `addTracksAsPending` call's third argument becomes `note || 'added as candidate via staging intake'`.

- [ ] **Step 4: Add `insertManualCandidate`** (after `insertCandidates`, before `parseSpotifyRef`)

```js
// Band check: a song found on Bandcamp / MusicBrainz but not on Spotify. A minimal manual pending song linked to the
// band's EXISTING artist row (same shape the submissions bridge creates). Dedupes against the band's own songs by
// normalised title (or identical bandcamp_url), like insertCandidates' title|artist net.
async function insertManualCandidate(db, { title, artistId, bandcamp_url = null, note }) {
  const clean = String(title || '').trim();
  if (!clean || !Number.isInteger(artistId)) { const e = new Error('title and artistId required'); e.code = 'BAD_INPUT'; throw e; }
  const nt = normalizeName(clean) || clean.toLowerCase();
  const existing = (await db.query(
    `SELECT s.title, s.bandcamp_url FROM songs s JOIN song_artists sa ON sa.song_id=s.id WHERE sa.artist_id=$1`, [artistId])).rows;
  if (existing.some(e => (normalizeName(e.title) || String(e.title).toLowerCase()) === nt || (bandcamp_url && e.bandcamp_url === bandcamp_url))) {
    return { added: 0, skippedExisting: 1, song_id: null };
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const song = await client.query(
      `INSERT INTO songs (title, bandcamp_url, data_source, status, status_notes) VALUES ($1,$2,'manual','pending',$3) RETURNING id`,
      [clean, bandcamp_url, note || 'added via band check']);
    await client.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [song.rows[0].id, artistId]);
    await client.query('COMMIT');
    return { added: 1, skippedExisting: 0, song_id: song.rows[0].id };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
```
Add `insertManualCandidate` to `module.exports`.

- [ ] **Step 5: Edit the `origin` CASE** in `curation.js` — insert before the `WHEN s.playlist_added_by='playlist-diff'` line:

```sql
                WHEN s.status_notes LIKE 'added via band check%' THEN 'bandcheck'
```
(The first `CASE WHEN … THEN 'submission'` branch stays first; a band-check note never matches `community submission #%`.) Also update the SQL comment above the CASE to mention band-check notes.

- [ ] **Step 6: Edit the UI label** — `SongQueueList.jsx:6` -> `const ORIGIN_LABELS = { spotify: 'From Spotify', submission: 'From submit form', bandcheck: 'From band check' };`

- [ ] **Step 7: Run to verify pass** — `node --test test/bandCheckStaging.test.js test/staging.test.js test/curation.test.js` serially (`--test-concurrency=1`). Expected: PASS. Then `cd ../frontend && npm run lint` (0 errors).
- [ ] **Step 8: Commit** (staging.js, curation.js, SongQueueList.jsx, the test; "feat(band-check): manual pending candidates, note argument, origin tag").

---

### Task 6: Service — band list, candidates, identity

**Files:**
- Create: `backend/services/bandCheck/index.js` (this task adds `listBands`, `identifyCandidates`, `saveIdentity`, `defaultAdapters`; Task 7 adds `checkBand`/`addSelected`)
- Test: `backend/test/bandCheckService.test.js` (sentinel `ZZZBANDSVC`; Task 7 appends to the same file)

**Interfaces:**
- Consumes: adapters (`identify`, `bandcampLink`), `normalizeBandcampOrigin`, `coded`.
- Produces:
  - `defaultAdapters() -> { spotify, bandcamp, musicbrainz }` (real `defaultFetch`/Spotify client).
  - `listBands(db, { q = '', limit = 50, offset = 0 }) -> { rows: [{ id, name, identity: { spotify: bool, bandcamp: bool, musicbrainz: bool }, songs: number, live_songs: number }], total }`.
  - `identifyCandidates(db, artistId, source, { query, adapters }) -> Candidate[]` (`NOT_FOUND` for an unknown artist, `BAD_INPUT` for an unknown source). Bandcamp candidates: `{ value: origin, label: origin, detail: 'from this band\'s song links' | 'from MusicBrainz', url: origin }`.
  - `saveIdentity(db, artistId, source, value) -> { spotify: string|null, bandcamp: string|null, musicbrainz: string|null }`.

- [ ] **Step 1: Write the failing tests**

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/bandCheck');

// Fixture sentinel for this file: ZZZBANDSVC.
const SP1 = 'ZZZBANDSVCaaaaaaaaaaaa', SP2 = 'ZZZBANDSVCbbbbbbbbbbbb'; // 22 chars each
const MB = '11111111-2222-3333-4444-555555555555';
async function mkArtist(name, { spotify_id = null } = {}) {
  return (await pool.query(`INSERT INTO artists (name, spotify_id, data_source) VALUES ($1,$2,$3) RETURNING id`,
    [name, spotify_id, spotify_id ? 'spotify' : 'manual'])).rows[0].id;
}
async function mkSong(artistId, title, { status = 'included', published = true, bandcamp_url = null, spotify_id = null } = {}) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, bandcamp_url, spotify_id, data_source) VALUES ($1,$2,$3,$4,$5,'manual') RETURNING id`,
    [title, status, published, bandcamp_url, spotify_id])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  return id;
}
after(async () => {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBANDSVC%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZBANDSVC%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZBANDSVC%'`);
  await pool.end();
});

test('listBands: searches by name, counts songs and live songs, reports identity flags, pages', async () => {
  const a = await mkArtist('ZZZBANDSVC Alpha');
  await mkArtist('ZZZBANDSVC Beta', { spotify_id: SP1 });
  await mkSong(a, 'ZZZBANDSVC s1'); await mkSong(a, 'ZZZBANDSVC s2', { status: 'pending', published: false });
  const { rows, total } = await svc.listBands(pool, { q: 'zzzbandsvc' });
  assert.equal(total, 2);
  assert.deepEqual(rows.map(r => r.name), ['ZZZBANDSVC Alpha', 'ZZZBANDSVC Beta']);
  assert.deepEqual([rows[0].songs, rows[0].live_songs], [2, 1]);
  assert.deepEqual(rows[0].identity, { spotify: false, bandcamp: false, musicbrainz: false });
  assert.equal(rows[1].identity.spotify, true);
  assert.equal((await svc.listBands(pool, { q: 'zzzbandsvc', limit: 1, offset: 1 })).rows[0].name, 'ZZZBANDSVC Beta');
  assert.equal((await svc.listBands(pool, { q: 'zzzbandsvc%' })).total, 0); // % is literal, not a wildcard
});

test('saveIdentity writes only the matching column, validates, clears bandcamp/musicbrainz, and sets data_source for spotify', async () => {
  const a = await mkArtist('ZZZBANDSVC Ident');
  let id = await svc.saveIdentity(pool, a, 'musicbrainz', MB);
  assert.equal(id.musicbrainz, MB);
  id = await svc.saveIdentity(pool, a, 'bandcamp', 'https://ZZZBANDSVC.bandcamp.com/album/x');
  assert.equal(id.bandcamp, 'https://zzzbandsvc.bandcamp.com');
  id = await svc.saveIdentity(pool, a, 'spotify', SP2);
  assert.equal(id.spotify, SP2);
  assert.equal((await pool.query(`SELECT data_source FROM artists WHERE id=$1`, [a])).rows[0].data_source, 'spotify');
  id = await svc.saveIdentity(pool, a, 'musicbrainz', null);
  assert.equal(id.musicbrainz, null);
  assert.equal(id.spotify, SP2); // untouched
  for (const [src, v] of [['musicbrainz', 'not-a-uuid'], ['spotify', 'short'], ['spotify', null], ['bandcamp', 'https://example.com'], ['bandcamp', 'https://zzz.bandcamp.com.evil.com'], ['nope', 'x']]) {
    await assert.rejects(svc.saveIdentity(pool, a, src, v), (e) => e.code === 'BAD_INPUT', `${src} ${v}`);
  }
  await assert.rejects(svc.saveIdentity(pool, 2147483646, 'musicbrainz', MB), (e) => e.code === 'NOT_FOUND');
});

test('saveIdentity refuses a Spotify id that belongs to a different artist row', async () => {
  const other = await mkArtist('ZZZBANDSVC Owner', { spotify_id: 'ZZZBANDSVCcccccccccccc' });
  const mine = await mkArtist('ZZZBANDSVC Claimer');
  await assert.rejects(svc.saveIdentity(pool, mine, 'spotify', 'ZZZBANDSVCcccccccccccc'), (e) => e.code === 'CONFLICT');
  assert.equal((await pool.query(`SELECT spotify_id FROM artists WHERE id=$1`, [mine])).rows[0].spotify_id, null);
  assert.ok(other);
});

test('identifyCandidates: spotify/musicbrainz delegate with the band name by default; bandcamp merges song links and the MusicBrainz link', async () => {
  const a = await mkArtist('ZZZBANDSVC Cands');
  await pool.query(`UPDATE artists SET musicbrainz_id=$2 WHERE id=$1`, [a, MB]);
  await mkSong(a, 'ZZZBANDSVC c1', { bandcamp_url: 'https://zzzbandsvcband.bandcamp.com/track/one' });
  await mkSong(a, 'ZZZBANDSVC c2', { bandcamp_url: 'https://zzzbandsvcband.bandcamp.com/album/two' });
  await mkSong(a, 'ZZZBANDSVC c3', { bandcamp_url: 'https://elsewhere.example.com/x' }); // not bandcamp: ignored
  const seen = [];
  const adapters = {
    spotify: { identify: async (q) => { seen.push(['sp', q]); return [{ value: SP1, label: 'X', detail: '', url: null }]; } },
    musicbrainz: { identify: async (q) => { seen.push(['mb', q]); return []; }, bandcampLink: async () => 'https://fromMB.bandcamp.com/' },
  };
  assert.equal((await svc.identifyCandidates(pool, a, 'spotify', { adapters }))[0].value, SP1);
  await svc.identifyCandidates(pool, a, 'musicbrainz', { query: 'Other Name', adapters });
  assert.deepEqual(seen, [['sp', 'ZZZBANDSVC Cands'], ['mb', 'Other Name']]);
  const bc = await svc.identifyCandidates(pool, a, 'bandcamp', { adapters });
  assert.deepEqual(bc.map(c => [c.value, c.detail]).sort(), [
    ['https://frommb.bandcamp.com', 'from MusicBrainz'],
    ['https://zzzbandsvcband.bandcamp.com', "from this band's song links"],
  ]);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/bandCheckService.test.js` -> FAIL `Cannot find module '../services/bandCheck'`.

- [ ] **Step 3: Write `index.js` (part 1)**

```js
// Band check service: orchestrates the three source adapters, the curator-confirmed band identity, and the
// add path. Takes `db` and (injected) adapters so tests never touch the network. See the sub-project H spec.
const { createSpotifyAdapter } = require('./spotify');
const { createMusicBrainzAdapter } = require('./musicbrainz');
const { createBandcampAdapter, normalizeBandcampOrigin } = require('./bandcamp');
const { defaultFetch } = require('./http');
const { coded } = require('./errors');

const SOURCES = ['spotify', 'bandcamp', 'musicbrainz'];
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultAdapters() {
  return {
    spotify: createSpotifyAdapter(),
    bandcamp: createBandcampAdapter({ fetch: defaultFetch }),
    musicbrainz: createMusicBrainzAdapter({ fetch: defaultFetch }),
  };
}

const like = (s) => String(s).replace(/[\\%_]/g, c => '\\' + c);

async function listBands(db, { q = '', limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200), off = Math.max(parseInt(offset) || 0, 0);
  const pat = q ? `%${like(q)}%` : null;
  const where = `WHERE ($1::text IS NULL OR a.name ILIKE $1)`;
  const total = (await db.query(`SELECT count(*)::int AS n FROM artists a ${where}`, [pat])).rows[0].n;
  const rows = (await db.query(`
    SELECT a.id, a.name, a.spotify_id, a.bandcamp_url, a.musicbrainz_id,
           COUNT(DISTINCT sa.song_id)::int AS songs,
           (COUNT(DISTINCT sa.song_id) FILTER (WHERE s.status='included' AND s.published))::int AS live_songs
    FROM artists a
    LEFT JOIN song_artists sa ON sa.artist_id = a.id
    LEFT JOIN songs s ON s.id = sa.song_id
    ${where}
    GROUP BY a.id
    ORDER BY LOWER(a.name), a.id
    LIMIT $2 OFFSET $3`, [pat, lim, off])).rows;
  return {
    total,
    rows: rows.map(r => ({
      id: r.id, name: r.name, songs: r.songs, live_songs: r.live_songs,
      identity: { spotify: !!r.spotify_id, bandcamp: !!r.bandcamp_url, musicbrainz: !!r.musicbrainz_id },
    })),
  };
}

async function loadArtist(db, artistId) {
  const a = (await db.query(`SELECT id, name, spotify_id, bandcamp_url, musicbrainz_id FROM artists WHERE id=$1`, [artistId])).rows[0];
  if (!a) throw coded('NOT_FOUND', 'Band not found');
  return a;
}

function identityOf(a) { return { spotify: a.spotify_id || null, bandcamp: a.bandcamp_url || null, musicbrainz: a.musicbrainz_id || null }; }

async function identifyCandidates(db, artistId, source, { query, adapters = defaultAdapters() } = {}) {
  if (!SOURCES.includes(source)) throw coded('BAD_INPUT', 'Unknown source');
  const artist = await loadArtist(db, artistId);
  const q = (query && String(query).trim()) || artist.name;
  if (source !== 'bandcamp') return adapters[source].identify(q);

  const out = new Map();
  const rows = (await db.query(
    `SELECT DISTINCT s.bandcamp_url FROM songs s JOIN song_artists sa ON sa.song_id=s.id
     WHERE sa.artist_id=$1 AND s.bandcamp_url IS NOT NULL`, [artistId])).rows;
  for (const r of rows) {
    const o = normalizeBandcampOrigin(r.bandcamp_url);
    if (o && !out.has(o)) out.set(o, { value: o, label: o, detail: "from this band's song links", url: o });
  }
  if (artist.musicbrainz_id) {
    try {
      const o = normalizeBandcampOrigin(await adapters.musicbrainz.bandcampLink(artist.musicbrainz_id));
      if (o && !out.has(o)) out.set(o, { value: o, label: o, detail: 'from MusicBrainz', url: o });
    } catch { /* MusicBrainz being down must not hide the other candidates */ }
  }
  return [...out.values()];
}

async function saveIdentity(db, artistId, source, value) {
  if (!SOURCES.includes(source)) throw coded('BAD_INPUT', 'Unknown source');
  await loadArtist(db, artistId); // NOT_FOUND first
  if (source === 'spotify') {
    if (typeof value !== 'string' || !SPOTIFY_ID.test(value)) throw coded('BAD_INPUT', 'Spotify artist ids are 22 letters and digits (a Spotify identity can be replaced, not cleared)');
    const taken = (await db.query(`SELECT id FROM artists WHERE spotify_id=$1 AND id<>$2`, [value, artistId])).rows[0];
    if (taken) throw coded('CONFLICT', 'Another artist in the catalogue already has that Spotify id');
    // artists_source_check ties spotify_id to data_source='spotify'
    await db.query(`UPDATE artists SET spotify_id=$2, spotify_url=COALESCE(spotify_url, $3), data_source='spotify', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [artistId, value, `https://open.spotify.com/artist/${value}`]);
  } else if (source === 'musicbrainz') {
    if (value !== null && !(typeof value === 'string' && UUID.test(value))) throw coded('BAD_INPUT', 'That is not a MusicBrainz id');
    await db.query(`UPDATE artists SET musicbrainz_id=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [artistId, value]);
  } else {
    const origin = value === null ? null : normalizeBandcampOrigin(value);
    if (value !== null && !origin) throw coded('BAD_INPUT', 'Paste a https://<name>.bandcamp.com address');
    await db.query(`UPDATE artists SET bandcamp_url=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [artistId, origin]);
  }
  return identityOf(await loadArtist(db, artistId));
}

module.exports = { SOURCES, defaultAdapters, listBands, identifyCandidates, saveIdentity, loadArtist, identityOf };
```
(Task 7 extends `module.exports`.)

- [ ] **Step 4: Run to verify pass** -> PASS. If `artists.updated_at` does not exist, check `\d artists` — it is used by `playlistSync.upsertArtist`, so it does.
- [ ] **Step 5: Commit** (index.js + test; "feat(band-check): band list, candidates and identity service").

---

### Task 7: Service — checkBand and addSelected

**Files:**
- Modify: `backend/services/bandCheck/index.js` (add `checkBand`, `addSelected`, `_resetForTests`, exports)
- Test: `backend/test/bandCheckService.test.js` (append)

**Interfaces:**
- Consumes: everything above; `merge.{mergeCatalogues,buildIndex,classify,keyOf}`; `staging.{insertCandidates,insertManualCandidate}`.
- Produces:
  - `checkBand(db, artistId, { adapters, fresh = false, now = Date.now }) -> { artist: { id, name, identity }, sources: { [source]: { status: 'ok' } | { status: 'error', code, message } }, releases: [{ name, album_type, release_date, source, songs: ClientSong[] }], counts: { new, in_catalogue, rejected, single_source } }`. Throws `NO_IDENTITY` when the band has no identity on any source and `NOT_FOUND` for an unknown band. `ClientSong = { key, title, state, match, sources: { spotify?: { url }, bandcamp?: { url }, musicbrainz?: { count } }, also_on }`.
  - `addSelected(db, artistId, keys, { adapters }) -> { added, skippedExisting, notFound }`; throws `BAD_INPUT` (not an array / empty / non-strings / more than 100) and `BUSY`.
  - `_resetForTests()` clears the cache and the busy flag.

- [ ] **Step 1: Append the failing tests** (reuse the file's helpers; add a fake-adapter builder)

```js
const staging = require('../services/staging');

function spTrack(id, title) { return { title, id, url: 'https://open.spotify.com/track/' + id, mapped: {
  spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: 'https://open.spotify.com/track/' + id, added_at: null,
  artists: [{ spotify_id: SPBAND, name: 'ZZZBANDSVC Merged', spotify_url: null }], album: null } }; }
const SPBAND = 'ZZZBANDSVCmmmmmmmmmmmm';
function fakeAdapters({ spotify, bandcamp, musicbrainz, counter = {} } = {}) {
  const mk = (name, cat) => cat === undefined ? undefined : { fetchCatalogue: async () => { counter[name] = (counter[name] || 0) + 1; if (cat instanceof Error) throw cat; return cat; } };
  return { spotify: mk('spotify', spotify), bandcamp: mk('bandcamp', bandcamp), musicbrainz: mk('musicbrainz', musicbrainz) };
}
const SPOT = { source: 'spotify', releases: [{ id: 'r1', name: 'Alb', album_type: 'album', release_date: '2020', url: null, tracks: [spTrack('ZZZBANDSVCt1', 'ZZZBANDSVC Held'), spTrack('ZZZBANDSVCt2', 'ZZZBANDSVC Fresh')] }] };
const BAND = { source: 'bandcamp', releases: [{ id: '/album/a', name: 'Alb', album_type: 'album', release_date: '2020-01-01', url: null, tracks: [
  { title: 'ZZZBANDSVC Fresh', id: null, url: 'https://zzzbandsvcm.bandcamp.com/track/fresh' },
  { title: 'ZZZBANDSVC Bandcamp Only', id: null, url: 'https://zzzbandsvcm.bandcamp.com/track/bco' }] }] };

async function mergedBand() {
  const a = await mkArtist('ZZZBANDSVC Merged', { spotify_id: SPBAND });
  await pool.query(`UPDATE artists SET bandcamp_url='https://zzzbandsvcm.bandcamp.com' WHERE id=$1`, [a]);
  const held = await mkSong(a, 'ZZZBANDSVC Held');
  return { a, held };
}

test('checkBand merges sources, marks held songs, counts, and one failing source does not sink the rest', async () => {
  svc._resetForTests();
  const { a, held } = await mergedBand();
  const res = await svc.checkBand(pool, a, { adapters: fakeAdapters({ spotify: SPOT, bandcamp: BAND, musicbrainz: undefined }) });
  assert.equal(res.sources.spotify.status, 'ok');
  const songs = res.releases.flatMap(r => r.songs);
  const byTitle = Object.fromEntries(songs.map(s => [s.title, s]));
  assert.equal(byTitle['ZZZBANDSVC Held'].state, 'in_catalogue');
  assert.equal(byTitle['ZZZBANDSVC Held'].match.song_id, held);
  assert.deepEqual(Object.keys(byTitle['ZZZBANDSVC Fresh'].sources).sort(), ['bandcamp', 'spotify']);
  assert.equal(byTitle['ZZZBANDSVC Bandcamp Only'].state, 'new');
  assert.equal(byTitle['ZZZBANDSVC Fresh'].sources.spotify.mapped, undefined); // internal data is not sent to the client
  assert.deepEqual(res.counts, { new: 2, in_catalogue: 1, rejected: 0, single_source: 1 });

  svc._resetForTests();
  const partial = await svc.checkBand(pool, a, { adapters: fakeAdapters({ spotify: SPOT, bandcamp: Object.assign(new Error('x'), { code: 'UNREADABLE' }) }), fresh: true });
  assert.deepEqual([partial.sources.bandcamp.status, partial.sources.bandcamp.code, partial.sources.spotify.status], ['error', 'UNREADABLE', 'ok']);
  assert.equal(partial.releases.flatMap(r => r.songs).length, 2);
});

test('checkBand: rejected songs are reported, NO_IDENTITY and NOT_FOUND are coded, results are cached 5 minutes and fresh bypasses', async () => {
  svc._resetForTests();
  const a = await mkArtist('ZZZBANDSVC Rejector', { spotify_id: 'ZZZBANDSVCrrrrrrrrrrrr' });
  await mkSong(a, 'ZZZBANDSVC Held', { status: 'rejected', published: false });
  const counter = {};
  let t = 1_000_000;
  const adapters = fakeAdapters({ spotify: SPOT, counter });
  const r1 = await svc.checkBand(pool, a, { adapters, now: () => t });
  assert.equal(r1.counts.rejected, 1);
  await svc.checkBand(pool, a, { adapters, now: () => t + 60_000 });
  assert.equal(counter.spotify, 1); // cached
  await svc.checkBand(pool, a, { adapters, now: () => t + 6 * 60_000 });
  assert.equal(counter.spotify, 2); // expired
  await svc.checkBand(pool, a, { adapters, now: () => t + 6 * 60_000 + 1, fresh: true });
  assert.equal(counter.spotify, 3);
  const bare = await mkArtist('ZZZBANDSVC Bare');
  await assert.rejects(svc.checkBand(pool, bare, { adapters }), (e) => e.code === 'NO_IDENTITY' && e.artist.name === 'ZZZBANDSVC Bare' && e.artist.id === bare);
  await assert.rejects(svc.checkBand(pool, 2147483646, { adapters }), (e) => e.code === 'NOT_FOUND');
});

test('addSelected: Spotify songs via intake, bandcamp-only via manual path, bandcamp url filled on Spotify songs, idempotent, junk keys ignored, cap and BUSY', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  const adapters = fakeAdapters({ spotify: SPOT, bandcamp: BAND });
  const res = await svc.addSelected(pool, a, ['zzzbandsvc fresh', 'zzzbandsvc bandcamp only', 'zzzbandsvc held', 'not a real key'], { adapters });
  assert.deepEqual(res, { added: 2, skippedExisting: 1, notFound: 1 });
  const rows = (await pool.query(
    `SELECT title, status, data_source, spotify_id, bandcamp_url, status_notes FROM songs WHERE title IN ('ZZZBANDSVC Fresh','ZZZBANDSVC Bandcamp Only') ORDER BY title`)).rows;
  const fresh = rows.find(r => r.title === 'ZZZBANDSVC Fresh'), only = rows.find(r => r.title === 'ZZZBANDSVC Bandcamp Only');
  assert.deepEqual([fresh.status, fresh.spotify_id, fresh.bandcamp_url], ['pending', 'ZZZBANDSVCt2', 'https://zzzbandsvcm.bandcamp.com/track/fresh']);
  assert.deepEqual([only.status, only.data_source, only.spotify_id, only.bandcamp_url], ['pending', 'manual', null, 'https://zzzbandsvcm.bandcamp.com/track/bco']);
  assert.match(fresh.status_notes, /^added via band check \(ZZZBANDSVC Merged\)/);
  assert.match(only.status_notes, /^added via band check \(ZZZBANDSVC Merged\)/);
  // the Spotify-created song is linked to the band's existing artist row, not a duplicate
  assert.equal((await pool.query(`SELECT count(*)::int n FROM artists WHERE name='ZZZBANDSVC Merged'`)).rows[0].n, 1);

  const again = await svc.addSelected(pool, a, ['zzzbandsvc fresh', 'zzzbandsvc bandcamp only'], { adapters });
  assert.deepEqual(again, { added: 0, skippedExisting: 2, notFound: 0 }); // double-click is harmless

  for (const bad of [undefined, [], 'x', [1], Array.from({ length: 101 }, (_, i) => 'k' + i)]) {
    await assert.rejects(svc.addSelected(pool, a, bad, { adapters }), (e) => e.code === 'BAD_INPUT');
  }
});

test('addSelected: an overlapping add is BUSY', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = { spotify: { fetchCatalogue: async () => { await gate; return SPOT; } } };
  const first = svc.addSelected(pool, a, ['zzzbandsvc fresh'], { adapters: slow });
  await assert.rejects(svc.addSelected(pool, a, ['zzzbandsvc fresh'], { adapters: slow }), (e) => e.code === 'BUSY');
  release();
  await first;
});
```
Note: in the last test the artist row has both a Spotify and a Bandcamp identity but `slow` only supplies `spotify`; `checkBand`/`addSelected` must treat a source with no adapter as "not run" (skip), not as an error.

- [ ] **Step 2: Run to verify failure** — FAIL (`checkBand` not a function).

- [ ] **Step 3: Extend `index.js`**

```js
const staging = require('../staging');
const { mergeCatalogues, buildIndex, classify } = require('./merge');
const { sourceError } = require('./errors');

const CACHE_MS = 5 * 60 * 1000;
const MAX_ADD = 100;
const cache = new Map(); // `${artistId}:${source}:${value}` -> { at, catalogue }
let adding = false;
function _resetForTests() { cache.clear(); adding = false; }

async function readSource(adapter, artistId, source, value, { fresh, now }) {
  const key = `${artistId}:${source}:${value}`;
  const hit = cache.get(key);
  if (!fresh && hit && now() - hit.at < CACHE_MS) return hit.catalogue;
  const catalogue = await adapter.fetchCatalogue(value);
  cache.set(key, { at: now(), catalogue });
  return catalogue;
}

// Internal: the merged + classified songs for a band (full internal shape, incl. Spotify `mapped` tracks).
async function loadMerged(db, artist, { adapters, fresh, now }) {
  const identity = identityOf(artist);
  const active = SOURCES.filter(s => identity[s] && adapters[s]);
  if (active.length === 0) {
    // carries the band so the admin view can open its Identify step with the right name
    throw Object.assign(coded('NO_IDENTITY', 'Identify this band on at least one source first'), { artist: { id: artist.id, name: artist.name, identity } });
  }

  const settled = await Promise.all(active.map(async (source) => {
    try { return { source, catalogue: await readSource(adapters[source], artist.id, source, identity[source], { fresh, now }) }; }
    catch (e) { const err = sourceError(e); return { source, error: { code: err.code, message: err.message } }; }
  }));
  const sources = {};
  for (const r of settled) sources[r.source] = r.error ? { status: 'error', ...r.error } : { status: 'ok' };

  const songs = mergeCatalogues(settled.filter(r => r.catalogue).map(r => r.catalogue));
  const spotifyIds = songs.flatMap(s => (s.sources.spotify ? s.sources.spotify.ids : []));
  const bandcampOrigin = identity.bandcamp;
  const rows = (await db.query(`
    SELECT s.id, s.title, s.status, s.published, s.spotify_id, s.bandcamp_url,
           EXISTS (SELECT 1 FROM song_artists x WHERE x.song_id = s.id AND x.artist_id = $1) AS by_artist
    FROM songs s
    WHERE s.id IN (SELECT song_id FROM song_artists WHERE artist_id = $1)
       OR s.spotify_id = ANY($2::text[])
       OR ($3::text IS NOT NULL AND s.bandcamp_url ILIKE $3 || '%')`, [artist.id, spotifyIds, bandcampOrigin])).rows;
  return { sources, songs: classify(songs, buildIndex(rows)) };
}

function toClient(s) {
  const sources = {};
  if (s.sources.spotify) sources.spotify = { url: s.sources.spotify.url };
  if (s.sources.bandcamp) sources.bandcamp = { url: s.sources.bandcamp.url };
  if (s.sources.musicbrainz) sources.musicbrainz = { count: s.sources.musicbrainz.count };
  return { key: s.key, title: s.title, state: s.state, match: s.match, sources, also_on: s.also_on };
}

async function checkBand(db, artistId, { adapters = defaultAdapters(), fresh = false, now = Date.now } = {}) {
  const artist = await loadArtist(db, artistId);
  const { sources, songs } = await loadMerged(db, artist, { adapters, fresh, now });

  const byRelease = new Map();
  for (const s of songs) {
    const k = `${s.release.source}:${s.release.id}`;
    if (!byRelease.has(k)) byRelease.set(k, { name: s.release.name, album_type: s.release.album_type, release_date: s.release.release_date, source: s.release.source, songs: [] });
    byRelease.get(k).songs.push(toClient(s));
  }
  const releases = [...byRelease.values()].sort((a, b) => (b.release_date || '').localeCompare(a.release_date || '') || a.name.localeCompare(b.name));
  const counts = { new: 0, in_catalogue: 0, rejected: 0, single_source: 0 };
  for (const s of songs) {
    if (s.state === 'new') { counts.new++; if (Object.keys(s.sources).length === 1) counts.single_source++; }
    else if (s.match.status === 'rejected') counts.rejected++;
    else counts.in_catalogue++;
  }
  return { artist: { id: artist.id, name: artist.name, identity: identityOf(artist) }, sources, releases, counts };
}

// Adds the songs the curator ticked. Never trusts client data: only song keys come in, and the catalogue is re-read live.
async function addSelected(db, artistId, keys, { adapters = defaultAdapters() } = {}) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_ADD || keys.some(k => typeof k !== 'string' || !k)) {
    throw coded('BAD_INPUT', `keys must be 1-${MAX_ADD} song keys`);
  }
  if (adding) throw coded('BUSY', 'Another add is in progress');
  adding = true;
  try {
    const artist = await loadArtist(db, artistId);
    const { songs } = await loadMerged(db, artist, { adapters, fresh: true, now: Date.now });
    const byKey = new Map(songs.map(s => [s.key, s]));
    let skippedExisting = 0, notFound = 0, added = 0;
    const picked = [];
    for (const key of [...new Set(keys)]) {
      const s = byKey.get(key);
      if (!s) notFound++;
      else if (s.state !== 'new') skippedExisting++;
      else picked.push(s);
    }
    const note = `added via band check (${artist.name})`;
    const withSpotify = picked.filter(s => s.sources.spotify && s.sources.spotify.mapped);
    if (withSpotify.length) {
      const r = await staging.insertCandidates(db, withSpotify.map(s => s.sources.spotify.mapped), { note });
      added += r.added; skippedExisting += r.skippedExisting;
      for (const s of withSpotify) {
        if (s.sources.bandcamp && s.sources.bandcamp.url) {
          // only a song THIS add just created (its note proves it): never touch an existing catalogue song
          await db.query(`UPDATE songs SET bandcamp_url = COALESCE(bandcamp_url, $1) WHERE spotify_id = $2 AND status_notes = $3`,
            [s.sources.bandcamp.url, s.sources.spotify.mapped.spotify_id, note]);
        }
      }
    }
    for (const s of picked.filter(p => !(p.sources.spotify && p.sources.spotify.mapped))) {
      const r = await staging.insertManualCandidate(db, {
        title: s.title, artistId: artist.id, bandcamp_url: (s.sources.bandcamp && s.sources.bandcamp.url) || null, note,
      });
      added += r.added; skippedExisting += r.skippedExisting;
    }
    return { added, skippedExisting, notFound };
  } finally { adding = false; }
}

Object.assign(module.exports, { checkBand, addSelected, _resetForTests });
```
Place the new `require`s at the top of the file with the others (not mid-file) when editing.

- [ ] **Step 4: Run to verify pass** — `node --test --test-concurrency=1 test/bandCheckService.test.js` -> PASS. If a title-key assertion fails, remember `keyOf('ZZZBANDSVC Fresh') === 'zzzbandsvc fresh'`.
- [ ] **Step 5: Full backend suite** — `cd backend && npm test`. Expected: all green (303 existing + new). Report counts.
- [ ] **Step 6: Commit** (index.js + test; "feat(band-check): checkBand and addSelected").

---

### Task 8: Routes

**Files:**
- Modify: `backend/routes/admin.js` (require at top; new "Band check" banner section after the Spotify sync routes, before `// ==================== Artists`)
- Test: manual API check in Task 10 (admin.js routes have no unit suite; the service is fully covered)

**Interfaces:**
- Consumes: `bandCheck.{listBands, identifyCandidates, saveIdentity, checkBand, addSelected, defaultAdapters}`.
- Produces: the five routes in spec §5. One `defaultAdapters()` instance is created once at module load (MusicBrainz pacing state must be shared across requests).

- [ ] **Step 1: Add the require** next to the other services: `const bandCheck = require('../services/bandCheck');` and, in the banner section, `const bandAdapters = bandCheck.defaultAdapters();`.

- [ ] **Step 2: Add the section**

```js
// ==================== Band check (sub-project H) ====================
// Merge one band's catalogue from Spotify + Bandcamp + MusicBrainz, then add the ticked songs as pending.
// Errors are coded by the service and carry fixed strings; never log e.message (it can hold a URL/token).

function bandCheckError(res, e, label) {
  const status = { NOT_FOUND: 404, BAD_INPUT: 400, CONFLICT: 409, BUSY: 409, NO_IDENTITY: 409, RATE_LIMITED: 429, UPSTREAM: 502, UNREADABLE: 502 }[e.code];
  if (status) return res.status(status).json({ error: e.code, message: e.message, ...(e.artist ? { artist: e.artist } : {}) });
  console.error(`band check ${label} error:`, e.code || 'error');
  return res.status(500).json({ error: `Failed to ${label}` });
}
const bandId = (req) => { const n = parseInt(req.params.id, 10); return Number.isSafeInteger(n) && n > 0 ? n : -1; };

router.get('/band-check/bands', async (req, res) => {
  try { res.json(await bandCheck.listBands(pool, { q: String(req.query.q || '').slice(0, 100), limit: req.query.limit, offset: req.query.offset })); }
  catch (e) { bandCheckError(res, e, 'list bands'); }
});

router.get('/band-check/bands/:id/candidates', async (req, res) => {
  try {
    const candidates = await bandCheck.identifyCandidates(pool, bandId(req), String(req.query.source || ''), { query: String(req.query.q || '').slice(0, 100), adapters: bandAdapters });
    res.json({ candidates });
  } catch (e) { bandCheckError(res, e, 'find candidates'); }
});

router.put('/band-check/bands/:id/identity', async (req, res) => {
  try {
    const { source, value } = req.body || {};
    res.json({ identity: await bandCheck.saveIdentity(pool, bandId(req), source, value === undefined ? undefined : value) });
  } catch (e) { bandCheckError(res, e, 'save the identity'); }
});

router.get('/band-check/bands/:id', async (req, res) => {
  try {
    const result = await bandCheck.checkBand(pool, bandId(req), { adapters: bandAdapters, fresh: req.query.fresh === '1' });
    const states = Object.values(result.sources);
    if (states.length && states.every(s => s.status === 'error')) {
      return res.status(502).json({ error: 'UPSTREAM', message: 'No source could be read this time - try again in a minute', sources: result.sources });
    }
    res.json(result);
  } catch (e) { bandCheckError(res, e, 'check the band'); }
});

router.post('/band-check/bands/:id/add', async (req, res) => {
  try { res.json({ success: true, ...(await bandCheck.addSelected(pool, bandId(req), (req.body || {}).keys, { adapters: bandAdapters })) }); }
  catch (e) { bandCheckError(res, e, 'add the songs'); }
});
```
`saveIdentity` with `value === undefined` fails validation (spotify/musicbrainz/bandcamp: `undefined` is neither `null` nor a valid string) -> `BAD_INPUT`; confirm bandcamp: `value === null ? null : normalize(undefined)` -> `undefined !== null` so it hits the `!origin` branch -> BAD_INPUT. Good.

- [ ] **Step 3: Boot check** — `cd backend && node -e "require('./routes/admin')"` prints no error (it connects to the DB; Ctrl-C/exit via `process.exit()` appended). Per the stale-server hazard: before claiming a restart is needed, check how :5000 was launched.
- [ ] **Step 4: Commit** (`backend/routes/admin.js`; "feat(band-check): admin routes").

---

### Task 9: Frontend — rail entry and BandCheck view

**Files:**
- Modify: `frontend/src/components/admin/QueueRail.jsx` (Capture group)
- Modify: `frontend/src/components/admin/SongsArea.jsx` (selectable queues + render)
- Create: `frontend/src/components/admin/BandCheck.jsx`
- Modify: `frontend/src/styles/admin.css` (append a small `band-check` block)

**Interfaces:**
- Consumes: the five routes via `adminFetch(path, { method, body })` (it JSON-stringifies `body` and adds the password header; relative `/api` paths).
- Produces: view key `band-check`; URL `?queue=band-check&artist=<id>`.

- [ ] **Step 1: Rail + area wiring**
  - `QueueRail.jsx` Capture group becomes `[['inbox', 'Inbox', false], ['to-process', 'To be processed', false], ['band-check', 'Band check', false, true]]` (4th element `true` = no count).
  - `SongsArea.jsx`: add `'band-check'` to `SELECTABLE_QUEUES`; `import BandCheck from './BandCheck';`; extend the ternary: `activeQueue === 'band-check' ? <BandCheck onAdded={() => loadCounts()} /> : …`. Update the comment above `SELECTABLE_QUEUES`.

- [ ] **Step 2: Write `BandCheck.jsx`** (single file; helpers local)

```jsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

// Band check (sub-project H): pick a band, confirm where it lives on Spotify / Bandcamp / MusicBrainz once,
// then review the merged catalogue and add the ticked songs as pending. Nothing is added without a click.
const SOURCE_LABEL = { spotify: 'Spotify', bandcamp: 'Bandcamp', musicbrainz: 'MusicBrainz' };
const PAGE = 50;

async function api(path, opts) {
  const r = await adminFetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.message || d.error || 'Request failed');
    err.artist = d.artist; // present on NO_IDENTITY: lets the view open the Identify step with the band's name
    throw err;
  }
  return d;
}

function stateChip(match) {
  if (match.status === 'rejected') return 'rejected';
  if (match.status === 'pending') return 'pending';
  return match.published ? 'live' : 'not live';
}

function BandList({ onPick }) {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api(`/api/admin/band-check/bands?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`)
        .then(d => { if (live) { setData(d); setError(''); } })
        .catch(e => { if (live) { setData({ rows: [], total: 0 }); setError(e.message); } });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, offset]);
  return (
    <div>
      <input className="admin-input" placeholder="Search bands by name" value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
      {error && <div className="admin-message error">{error}</div>}
      {data === null ? <div className="queue-empty">Loading…</div> : data.rows.length === 0 ? <div className="queue-empty">No bands match.</div> : data.rows.map(b => (
        <div key={b.id} className="inbox-row band-row">
          <div>
            <strong>{b.name}</strong>
            <div className="band-meta">{b.songs} songs · {b.live_songs} live
              {' '}{Object.keys(SOURCE_LABEL).map(s => <span key={s} className={`band-dot ${b.identity[s] ? 'on' : ''}`} title={`${SOURCE_LABEL[s]}${b.identity[s] ? '' : ' - not identified'}`}>{SOURCE_LABEL[s][0]}</span>)}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => onPick(b.id)}>Check</button>
        </div>
      ))}
      {data && data.total > PAGE && (
        <div className="band-pager">
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <button className="btn" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}
    </div>
  );
}

function IdentifyPanel({ artistId, name, identity, onSaved }) {
  const [source, setSource] = useState('spotify');
  const [cands, setCands] = useState(null);
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (src, q) => {
    setCands(null); setError('');
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}/candidates?source=${src}&q=${encodeURIComponent(q || '')}`);
      setCands(d.candidates);
    } catch (e) { setCands([]); setError(e.message); }
  }, [artistId]);
  useEffect(() => { setQuery(''); setPaste(''); search(source, ''); }, [source, search]);

  const save = async (value) => {
    setBusy(true); setError('');
    try { await api(`/api/admin/band-check/bands/${artistId}/identity`, { method: 'PUT', body: { source, value } }); await onSaved(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="band-identify">
      <div className="band-tabs">
        {Object.keys(SOURCE_LABEL).map(s => (
          <button key={s} className={`btn ${source === s ? 'btn-primary' : ''}`} onClick={() => setSource(s)}>
            {SOURCE_LABEL[s]}{identity[s] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <p className="band-meta">Pick the right {SOURCE_LABEL[source]} match for {name}. It is saved, so you only do this once.</p>
      {source !== 'bandcamp' && (
        <form onSubmit={e => { e.preventDefault(); search(source, query); }}>
          <input className="admin-input" placeholder={`Search ${SOURCE_LABEL[source]} (default: ${name})`} value={query} onChange={e => setQuery(e.target.value)} />
        </form>
      )}
      {error && <div className="admin-message error">{error}</div>}
      {cands === null ? <div className="queue-empty">Searching…</div> : cands.length === 0 ? <div className="queue-empty">No candidates{source === 'bandcamp' ? ' found - paste the band\'s Bandcamp address below' : ''}.</div> : cands.map(c => (
        <div key={c.value} className="inbox-row">
          <div><strong>{c.label}</strong><div className="band-meta">{c.detail}{c.url && <> · <a href={c.url} target="_blank" rel="noreferrer">open</a></>}</div></div>
          <button className="btn btn-primary" disabled={busy || identity[source] === c.value} onClick={() => save(c.value)}>{identity[source] === c.value ? 'Chosen' : 'Choose'}</button>
        </div>
      ))}
      {source === 'bandcamp' && (
        <form className="band-paste" onSubmit={e => { e.preventDefault(); save(paste.trim()); }}>
          <input className="admin-input" placeholder="https://bandname.bandcamp.com" value={paste} onChange={e => setPaste(e.target.value)} />
          <button className="btn" disabled={busy || !paste.trim()}>Use this address</button>
        </form>
      )}
      {source !== 'spotify' && identity[source] && <button className="btn" disabled={busy} onClick={() => save(null)}>Clear {SOURCE_LABEL[source]}</button>}
    </div>
  );
}

function Review({ artistId, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [showIdentify, setShowIdentify] = useState(false);
  const [result, setResult] = useState('');
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (fresh) => {
    const my = ++seq.current;
    setError(''); setData(d => (fresh ? d : null));
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}${fresh ? '?fresh=1' : ''}`);
      if (my === seq.current) { setData(d); setPicked(new Set()); setShowIdentify(false); }
    } catch (e) {
      if (my !== seq.current) return;
      setError(e.message);
      // NO_IDENTITY (409) carries the band: open the Identify step instead of leaving the view empty
      if (e.artist) { setShowIdentify(true); setData({ artist: e.artist, sources: {}, releases: [], counts: null }); }
      else setData(prev => prev || { artist: { id: artistId, name: '', identity: { spotify: null, bandcamp: null, musicbrainz: null } }, sources: {}, releases: [], counts: null });
    }
  }, [artistId]);
  useEffect(() => { load(false); }, [load]);

  if (data === null) return <div className="queue-empty">Reading the sources…</div>;
  const newSongs = data.releases.flatMap(r => r.songs).filter(s => s.state === 'new');
  const toggle = (key) => setPicked(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const selectAll = (songs) => setPicked(p => { const n = new Set(p); songs.filter(s => s.state === 'new').forEach(s => n.add(s.key)); return n; });

  const add = async () => {
    setAdding(true); setResult('');
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}/add`, { method: 'POST', body: { keys: [...picked] } });
      setResult(`Added ${d.added}${d.skippedExisting ? `, ${d.skippedExisting} already held` : ''}${d.notFound ? `, ${d.notFound} no longer listed` : ''}.`);
      await load(true);
    } catch (e) { setError(e.message); } finally { setAdding(false); }
  };

  return (
    <div>
      <div className="queue-toolbar">
        <button className="btn" onClick={onBack}>← All bands</button>
        <h2>{data.artist.name || 'Band check'}</h2>
        <button className="btn" onClick={() => setShowIdentify(s => !s)}>Identify sources</button>
        <button className="btn" onClick={() => load(true)}>Refresh</button>
      </div>
      {error && <div className="admin-message error">{error}</div>}
      {result && <div className="admin-message success">{result} <Link to="/admin/songs?queue=to-process">Open To be processed</Link></div>}
      <div className="band-meta">
        {Object.entries(data.sources).map(([s, st]) => (
          <span key={s} className={`band-chip ${st.status}`}>{SOURCE_LABEL[s]}: {st.status === 'ok' ? 'read' : (st.message || 'could not be read this time')}</span>
        ))}
        {data.counts && <span> · {data.counts.new} new · {data.counts.in_catalogue} held · {data.counts.rejected} rejected · {data.counts.single_source} on one source only</span>}
      </div>
      {showIdentify && <IdentifyPanel artistId={artistId} name={data.artist.name} identity={data.artist.identity} onSaved={() => load(true)} />}
      {newSongs.length > 0 && <button className="btn" onClick={() => selectAll(newSongs)}>Select all new ({newSongs.length})</button>}
      {data.releases.map(rel => (
        <section key={`${rel.source}:${rel.name}:${rel.release_date}`} className="band-release">
          <h3>{rel.name} <span className="band-meta">{rel.album_type || ''} {rel.release_date ? `· ${rel.release_date.slice(0, 4)}` : ''}</span>
            {rel.songs.some(s => s.state === 'new') && <button className="btn btn-small" onClick={() => selectAll(rel.songs)}>Select new</button>}
          </h3>
          {rel.songs.map(s => (
            <div key={s.key} className={`inbox-row ${s.state === 'in_catalogue' ? 'band-held' : ''}`}>
              <label>
                {s.state === 'new' && <input type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />}{' '}
                <strong>{s.title}</strong>
                {s.also_on.length > 0 && <span className="band-meta"> · also on {s.also_on.join(', ')}</span>}
              </label>
              <div className="band-meta">
                {Object.keys(s.sources).map(src => <span key={src} className="band-chip">{SOURCE_LABEL[src]}</span>)}
                {s.state === 'new' && Object.keys(s.sources).length === 1 && <span className="band-chip warn">one source only</span>}
                {s.match && <Link className="band-chip" to={`/admin/song/${s.match.song_id}`} title={s.match.matched_by === 'title' ? 'matched by title' : undefined}>{stateChip(s.match)}</Link>}
              </div>
            </div>
          ))}
        </section>
      ))}
      <div className="band-footer">
        <button className="btn btn-primary" disabled={picked.size === 0 || adding} onClick={add}>
          {adding ? 'Adding…' : `Add ${picked.size} to To be processed`}
        </button>
      </div>
    </div>
  );
}

function BandCheck() {
  const [params, setParams] = useSearchParams();
  const artist = parseInt(params.get('artist'), 10);
  const pick = (id) => setParams({ queue: 'band-check', artist: String(id) });
  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      {Number.isSafeInteger(artist) && artist > 0
        ? <Review key={artist} artistId={artist} onBack={() => setParams({ queue: 'band-check' })} />
        : <><div className="queue-toolbar"><h2>Band check</h2></div><BandList onPick={pick} /></>}
    </div>
  );
}
export default BandCheck;
```
Two things to confirm while wiring this file (both are lookups, not design): (a) the admin Songs URL for the "Open To be processed" `Link` — check the router in `App.jsx`/`AdminLayout.jsx` and use the real path (the workbench link `/admin/song/:id` is the one `InboxList` already uses); (b) the 409 `NO_IDENTITY` response must carry `artist` — that is done in Task 7 (the service attaches it to the error) and Task 8 (`bandCheckError` sends it).

- [ ] **Step 3: Append CSS** to `frontend/src/styles/admin.css` using existing tokens (look at neighbouring `inbox-row` rules for token names; no raw colours):

```css
/* Band check (sub-project H) */
.band-row, .band-held { align-items: center; }
.band-held { opacity: 0.6; }
.band-meta { color: var(--text-secondary); font-size: 0.85em; }
.band-dot { display: inline-block; width: 1.4em; text-align: center; border-radius: 50%; border: 1px solid var(--border-subtle); margin-right: 0.2em; opacity: 0.4; }
.band-dot.on { opacity: 1; background: var(--accent-moss); color: var(--bg-base); }
.band-chip { display: inline-block; padding: 0 0.5em; margin-right: 0.3em; border: 1px solid var(--border-subtle); border-radius: 999px; font-size: 0.8em; }
.band-chip.error, .band-chip.warn { border-color: var(--accent-ember); }
.band-release h3 { display: flex; gap: var(--space-2); align-items: baseline; margin-top: var(--space-4); }
.band-footer { position: sticky; bottom: 0; padding: var(--space-3) 0; background: var(--bg-base); }
.band-tabs, .band-paste, .band-pager { display: flex; gap: var(--space-2); align-items: center; margin: var(--space-2) 0; }
```
Verify each token name exists (`grep -n "\-\-accent-moss\|\-\-border-subtle\|\-\-bg-base\|\-\-text-secondary\|\-\-space-2" frontend/src/styles/tokens/*.css`) and substitute the real names; do not invent tokens.

- [ ] **Step 4: Lint + build** — `cd frontend && npm run lint && npm run build`. Expected: 0 errors (6 pre-existing warnings), build clean.
- [ ] **Step 5: Commit** (the four frontend files; "feat(band-check): Band check view").

---

### Task 10: Live verification, docs, wrap-up

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md` (Architecture: one bullet for `services/bandCheck/`; frontend component count 44 -> 45), `docs/PRD.md` feature inventory if it lists admin tools.

- [ ] **Step 1: Full suites** — `cd backend && npm test` and `cd frontend && npm run lint && npm run build`. Record the exact pass counts.
- [ ] **Step 2: Server check** — find how :5000 was launched (process tree) before deciding on a restart; if the running server predates Task 8, restart it by specific PID only (**never `taskkill /IM node.exe`**).
- [ ] **Step 3: Live API check on Bloodmouth** (read-only — **do not call `/add`**): from a scratchpad script (absolute-path dotenv) or curl with the `x-admin-password` header: `GET /api/admin/band-check/bands?q=bloodmouth` (find the id); `GET …/:id/candidates?source=musicbrainz` (expect both the US and the AU "Vegan" band); `GET …/:id/candidates?source=bandcamp`. Saving an identity is a write the curator should make: run it only on a throwaway/`ZZZ` artist, or leave identification to the curator's smoke. Then `GET …/:id` for the band if it already has a Spotify id: confirm held songs are marked and, once a Bandcamp identity is set, that Bandcamp-only songs appear. Report real numbers.
- [ ] **Step 4: Browser check** — start frontend + backend, log in to admin, open Songs > Band check, search a band, open Identify sources, confirm the three tabs render candidates and the review lists releases; per the Vite stale-transform hazard, touch `BandCheck.jsx` and load the page before declaring it ready. If the admin login cannot be driven, say so and leave it for the curator's smoke.
- [ ] **Step 5: Docs** — `PROJECT_STATE.md`: new top "Current state" entry (what was built, verified counts, **curator smoke to do**: identify Bloodmouth on all three sources, review, add a couple, see them under To be processed tagged *From band check*, a Bandcamp-only one carrying its link), Decision Log entries (migration 014; Spotify identity replace-not-clear; note per add; MusicBrainz recording count dropped; Bandcamp scraping accepted with `UNREADABLE` isolation), Changelog line. `PROJECT_PLAN.md`: mark sub-project H built, awaiting smoke. `CLAUDE.md`: add the `services/bandCheck/` bullet (adapters, merge, identity columns, the no-log rule, routes) and bump component count.
- [ ] **Step 6: Commit and push** with explicit paths: `git add CLAUDE.md docs/PROJECT_STATE.md docs/PROJECT_PLAN.md docs/superpowers/plans/2026-10-14-H-band-check.md` (+ `docs/PRD.md` if edited); `git commit -F <msg file>`; `git push`. The merge to `main` waits for the curator's smoke.

---

## Self-review (spec coverage)

| Spec section | Task |
|---|---|
| §3 migration | 1 |
| §4.1 adapters (Spotify / MusicBrainz / Bandcamp, pacing, caps, coded errors, URL validation) | 2, 3, 4 |
| §4.2 merge, credit filter, classify (id / bandcamp url / title, rejected) | 1 |
| §4.3 listBands, identifyCandidates, saveIdentity (+CONFLICT), checkBand (independent sources, cache, fresh, NO_IDENTITY), addSelected (re-read, Spotify path vs manual path, COALESCE, BUSY, cap 100) | 6, 7 |
| `insertCandidates` note, origin CASE, "From band check" label | 5 |
| §5 routes | 8 |
| §6 frontend (rail, list + search + paging, identify panel, review with chips/muted/select-all/add) | 9 |
| §7 risks (wrong band, scraping isolation, caps, secrets) | 3, 4, 7 + Global Constraints |
| §8 testing + live Bloodmouth check, stop before adding | 1–7, 10 |

Known gaps called out rather than hidden: the admin UI cannot be driven without the admin login (curator smokes it, as in earlier sessions); "Not on this source" is simply not choosing a candidate (nothing is saved, so no marker is needed — YAGNI).
