# Admin Workbench — A2: Nav Shell + Songs Area — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 10-tab admin with a 5-area nested-route shell and build the **Songs** area (queue rail + paginated list + Add-a-song), consuming A1's live curation API.

**Architecture:** `/admin` becomes a React-Router layout route (`AdminLayout` = client-side login gate + left sidebar + `<Outlet>`). Child routes render the 5 areas (Songs is the A2 deliverable; Dashboard + Workbench are stubs; Artists/Playlists/Data-quality re-parent existing components untouched). The Songs area is `SongsArea` composing a presentational `QueueRail` (fed by `/curation/counts`) and `SongQueueList` (fed by `/curation/queue`), plus an `AddSongPanel` modal. Two small backend additions (`live` count, `curation.quickCapture`) are TDD'd in `backend/test/curation.test.js`.

**Tech Stack:** React 18 + React Router v6 (Vite), Node/Express, PostgreSQL. Admin fetches go through `adminFetch` (`src/api/adminApi.js`) — relative `/api` URLs via the Vite proxy + `X-Admin-Password`. Styling uses the Phase-3 design tokens.

**Spec:** [`docs/superpowers/specs/2026-07-13-admin-workbench-A2-shell-songs-design.md`](../specs/2026-07-13-admin-workbench-A2-shell-songs-design.md).

## Global Constraints

- **Branch:** work on `session-A2-shell-songs` (not `main`). End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Windows/PowerShell:** run git from the repo root; for multi-line commit messages write the message to a scratchpad file and use `git commit -F <file>` (long here-strings fail to parse in PS 5.1). Never do whole-file PowerShell rewrites of files containing non-ASCII glyphs — use the Edit tool per hunk.
- **No frontend unit-test harness exists** (this repo has only backend `node:test`). Frontend tasks are verified by `npm run build` (must succeed) + `npx eslint src/` (0 new errors) + a concrete render/interaction check against a running backend + Vite dev server. The two **backend** additions are TDD'd with `node:test`.
- **Backend tests run against the live shared DB.** Use a unique fixture sentinel prefix per test block and clean up (the existing `curation.test.js` uses `ZZZCUR%`; reuse it — its `after` hook already sweeps `ZZZ%`-titled songs/artists/albums). Never weaken a guardrail test to make it pass.
- **`adminFetch` only** for admin API calls — never hardcode `localhost:5000` or the password header.
- **Design tokens only** for new CSS (from `src/styles/tokens/`): backgrounds `--bg-canvas` / `--bg-surface` / `--bg-surface-raised` / `--bg-overlay`; text `--text-primary` / `--text-secondary` / `--text-muted` / `--text-on-accent`; borders `--border-hairline` / `--border-strong`; accents `--accent-ember-60` (primary) / `--accent-moss-60` (secondary); `--focus-ring`, `--color-danger`; spacing `--space-1..9`; radii `--radius-sm/md/lg/pill`; shadows `--shadow-card/raised`. Reuse component classes `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-sm`, `.input`/`.input-pill`, `.select`, `.tag`/`.tag-ember`/`.tag-moss`. **No emoji, no raw hex colors, no gradients** (brand voice).
- **A1 API shapes (consumed, do not change):**
  - `GET /api/admin/curation/counts` → `{ 'to-process','awaiting-community','remind-later','needs-lyrics','needs-cover','needs-video','needs-analysis','to-finalise','inbox', (after Task 1) 'live' }` — all integers.
  - `GET /api/admin/curation/queue?queue=<key>&q=<s>&limit=<n>&offset=<n>` → `{ queue, total, rows }`. **`total` is the returned page size, NOT the full count** — never use it as a grand total. Each row: `{ id, title, artists, status, published, language, has_art, has_lyrics, has_youtube, has_play_link, play_link_kinds, snooze_until, park_reason, missing[] }`.
  - `GET /api/admin/workbench/:id` → full song object incl. `title`, `artists[]` (admin-only).
  - `POST /api/admin/staging/candidates` `{ urls:[...] }` → `{ success, added, skippedExisting, invalid[] }`.
- **Truth-source safety:** new captures are `pending`; nothing here writes to Spotify or flips curatorial fields silently.

---

### Task 1: Backend — add `live` to `queueCounts`

**Files:**
- Modify: `backend/services/curation.js` (extend `queueCounts`)
- Test: `backend/test/curation.test.js` (extend the existing `queueCounts` test)

**Interfaces:**
- Consumes: existing `queueWhere('live')` (already defined in `curation.js`).
- Produces: `queueCounts(db)` return object gains a `live` integer key.

- [ ] **Step 1: Update the failing test**

In `backend/test/curation.test.js`, find the test `queueCounts returns a number for every queue key` and add `'live'` to its key list so it reads:
```js
test('queueCounts returns a number for every queue key', async () => {
  const c = await curation.queueCounts(pool);
  for (const k of ['to-process','awaiting-community','remind-later','needs-lyrics','needs-cover','needs-video','needs-analysis','to-finalise','inbox','live']) {
    assert.equal(typeof c[k], 'number', `count for ${k}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `node --test test/curation.test.js`
Expected: FAIL — `count for live` (value is `undefined`, not `'number'`).

- [ ] **Step 3: Implement**

In `backend/services/curation.js`, in `queueCounts`, add `'live'` to the `keys` array so the loop computes it via the existing `queueWhere('live')` clause:
```js
const keys = ['to-process','awaiting-community','remind-later','needs-lyrics',
  'needs-cover','needs-video','needs-analysis','to-finalise','live'];
```
(Leave the `inbox` line below the loop unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`): `node --test test/curation.test.js`
Expected: all curation tests pass, including the extended key check.

- [ ] **Step 5: Commit**

```bash
git add backend/services/curation.js backend/test/curation.test.js
git commit -F <scratchpad>/msg.txt   # "feat(A2): add live count to queueCounts for the Songs rail"
```

---

### Task 2: Backend — `curation.quickCapture` + route

**Files:**
- Modify: `backend/services/curation.js` (add `quickCapture`, export it)
- Modify: `backend/test/curation.test.js` (add tests)
- Modify: `backend/routes/admin.js` (add `POST /curation/quick-capture` in the Curation-workbench banner)

**Interfaces:**
- Produces: `quickCapture(db, { title, artist }) -> { id }` — inserts a `pending`, `data_source='manual'` song, upserts a `manual` artist by name, links them; returns the new song id. Throws `Error` with `e.code='BAD_INPUT'` when `title` or `artist` is missing/blank.
- Route: `POST /api/admin/curation/quick-capture` `{ title, artist }` → `{ success, id }`; 400 on `BAD_INPUT`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/curation.test.js` (before the `after` hook):
```js
test('quickCapture creates a pending manual song in the to-process queue', async () => {
  const { id } = await curation.quickCapture(pool, { title: 'ZZZCUR QuickCap', artist: 'ZZZCUR Capper' });
  assert.ok(Number.isInteger(id));
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.status, 'pending');
  assert.equal(wb.published, false);
  assert.ok(wb.artists.some(a => a.name === 'ZZZCUR Capper'));
  const ids = (await curation.listCurationQueue(pool, { queue: 'to-process' })).rows.map(r => r.id);
  assert.ok(ids.includes(id), 'quick-captured song appears in to-process');
});

test('quickCapture rejects blank title or artist', async () => {
  await assert.rejects(curation.quickCapture(pool, { title: '', artist: 'x' }), e => e.code === 'BAD_INPUT');
  await assert.rejects(curation.quickCapture(pool, { title: 'x', artist: '  ' }), e => e.code === 'BAD_INPUT');
});
```

- [ ] **Step 2: Run to verify they fail**

Run (from `backend/`): `node --test test/curation.test.js`
Expected: FAIL — `curation.quickCapture is not a function`.

- [ ] **Step 3: Implement `quickCapture`**

In `backend/services/curation.js`, add before `module.exports` (it mirrors the `mkSong` test helper's inserts — songs + manual artist + link):
```js
async function quickCapture(db, { title, artist } = {}) {
  const t = (title || '').trim();
  const a = (artist || '').trim();
  if (!t || !a) { const e = new Error('title and artist are required'); e.code = 'BAD_INPUT'; throw e; }
  const song = (await db.query(
    `INSERT INTO songs (title, status, published, data_source, created_at)
     VALUES ($1, 'pending', false, 'manual', CURRENT_TIMESTAMP) RETURNING id`, [t])).rows[0];
  let art = (await db.query(
    `SELECT id FROM artists WHERE LOWER(name)=LOWER($1) AND data_source='manual'`, [a])).rows[0];
  if (!art) {
    art = (await db.query(
      `INSERT INTO artists (name, data_source, created_at) VALUES ($1,'manual',CURRENT_TIMESTAMP) RETURNING id`, [a])).rows[0];
  }
  await db.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [song.id, art.id]);
  return { id: song.id };
}
```
Add `quickCapture` to the `module.exports` list.

- [ ] **Step 4: Run to verify they pass**

Run (from `backend/`): `node --test test/curation.test.js`
Expected: all pass. (The `after` hook already deletes `ZZZ%`-titled songs, `ZZZ%` artists, and their `song_artists`/`song_processing` rows.)

- [ ] **Step 5: Add the route**

In `backend/routes/admin.js`, inside the `// ==================== Curation workbench` banner (e.g. after the `/curation/counts` route), add:
```js
router.post('/curation/quick-capture', async (req, res) => {
  try {
    const { id } = await curation.quickCapture(pool, req.body || {});
    res.json({ success: true, id });
  } catch (e) {
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('quick-capture error:', e);
    res.status(500).json({ error: 'Failed to add song', details: e.message });
  }
});
```

- [ ] **Step 6: Verify the route by curl (server running)**

Start the backend (`cd backend && npm run dev`). With the admin password from `backend/.env`:
```bash
PW=$(grep -E "^ADMIN_PASSWORD=" backend/.env | cut -d= -f2- | tr -d '\r')
curl -s -X POST -H "x-admin-password: $PW" -H "Content-Type: application/json" \
  -d '{"title":"ZZZCUR Curl","artist":"ZZZCUR CurlArtist"}' \
  http://localhost:5000/api/admin/curation/quick-capture
# expect {"success":true,"id":<n>}; then confirm it's pending:
curl -s -H "x-admin-password: $PW" "http://localhost:5000/api/admin/curation/queue?queue=to-process&q=ZZZCUR%20Curl"
# cleanup (DATABASE_URL from backend/.env):
psql "$DATABASE_URL" -c "DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCUR%'); DELETE FROM songs WHERE title LIKE 'ZZZCUR%'; DELETE FROM artists WHERE name LIKE 'ZZZCUR%';"
```
Expected: creation returns an id; the song shows in `to-process`; cleanup removes the test rows.

- [ ] **Step 7: Commit**

```bash
git add backend/services/curation.js backend/test/curation.test.js backend/routes/admin.js
git commit -F <scratchpad>/msg.txt   # "feat(A2): curation.quickCapture service + /curation/quick-capture route (pending capture)"
```

---

### Task 3: Admin routing shell (layout + sidebar + re-parented areas + stubs)

**Files:**
- Create: `frontend/src/components/admin/AdminLayout.jsx`
- Create: `frontend/src/components/admin/DashboardStub.jsx`
- Create: `frontend/src/components/admin/WorkbenchStub.jsx`
- Create: `frontend/src/components/admin/SongsArea.jsx` (placeholder now; built in Tasks 4–6)
- Create: `frontend/src/styles/admin.css`
- Modify: `frontend/src/App.jsx` (nested `/admin` routes; import `admin.css`)
- Delete: `frontend/src/components/AdminInterface.jsx`

**Interfaces:**
- Produces: `AdminLayout` (default export) — renders the login gate; when authed, the sidebar (`NavLink`s to the 5 areas + Log out) and `<Outlet/>`. `SongsArea`, `DashboardStub`, `WorkbenchStub` default-export placeholder components.
- Consumes: `ADMIN_PASSWORD` from `../../api/adminApi`; existing `ArtistsManager`, `ManagePlaylistsTab`, `DuplicateManager`.

- [ ] **Step 1: Create the admin shell stylesheet**

Create `frontend/src/styles/admin.css`:
```css
/* Admin shell + Songs area — Phase 4 (A2). Design-token based. */
.admin-shell { display: flex; min-height: calc(100vh - 120px); background: var(--bg-canvas); color: var(--text-primary); }
.admin-sidebar { width: 150px; flex-shrink: 0; background: var(--bg-surface); border-right: 1px solid var(--border-hairline); padding: var(--space-4) var(--space-2); display: flex; flex-direction: column; gap: var(--space-1); }
.admin-sidebar .admin-brand { font-family: Manrope, sans-serif; font-weight: 700; font-size: 0.95rem; padding: var(--space-2); margin-bottom: var(--space-2); }
.admin-area-link { display: block; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); color: var(--text-secondary); text-decoration: none; font-size: 0.9rem; }
.admin-area-link:hover { background: var(--bg-surface-raised); color: var(--text-primary); }
.admin-area-link.active { background: var(--accent-ember-60); color: var(--text-on-accent); font-weight: 600; }
.admin-sidebar .admin-logout { margin-top: auto; background: none; border: none; color: var(--text-muted); font-size: 0.85rem; text-align: left; padding: var(--space-2) var(--space-3); cursor: pointer; }
.admin-sidebar .admin-logout:hover { color: var(--text-primary); }
.admin-main { flex: 1; min-width: 0; padding: var(--space-5); }
.admin-login { max-width: 380px; margin: var(--space-9) auto; background: var(--bg-surface); border: 1px solid var(--border-hairline); border-radius: var(--radius-lg); padding: var(--space-6); }
.admin-login h2 { margin-top: 0; }
.admin-stub { color: var(--text-muted); }
```

- [ ] **Step 2: Create `AdminLayout.jsx`**

Create `frontend/src/components/admin/AdminLayout.jsx`:
```jsx
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ADMIN_PASSWORD } from '../../api/adminApi';

const AREAS = [
  ['/admin', 'Dashboard', true],       // index route → end match
  ['/admin/songs', 'Songs', false],
  ['/admin/artists', 'Artists', false],
  ['/admin/playlists', 'Playlists', false],
  ['/admin/data-quality', 'Data quality', false],
];

function AdminLayout() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

  const login = (e) => {
    e.preventDefault();
    if (pw === ADMIN_PASSWORD) { setAuthed(true); setError(''); }
    else setError('Invalid admin password');
  };

  if (!authed) {
    return (
      <div className="admin-login">
        <h2>Admin access</h2>
        <p className="admin-stub">Enter the admin password to continue.</p>
        {error && <div className="admin-message error">{error}</div>}
        <form onSubmit={login}>
          <input className="input" type="password" placeholder="Admin password"
            value={pw} onChange={(e) => setPw(e.target.value)} required
            style={{ width: '100%', marginBottom: 'var(--space-3)' }} />
          <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>Log in</button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <nav className="admin-sidebar">
        <div className="admin-brand">Admin</div>
        {AREAS.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end} className="admin-area-link">{label}</NavLink>
        ))}
        <button className="admin-logout" onClick={() => setAuthed(false)}>Log out</button>
      </nav>
      <main className="admin-main"><Outlet /></main>
    </div>
  );
}

export default AdminLayout;
```

- [ ] **Step 3: Create the two stubs and the SongsArea placeholder**

Create `frontend/src/components/admin/DashboardStub.jsx`:
```jsx
function DashboardStub() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p className="admin-stub">Queue counts, Add a song, and recent activity arrive in A4. For now, use the Songs area.</p>
    </div>
  );
}
export default DashboardStub;
```

Create `frontend/src/components/admin/WorkbenchStub.jsx`:
```jsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

function WorkbenchStub() {
  const { id } = useParams();
  const [title, setTitle] = useState('');
  useEffect(() => {
    adminFetch(`/api/admin/workbench/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setTitle(d ? d.title : `Song ${id}`))
      .catch(() => setTitle(`Song ${id}`));
  }, [id]);
  return (
    <div>
      <Link to="/admin/songs" className="btn btn-ghost btn-sm">&larr; Back to Songs</Link>
      <h1>{title || `Song ${id}`}</h1>
      <p className="admin-stub">The full Curation Workbench for this song arrives in A3.</p>
    </div>
  );
}
export default WorkbenchStub;
```

Create `frontend/src/components/admin/SongsArea.jsx` (placeholder — Tasks 4–6 build this out):
```jsx
function SongsArea() {
  return (
    <div>
      <h1>Songs</h1>
      <p className="admin-stub">Queue rail + list loading…</p>
    </div>
  );
}
export default SongsArea;
```

- [ ] **Step 4: Wire nested routes in `App.jsx`**

In `frontend/src/App.jsx`: remove the `AdminInterface` import; add the new imports and CSS; replace the single `/admin` route with a nested block.

Add near the other imports:
```jsx
import './styles/admin.css';
import AdminLayout from './components/admin/AdminLayout';
import DashboardStub from './components/admin/DashboardStub';
import SongsArea from './components/admin/SongsArea';
import WorkbenchStub from './components/admin/WorkbenchStub';
import ArtistsManager from './components/ArtistsManager';
import ManagePlaylistsTab from './components/ManagePlaylistsTab';
import DuplicateManager from './components/DuplicateManager';
```
Replace `<Route path="/admin" element={<AdminInterface />} />` with:
```jsx
<Route path="/admin" element={<AdminLayout />}>
  <Route index element={<DashboardStub />} />
  <Route path="songs" element={<SongsArea />} />
  <Route path="artists" element={<ArtistsManager />} />
  <Route path="playlists" element={<ManagePlaylistsTab />} />
  <Route path="data-quality" element={<DuplicateManager />} />
  <Route path="song/:id" element={<WorkbenchStub />} />
</Route>
```
Delete the now-unused `import AdminInterface from './components/AdminInterface';` line if not already removed.

- [ ] **Step 5: Delete the old shell**

```bash
git rm frontend/src/components/AdminInterface.jsx
```
(The superseded tools — `StagingQueue`, `ManageSongsTab`, `LyricsLookupManager`, `YouTubeVideoManager`, `DataDashboard`, `SubmissionsManager`, `BulkCategorizationWorkflow` — are simply no longer imported. Leave their files for A3/A4 to delete after a data-parity check; do NOT delete them now.)

- [ ] **Step 6: Build + lint**

Run:
```bash
cd frontend && npm run build && npx eslint src/components/admin/ src/App.jsx
```
Expected: build succeeds; eslint reports 0 errors on the new files.

- [ ] **Step 7: Manual route check**

Start backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`). In a browser:
- `/admin` shows the login gate; wrong password → "Invalid admin password"; correct password (`VITE_ADMIN_PASSWORD` from `frontend/.env.local`) → the shell.
- Sidebar shows the 5 areas; clicking each navigates and highlights: `/admin` (Dashboard stub), `/admin/songs` (placeholder), `/admin/artists` (ArtistsManager renders its list), `/admin/playlists` (ManagePlaylistsTab), `/admin/data-quality` (DuplicateManager).
- Visiting `/admin/song/541` directly shows the song title + "arrives in A3" + Back link.
- Log out returns to the gate.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/admin/ frontend/src/styles/admin.css
git rm frontend/src/components/AdminInterface.jsx
git commit -F <scratchpad>/msg.txt   # "feat(A2): 5-area admin shell — nested routes, sidebar, re-parented tools, stubs"
```

---

### Task 4: Queue rail

**Files:**
- Create: `frontend/src/components/admin/QueueRail.jsx`
- Modify: `frontend/src/components/admin/SongsArea.jsx` (fetch counts, render the rail, hold active queue in the URL)
- Modify: `frontend/src/styles/admin.css` (rail styles)

**Interfaces:**
- Produces: `QueueRail({ counts, activeQueue, onSelect })` — presentational; `counts` is the `/curation/counts` object (may be `null` while loading); `activeQueue` is a queue key string; `onSelect(queueKey)` is called on click. Inbox & `needs-analysis` render disabled.
- Consumes (in `SongsArea`): `GET /api/admin/curation/counts`; `useSearchParams` for `?queue=`.

- [ ] **Step 1: Add rail styles**

Append to `frontend/src/styles/admin.css`:
```css
.songs-layout { display: flex; gap: var(--space-5); align-items: flex-start; }
.queue-rail { width: 210px; flex-shrink: 0; }
.queue-rail .rail-group { font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); padding: var(--space-3) var(--space-2) var(--space-1); }
.queue-item { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: var(--space-2) var(--space-3); border: none; background: none; border-radius: var(--radius-md); color: var(--text-primary); font-size: 0.9rem; cursor: pointer; text-align: left; }
.queue-item:hover:not(:disabled) { background: var(--bg-surface-raised); }
.queue-item.active { background: var(--bg-surface-raised); box-shadow: inset 3px 0 0 var(--accent-ember-60); }
.queue-item:disabled { color: var(--text-muted); opacity: 0.5; cursor: not-allowed; }
.queue-item .queue-count { font-size: 0.75rem; color: var(--text-muted); background: var(--bg-surface-raised); border-radius: var(--radius-pill); padding: 0 var(--space-2); min-width: 26px; text-align: center; }
.queue-item.active .queue-count { color: var(--accent-ember-60); }
```

- [ ] **Step 2: Create `QueueRail.jsx`**

Create `frontend/src/components/admin/QueueRail.jsx`:
```jsx
// Presentational queue rail. Groups + labels the derived queues; disabled slots
// (Inbox, Needs analysis) are reserved for sub-projects C and B.
const GROUPS = [
  ['Capture', [['inbox', 'Inbox', true], ['to-process', 'To be processed', false]]],
  ['Needs work', [
    ['needs-lyrics', 'Needs lyrics', false],
    ['needs-cover', 'Needs cover', false],
    ['needs-video', 'Needs video', false],
    ['needs-analysis', 'Needs analysis', true],
  ]],
  ['Parked', [['awaiting-community', 'Awaiting community', false], ['remind-later', 'Remind me later', false]]],
  ['Publish', [['to-finalise', 'To finalise', false], ['live', 'Live', false]]],
];

function QueueRail({ counts, activeQueue, onSelect }) {
  return (
    <nav className="queue-rail">
      {GROUPS.map(([group, items]) => (
        <div key={group}>
          <div className="rail-group">{group}</div>
          {items.map(([key, label, disabled]) => (
            <button
              key={key}
              className={`queue-item ${activeQueue === key ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => !disabled && onSelect(key)}
            >
              <span>{label}</span>
              <span className="queue-count">{counts ? (counts[key] ?? 0) : '·'}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
export default QueueRail;
```

- [ ] **Step 3: Wire the rail into `SongsArea`**

Replace `frontend/src/components/admin/SongsArea.jsx` with:
```jsx
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import QueueRail from './QueueRail';

const DEFAULT_QUEUE = 'to-process';

function SongsArea() {
  const [params, setParams] = useSearchParams();
  const activeQueue = params.get('queue') || DEFAULT_QUEUE;
  const [counts, setCounts] = useState(null);

  const loadCounts = useCallback(() => {
    adminFetch('/api/admin/curation/counts')
      .then(r => r.ok ? r.json() : null)
      .then(setCounts)
      .catch(() => setCounts(null));
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const selectQueue = (key) => setParams({ queue: key });

  return (
    <div>
      <h1>Songs</h1>
      <div className="songs-layout">
        <QueueRail counts={counts} activeQueue={activeQueue} onSelect={selectQueue} />
        <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
          <p className="admin-stub">Selected queue: {activeQueue} — list arrives in the next step.</p>
        </div>
      </div>
    </div>
  );
}
export default SongsArea;
```

- [ ] **Step 4: Build + lint**

Run:
```bash
cd frontend && npm run build && npx eslint src/components/admin/
```
Expected: build succeeds; 0 eslint errors.

- [ ] **Step 5: Manual check**

With backend + Vite running, open `/admin/songs`:
- The rail shows all queues grouped Capture / Needs work / Parked / Publish.
- Counts match `GET /api/admin/curation/counts` (compare via `curl -H "x-admin-password: $PW" .../curation/counts`) — including a **Live** count.
- Inbox and Needs analysis are visibly disabled (dimmed, not clickable).
- Clicking a queue highlights it and updates the URL to `/admin/songs?queue=<key>`; reloading that URL keeps the selection. Default (no `?queue=`) selects **To be processed**.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/QueueRail.jsx frontend/src/components/admin/SongsArea.jsx frontend/src/styles/admin.css
git commit -F <scratchpad>/msg.txt   # "feat(A2): Songs queue rail (grouped queues + live counts, URL-synced selection)"
```

---

### Task 5: Song queue list (rows + chips + search + Prev/Next)

**Files:**
- Create: `frontend/src/components/admin/SongQueueList.jsx`
- Modify: `frontend/src/components/admin/SongsArea.jsx` (render the list for the active queue)
- Modify: `frontend/src/styles/admin.css` (list/row styles)

**Interfaces:**
- Produces: `SongQueueList({ queue })` — fetches `/curation/queue` for `queue`, owns its own `search`/`page` state (resets when `queue` changes), renders rows + a search box + Prev/Next. Row click navigates to `/admin/song/:id`.
- Consumes: `GET /api/admin/curation/queue?queue=&q=&limit=&offset=`; `useNavigate`.

- [ ] **Step 1: Add list styles**

Append to `frontend/src/styles/admin.css`:
```css
.queue-toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.queue-toolbar h2 { font-size: 1.05rem; margin: 0; }
.song-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-2); border-bottom: 1px solid var(--border-hairline); width: 100%; background: none; border-left: none; border-right: none; border-top: none; text-align: left; cursor: pointer; color: var(--text-primary); }
.song-row:hover { background: var(--bg-surface-raised); }
.song-row .cover { width: 38px; height: 38px; border-radius: var(--radius-sm); flex-shrink: 0; background: var(--bg-surface-raised); background-size: cover; background-position: center; }
.song-row .cover.placeholder { background-image: repeating-linear-gradient(45deg, var(--bg-surface-raised), var(--bg-surface-raised) 6px, var(--bg-surface) 6px, var(--bg-surface) 12px); }
.song-row .song-meta { flex: 1; min-width: 0; }
.song-row .song-title { font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.song-row .song-artist { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.song-row .miss-chips { display: flex; gap: var(--space-1); flex-wrap: wrap; justify-content: flex-end; max-width: 260px; }
.miss-chip { font-size: 0.68rem; padding: 1px var(--space-2); border-radius: var(--radius-pill); background: var(--bg-surface-raised); color: var(--text-muted); border: 1px solid var(--border-hairline); white-space: nowrap; }
.miss-chip.warn { color: var(--accent-ember-60); border-color: var(--accent-ember-40); }
.queue-status { font-size: 0.68rem; padding: 1px var(--space-2); border-radius: var(--radius-pill); font-weight: 600; }
.queue-status.pending { color: var(--color-warning); border: 1px solid var(--color-warning); }
.queue-status.live { color: var(--accent-moss-60); border: 1px solid var(--accent-moss-60); }
.queue-status.included { color: var(--text-secondary); border: 1px solid var(--border-strong); }
.queue-pager { display: flex; gap: var(--space-3); align-items: center; margin-top: var(--space-4); }
.queue-empty { color: var(--text-muted); padding: var(--space-5) 0; }
```

- [ ] **Step 2: Create `SongQueueList.jsx`**

Create `frontend/src/components/admin/SongQueueList.jsx`:
```jsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

const PAGE_SIZE = 50;

function coverStyle(row) {
  // A1 rows carry has_art but not the image URL; show a placeholder unless art exists.
  return row.has_art ? {} : {};
}

function statusClass(row) {
  if (row.status === 'included' && row.published) return 'live';
  return row.status; // 'pending' | 'included' | 'rejected'
}
function statusLabel(row) {
  if (row.status === 'included' && row.published) return 'live';
  return row.status;
}

function SongQueueList({ queue }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  // Reset paging/search whenever the queue changes.
  useEffect(() => { setPage(0); setSearch(''); }, [queue]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ queue, q: search, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    adminFetch(`/api/admin/curation/queue?${qs.toString()}`)
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(d => setRows(d.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [queue, search, page]);

  // Debounce search; immediate on queue/page change.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const hasNext = rows.length === PAGE_SIZE;

  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar">
        <h2>{queue}</h2>
        <input className="input input-pill" placeholder="Search this queue…"
          value={search} onChange={(e) => { setPage(0); setSearch(e.target.value); }}
          style={{ width: 220 }} />
      </div>

      {loading && rows.length === 0 ? (
        <div className="queue-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="queue-empty">Nothing here right now.</div>
      ) : (
        rows.map(row => (
          <button key={row.id} className="song-row" onClick={() => navigate(`/admin/song/${row.id}`)}>
            <span className={`cover ${row.has_art ? '' : 'placeholder'}`} style={coverStyle(row)} />
            <span className="song-meta">
              <span className="song-title">{row.title}</span>
              <span className="song-artist">{row.artists || '—'}</span>
            </span>
            <span className={`queue-status ${statusClass(row)}`}>{statusLabel(row)}</span>
            <span className="miss-chips">
              {(row.missing || []).map(m => (
                <span key={m} className="miss-chip warn">no {m}</span>
              ))}
            </span>
          </button>
        ))
      )}

      <div className="queue-pager">
        <button className="btn btn-secondary btn-sm" disabled={page === 0}
          onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</button>
        <span className="admin-stub">Page {page + 1}</span>
        <button className="btn btn-secondary btn-sm" disabled={!hasNext}
          onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>
    </div>
  );
}
export default SongQueueList;
```
*(The `coverStyle` helper is a seam: A1's queue rows expose `has_art` but not the image URL, so covers render as the striped placeholder in the list. The real thumbnail appears in the A3 Workbench, which reads the full album images. Keep the helper so A3 can wire an image later without restructuring.)*

- [ ] **Step 3: Render the list in `SongsArea`**

In `frontend/src/components/admin/SongsArea.jsx`, import the list and replace the `songs-main` placeholder `<div>` with the component:
```jsx
import SongQueueList from './SongQueueList';
```
Replace:
```jsx
<div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
  <p className="admin-stub">Selected queue: {activeQueue} — list arrives in the next step.</p>
</div>
```
with:
```jsx
<SongQueueList queue={activeQueue} />
```

- [ ] **Step 4: Build + lint**

Run:
```bash
cd frontend && npm run build && npx eslint src/components/admin/
```
Expected: build succeeds; 0 eslint errors.

- [ ] **Step 5: Manual check**

With backend + Vite running, at `/admin/songs`:
- **To be processed** lists pending songs; each row shows title, artist, a `pending` badge, and "no lyrics/cover/video/play link" chips matching its gaps.
- Selecting **Needs video** (~700) loads its rows; **Next →** advances a page and **← Prev** returns; the pager disables Prev on page 1.
- Typing in the search box filters the list (e.g. an artist name) and resets to page 1.
- Clicking a row navigates to `/admin/song/:id` (the stub).
- An empty queue (e.g. Awaiting community, count 0) shows "Nothing here right now."

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/SongQueueList.jsx frontend/src/components/admin/SongsArea.jsx frontend/src/styles/admin.css
git commit -F <scratchpad>/msg.txt   # "feat(A2): Songs list — rows, missing-item chips, search, Prev/Next paging"
```

---

### Task 6: Add-a-song modal (quick capture + Spotify paste)

**Files:**
- Create: `frontend/src/components/admin/AddSongPanel.jsx`
- Modify: `frontend/src/components/admin/SongsArea.jsx` (Add-a-song button + modal + count/list refresh)
- Modify: `frontend/src/styles/admin.css` (modal styles)

**Interfaces:**
- Produces: `AddSongPanel({ onClose, onAdded })` — a modal with two modes; calls `onAdded()` after each successful add (so the parent refreshes counts) and stays open (clears its inputs) for the next entry.
- Consumes: `POST /api/admin/curation/quick-capture` `{ title, artist }`; `POST /api/admin/staging/candidates` `{ urls }`.

- [ ] **Step 1: Add modal styles**

Append to `frontend/src/styles/admin.css`:
```css
.modal-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); display: flex; align-items: flex-start; justify-content: center; padding-top: 10vh; z-index: 50; }
.modal-card { background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-raised); width: 480px; max-width: 92vw; padding: var(--space-5); }
.modal-card h2 { margin-top: 0; }
.modal-tabs { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); }
.modal-tabs .btn { flex: 1; }
.modal-field { margin-bottom: var(--space-3); }
.modal-field label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: var(--space-1); }
.modal-actions { display: flex; justify-content: space-between; align-items: center; margin-top: var(--space-4); }
.modal-result { font-size: 0.85rem; color: var(--text-secondary); margin-top: var(--space-2); }
```

- [ ] **Step 2: Create `AddSongPanel.jsx`**

Create `frontend/src/components/admin/AddSongPanel.jsx`:
```jsx
import { useState } from 'react';
import { adminFetch } from '../../api/adminApi';

function AddSongPanel({ onClose, onAdded }) {
  const [mode, setMode] = useState('quick'); // 'quick' | 'spotify'
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const quickAdd = async () => {
    if (!title.trim() || !artist.trim()) { setResult('Title and artist are required.'); return; }
    setBusy(true); setResult('');
    try {
      const r = await adminFetch('/api/admin/curation/quick-capture', {
        method: 'POST', body: { title: title.trim(), artist: artist.trim() },
      });
      const d = await r.json();
      if (r.ok && d.success) {
        setResult(`Added "${title.trim()}" to To be processed.`);
        setTitle(''); setArtist(''); onAdded();
      } else setResult(`Error: ${d.error || 'could not add song'}`);
    } catch { setResult('Error: request failed'); }
    finally { setBusy(false); }
  };

  const importSpotify = async () => {
    const list = urls.split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (list.length === 0) { setResult('Paste at least one Spotify URL.'); return; }
    setBusy(true); setResult('');
    try {
      const r = await adminFetch('/api/admin/staging/candidates', { method: 'POST', body: { urls: list } });
      const d = await r.json();
      if (r.ok && d.success) {
        setResult(`Imported ${d.added} as pending · ${d.skippedExisting} already present · ${(d.invalid || []).length} invalid.`);
        setUrls(''); onAdded();
      } else setResult(`Error: ${d.error || 'could not import'}`);
    } catch { setResult('Error: request failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Add a song</h2>
        <div className="modal-tabs">
          <button className={`btn btn-sm ${mode === 'quick' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('quick')}>Quick add</button>
          <button className={`btn btn-sm ${mode === 'spotify' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('spotify')}>From Spotify</button>
        </div>

        {mode === 'quick' ? (
          <>
            <div className="modal-field">
              <label>Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="modal-field">
              <label>Artist</label>
              <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} style={{ width: '100%' }} />
            </div>
          </>
        ) : (
          <div className="modal-field">
            <label>Spotify track or playlist URLs (space/newline separated)</label>
            <textarea className="input" rows={4} value={urls} onChange={(e) => setUrls(e.target.value)}
              placeholder="https://open.spotify.com/track/…" style={{ width: '100%' }} />
          </div>
        )}

        {result && <div className="modal-result">{result}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={busy}
            onClick={mode === 'quick' ? quickAdd : importSpotify}>
            {busy ? 'Adding…' : (mode === 'quick' ? 'Add song' : 'Import')}
          </button>
        </div>
      </div>
    </div>
  );
}
export default AddSongPanel;
```

- [ ] **Step 3: Wire the button + modal into `SongsArea`**

In `frontend/src/components/admin/SongsArea.jsx`:
- import: `import AddSongPanel from './AddSongPanel';`
- add state: `const [showAdd, setShowAdd] = useState(false);` and a `refreshKey` to force the list to reload after an add: `const [refreshKey, setRefreshKey] = useState(0);`
- put a header row with the button above `songs-layout`:
```jsx
<div className="queue-toolbar">
  <h1>Songs</h1>
  <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add a song</button>
</div>
```
(remove the standalone `<h1>Songs</h1>` you had)
- pass `refreshKey` to the list so a new key remounts/reloads it: `<SongQueueList queue={activeQueue} refreshKey={refreshKey} />`
- render the modal when open:
```jsx
{showAdd && (
  <AddSongPanel
    onClose={() => setShowAdd(false)}
    onAdded={() => { loadCounts(); setRefreshKey(k => k + 1); }}
  />
)}
```
Then in `SongQueueList.jsx`, add `refreshKey` to the props and to the `load` effect deps so an add refreshes the current list:
```jsx
function SongQueueList({ queue, refreshKey }) {
```
and include `refreshKey` in the `useCallback(..., [queue, search, page, refreshKey])` dependency array.

- [ ] **Step 4: Build + lint**

Run:
```bash
cd frontend && npm run build && npx eslint src/components/admin/
```
Expected: build succeeds; 0 eslint errors.

- [ ] **Step 5: Manual end-to-end check**

With backend + Vite running, at `/admin/songs`:
- Click **+ Add a song** → modal opens on **Quick add**.
- Enter a test title (`ZZZCUR UI Test`) + artist (`ZZZCUR UI Artist`) → **Add song** → result says "Added … to To be processed"; the To-be-processed count in the rail increments; the inputs clear (modal stays open).
- Switch to **From Spotify**, paste a real Spotify track URL, **Import** → result reports added/skipped/invalid.
- Close the modal; the new quick-added song appears in the **To be processed** list (search `ZZZCUR UI Test`).
- **Cleanup the test rows** afterward:
```bash
psql "$DATABASE_URL" -c "DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCUR UI%'); DELETE FROM songs WHERE title LIKE 'ZZZCUR UI%'; DELETE FROM artists WHERE name LIKE 'ZZZCUR UI%';"
```
(Also delete any Spotify test track you imported if it was only for the test.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/AddSongPanel.jsx frontend/src/components/admin/SongsArea.jsx frontend/src/components/admin/SongQueueList.jsx frontend/src/styles/admin.css
git commit -F <scratchpad>/msg.txt   # "feat(A2): Add-a-song modal (quick capture + Spotify paste) with count refresh"
```

---

### Task 7: Full smoke, docs, End-Session

**Files:**
- Modify: `docs/PROJECT_STATE.md` (changelog + advance next session to A3)
- Modify: `docs/PROJECT_PLAN.md` (tick A2; A3 = next)

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Backend suite green**

Run (from `backend/`): `node --test`
Expected: all suites pass (`migration006`, `curation` incl. the new `live` + `quickCapture` tests, `videos`, `lyrics_privacy`, `staging`).

- [ ] **Step 2: Frontend build + repo-wide lint**

Run:
```bash
cd frontend && npm run build && npx eslint src/
```
Expected: build clean; **0 errors** (pre-existing `react-hooks/exhaustive-deps` warnings may remain — no new errors introduced).

- [ ] **Step 3: Full headless/manual smoke walk**

With backend + Vite running, verify in one pass (headless Chrome or manual):
1. `/admin` login gate → correct password → shell; wrong password rejected; Log out works.
2. All five areas render: Dashboard stub, Songs (rail + list), Artists (`ArtistsManager` list loads), Playlists (`ManagePlaylistsTab`), Data quality (`DuplicateManager`).
3. Songs rail counts equal `/curation/counts` (incl. `live`); Inbox + Needs analysis disabled; queue selection reflected in `?queue=` and survives reload.
4. List search + Prev/Next work on a large queue; row click → `/admin/song/:id` stub shows the title.
5. Add-a-song: a quick capture lands in To-be-processed and bumps the count; a Spotify paste reports a result. **Clean up all `ZZZCUR%` test rows** (see Task 6 Step 5).
6. No console errors; no horizontal overflow at 1280.

Record the result (pass/fail with details) in the changelog.

- [ ] **Step 4: Update `PROJECT_STATE.md`**

- Current State → A2 complete (merged pending curator click-through); Next session → **Write & execute A3 — the Curation Workbench page** (closes the editing gap from A2's replace-outright decision).
- Add a Changelog entry summarising A2 (5-area shell, Songs area, Add-a-song, the two small backend additions, the smoke result).
- Note in Watch-outs: **per-song editing (lyrics/publish/include-reject) is unavailable in the new admin until A3** — the superseded tool components (`StagingQueue`, `ManageSongsTab`, `LyricsLookupManager`, `YouTubeVideoManager`, `DataDashboard`, `SubmissionsManager`, `BulkCategorizationWorkflow`) are unmounted (files retained for A3/A4 to delete after parity checks).

- [ ] **Step 5: Update `PROJECT_PLAN.md`**

Mark **A2 ☑** (done + smoke), and set **A3** as the next sub-project (note it should immediately follow to close the editing gap).

- [ ] **Step 6: Commit**

```bash
git add docs/PROJECT_STATE.md docs/PROJECT_PLAN.md
git commit -F <scratchpad>/msg.txt   # "docs(A2): mark A2 complete — 5-area shell + Songs area; A3 next"
```

- [ ] **Step 7: Push the branch**

```bash
git push -u origin session-A2-shell-songs
```
Report the branch is pushed and awaiting curator click-through + merge (do not merge to `main` without the go-ahead).

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2 decision 1 (nested routes) → Task 3. ✅
- §2 decision 2 (Option-B sidebar + rail) → Tasks 3 (sidebar) + 4 (rail). ✅
- §2 decision 3 (Add-a-song modal) → Task 6. ✅
- §2 decision 4 (replace outright; editing gap noted) → Task 3 (delete `AdminInterface`, unmount tools) + Task 7 watch-out. ✅
- §2 decision 5 (brand tokens) → `admin.css` built across Tasks 3–6 using only tokens/classes. ✅
- §3 routes table (Dashboard/Songs/Artists/Playlists/Data-quality/Workbench) → Task 3. ✅
- §4 rail (grouping, disabled stubs, default queue, `?queue=` URL) → Task 4; `live` count → Task 1. ✅
- §4 list (rows, chips, Prev/Next no-total, search, row click) → Task 5. ✅
- §5 Add-a-song (quick capture pending via `quickCapture`, Spotify paste, stay-open + count refresh) → Tasks 2 + 6. ✅
- §6 re-parent untouched / unmount superseded / keep files → Task 3. ✅
- §7 verification (login, area routes, counts, search+paging, add-a-song, build/eslint) → Tasks 3–7. ✅

**Placeholder scan:** none — every step has runnable code/CSS/commands. `<scratchpad>/msg.txt` denotes the commit-message file path (per the PowerShell constraint), not a code placeholder.

**Type consistency:** `quickCapture(db,{title,artist})→{id}` and its route `{success,id}` match Tasks 2/6. `QueueRail({counts,activeQueue,onSelect})` and `SongQueueList({queue,refreshKey})` props match their call sites in `SongsArea` (Tasks 4/5/6). Queue keys (`to-process`,`needs-lyrics`,…,`live`,`inbox`,`needs-analysis`) are identical across the rail groups, `/curation/counts` (incl. Task 1's `live`), and A1's `queueWhere`. `adminFetch(path,{method,body})` usage matches its signature.

## Follow-on

- **A3 — the Curation Workbench** at `/admin/song/:id` (replaces `WorkbenchStub`): all panels, autosave-on-blur, prev/next, completeness checklist, reject-confirm, quick-search links, highlights picker — consuming A1's `GET/PUT /workbench/*` + video endpoints and the `staging` lifecycle. Deletes `StagingQueue`, `LyricsLookupManager`, `YouTubeVideoManager`, `ManageSongsTab` after a parity check. **Should immediately follow A2** to close the editing gap.
- **A4 — Dashboard contents** replacing `DashboardStub`; deletes `DataDashboard`.
