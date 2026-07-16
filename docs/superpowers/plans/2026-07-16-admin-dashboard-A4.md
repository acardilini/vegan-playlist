# A4 — Admin Dashboard landing + cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/admin` dashboard stub with a real landing page (action tiles + catalogue-health line + recent-activity feed + Add-a-song), and delete the old `DataCompletionDashboard`. This closes sub-project A.

**Architecture:** Two small read-only backend endpoints added to `curation.js` + `admin.js` (queue counts already exist and are reused). A new `Dashboard.jsx` React component consumes three admin endpoints via `adminFetch` and renders three sections plus the existing `AddSongPanel` modal. Cleanup removes the dead component, its orphaned `/completion-stats` route, and its exclusive CSS.

**Tech Stack:** Node/Express + PostgreSQL (`pg`), `node:test`; React + Vite + React Router; design-token CSS.

**Spec:** [`docs/superpowers/specs/2026-07-16-admin-dashboard-A4-design.md`](../specs/2026-07-16-admin-dashboard-A4-design.md)

## Global Constraints

- **Admin API calls go through `adminFetch`** (relative `/api` URLs via the Vite proxy + `X-Admin-Password` header). Never hardcode `http://localhost:5000` or the header.
- **All new backend routes sit behind `authenticateAdmin`** — add them inside `admin.js` (already globally authenticated) under the existing `// ===== Curation workbench =====` banner.
- **New/updated styling uses design tokens only** (`--bg-*` / `--text-*` / `--accent-*` / `--space-*` / `--radius-*` / `--border-*`), never raw colors. Dashboard styles live in `frontend/src/styles/admin.css`.
- **Naming guardrail:** delete `frontend/src/components/DataCompletionDashboard.jsx` (the **admin** dashboard). Do **not** touch `frontend/src/components/DataDashboard.jsx` (the **public** `/dashboard` page).
- **Backend tests** use the file-local fixture sentinel `ZZZCUR` (see `backend/test/curation.test.js`); all fixture songs/artists must be titled/named with that prefix so the existing `after()` cleanup sweeps them.
- **No curatorial writes.** The two new endpoints are read-only aggregation.
- **Windows/PowerShell hazard:** never do a whole-file PowerShell read/replace/write on files with non-ASCII glyphs (e.g. the `→` arrow in `Dashboard.jsx` or `App.css`); use the `Edit` tool per hunk. After any scripted rewrite, `grep -nP '[^\x00-\x7F]'` the file.

---

### Task 1: Backend — `catalogueStats` service + route

**Files:**
- Modify: `backend/services/curation.js` (add `catalogueStats`; add to `module.exports`)
- Modify: `backend/routes/admin.js` (add `GET /curation/catalogue-stats` after the existing `/curation/counts` route, ~line 2267)
- Test: `backend/test/curation.test.js` (append a test)

**Interfaces:**
- Produces: `curation.catalogueStats(db) → Promise<{ total, live, toFinalise, pending, rejected }>` (all integers).
- Route: `GET /api/admin/curation/catalogue-stats` → the same object as JSON.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/curation.test.js` (before the `after(...)` block is not required — `node:test` runs the `after` hook once after all tests):

```js
test('catalogueStats returns integer totals by status', async () => {
  const s0 = await curation.catalogueStats(pool);
  assert.equal(typeof s0.total, 'number');
  await mkSong({ title: 'ZZZCUR Stat Live', status: 'included', published: true });
  await mkSong({ title: 'ZZZCUR Stat Fin',  status: 'included', published: false });
  await mkSong({ title: 'ZZZCUR Stat Pend', status: 'pending' });
  await mkSong({ title: 'ZZZCUR Stat Rej',  status: 'rejected' });
  const s1 = await curation.catalogueStats(pool);
  assert.equal(s1.total, s0.total + 4);
  assert.equal(s1.live, s0.live + 1);
  assert.equal(s1.toFinalise, s0.toFinalise + 1);
  assert.equal(s1.pending, s0.pending + 1);
  assert.equal(s1.rejected, s0.rejected + 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test --test-name-pattern="catalogueStats returns integer totals"`
Expected: FAIL — `curation.catalogueStats is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/curation.js`, add near `queueCounts` (after it):

```js
async function catalogueStats(db) {
  const r = await db.query(`
    SELECT
      COUNT(*)::int                                                     AS total,
      COUNT(*) FILTER (WHERE status='included' AND published=true)::int  AS live,
      COUNT(*) FILTER (WHERE status='included' AND published=false)::int AS to_finalise,
      COUNT(*) FILTER (WHERE status='pending')::int                      AS pending,
      COUNT(*) FILTER (WHERE status='rejected')::int                     AS rejected
    FROM songs`);
  const x = r.rows[0];
  return { total: x.total, live: x.live, toFinalise: x.to_finalise, pending: x.pending, rejected: x.rejected };
}
```

Add `catalogueStats` to the `module.exports = { … }` list at the bottom of the file (the line currently exporting `getProcessing, setProcessing, listCurationQueue, queueCounts, getWorkbench, hasArt, …`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test --test-name-pattern="catalogueStats returns integer totals"`
Expected: PASS.

- [ ] **Step 5: Add the route**

In `backend/routes/admin.js`, immediately after the `router.get('/curation/counts', …)` handler (ends ~line 2267), add:

```js
router.get('/curation/catalogue-stats', async (req, res) => {
  try {
    res.json(await curation.catalogueStats(pool));
  } catch (e) {
    console.error('catalogue-stats error:', e);
    res.status(500).json({ error: 'Failed to load catalogue stats', details: e.message });
  }
});
```

- [ ] **Step 6: Commit**

```bash
git add backend/services/curation.js backend/routes/admin.js backend/test/curation.test.js
git commit -m "feat(A4): catalogueStats service + /curation/catalogue-stats route"
```

---

### Task 2: Backend — `recentlyEdited` service + route

**Files:**
- Modify: `backend/services/curation.js` (add `recentlyEdited`; add to `module.exports`)
- Modify: `backend/routes/admin.js` (add `GET /curation/recent` after the catalogue-stats route)
- Test: `backend/test/curation.test.js` (append a test)

**Interfaces:**
- Produces: `curation.recentlyEdited(db, limit = 10) → Promise<Array<{ id, title, status, published, updated_at, artists }>>`, ordered `updated_at DESC`; `limit` clamped to `[1, 50]`.
- Route: `GET /api/admin/curation/recent?limit=<n>` → that array as JSON.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/curation.test.js`:

```js
test('recentlyEdited returns most-recently-updated songs first', async () => {
  const older = await mkSong({ title: 'ZZZCUR Recent Older' });
  const newer = await mkSong({ title: 'ZZZCUR Recent Newer' });
  await pool.query(`UPDATE songs SET updated_at = now() + interval '2 seconds' WHERE id=$1`, [newer]);
  const rows = await curation.recentlyEdited(pool, 50);
  const ids = rows.map(r => r.id);
  assert.ok(ids.includes(newer), 'newer song present');
  assert.ok(ids.includes(older), 'older song present');
  assert.ok(ids.indexOf(newer) < ids.indexOf(older), 'newer appears before older');
  const row = rows.find(r => r.id === newer);
  assert.equal(typeof row.title, 'string');
  assert.ok('artists' in row && 'status' in row && 'published' in row && 'updated_at' in row);
});

test('recentlyEdited clamps limit into [1,50]', async () => {
  assert.equal((await curation.recentlyEdited(pool, 0)).length <= 1, true);
  assert.ok((await curation.recentlyEdited(pool, 9999)).length <= 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test --test-name-pattern="recentlyEdited"`
Expected: FAIL — `curation.recentlyEdited is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/curation.js`, add after `catalogueStats`:

```js
async function recentlyEdited(db, limit = 10) {
  const n = Math.min(Math.max(1, parseInt(limit, 10) || 10), 50);
  return (await db.query(`
    SELECT s.id, s.title, s.status, s.published, s.updated_at,
           COALESCE(string_agg(DISTINCT a.name, ', '), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id=s.id
    LEFT JOIN artists a ON a.id=sa.artist_id
    GROUP BY s.id
    ORDER BY s.updated_at DESC NULLS LAST, s.id DESC
    LIMIT $1`, [n])).rows;
}
```

Add `recentlyEdited` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test --test-name-pattern="recentlyEdited"`
Expected: PASS (both tests).

- [ ] **Step 5: Add the route**

In `backend/routes/admin.js`, after the `/curation/catalogue-stats` handler from Task 1, add:

```js
router.get('/curation/recent', async (req, res) => {
  try {
    res.json(await curation.recentlyEdited(pool, req.query.limit));
  } catch (e) {
    console.error('curation recent error:', e);
    res.status(500).json({ error: 'Failed to load recent activity', details: e.message });
  }
});
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && node --test`
Expected: all tests PASS (the prior 42 + the 3 new ones).

- [ ] **Step 7: Commit**

```bash
git add backend/services/curation.js backend/routes/admin.js backend/test/curation.test.js
git commit -m "feat(A4): recentlyEdited service + /curation/recent route"
```

---

### Task 3: Frontend — `Dashboard.jsx` + styles + router wiring

**Files:**
- Create: `frontend/src/components/admin/Dashboard.jsx`
- Modify: `frontend/src/styles/admin.css` (append dashboard styles + a `.queue-status.rejected` rule)
- Modify: `frontend/src/App.jsx` (swap the `/admin` index route from `DashboardStub` to `Dashboard`)
- Delete: `frontend/src/components/admin/DashboardStub.jsx`

**Interfaces:**
- Consumes: `GET /api/admin/curation/counts` (existing), `GET /api/admin/curation/catalogue-stats` (Task 1), `GET /api/admin/curation/recent` (Task 2); `AddSongPanel` (existing, props `{ onClose, onAdded }`); React Router `Link`.
- Produces: default-exported `Dashboard` React component mounted at `/admin` (index route).

- [ ] **Step 1: Create the component**

Create `frontend/src/components/admin/Dashboard.jsx`:

```jsx
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import AddSongPanel from './AddSongPanel';

// Action tiles: [queueKey, label, disabled]. Inbox is disabled until sub-project C.
const TILES = [
  ['to-process', 'To be processed', false],
  ['needs-lyrics', 'Needs lyrics', false],
  ['needs-cover', 'Needs cover', false],
  ['needs-video', 'Needs video', false],
  ['to-finalise', 'To finalise', false],
  ['inbox', 'Inbox', true],
];

function relTime(ts) {
  if (!ts) return '';
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Status pill text reuses the existing .queue-status.{pending,live,included,rejected} classes.
function statusLabel(s) {
  if (s.status === 'included') return s.published ? 'live' : 'included';
  return s.status; // 'pending' | 'rejected'
}

function Dashboard() {
  const [counts, setCounts] = useState(null);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    adminFetch('/api/admin/curation/counts')
      .then(r => (r.ok ? r.json() : null)).then(setCounts).catch(() => setCounts(null));
    adminFetch('/api/admin/curation/catalogue-stats')
      .then(r => (r.ok ? r.json() : null)).then(setStats).catch(() => setStats(null));
    adminFetch('/api/admin/curation/recent')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setRecent(Array.isArray(d) ? d : [])).catch(() => setRecent([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="admin-dashboard">
      <div className="queue-toolbar">
        <h1>Dashboard</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add a song</button>
      </div>

      <section className="dash-section">
        <h2 className="dash-heading">Needs your attention</h2>
        <div className="dash-tiles">
          {TILES.map(([key, label, disabled]) => {
            const n = counts ? (counts[key] ?? 0) : '·';
            if (disabled) {
              return (
                <div key={key} className="dash-tile disabled" aria-disabled="true">
                  <span className="dash-tile-n">{n}</span>
                  <span className="dash-tile-label">{label}</span>
                  <span className="dash-tile-soon">soon</span>
                </div>
              );
            }
            return (
              <Link key={key} className="dash-tile" to={`/admin/songs?queue=${key}`}>
                <span className="dash-tile-n">{n}</span>
                <span className="dash-tile-label">{label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-heading">Catalogue health</h2>
        <p className="dash-health">
          {stats ? (
            <>
              <strong>{stats.total.toLocaleString()}</strong> songs · {stats.live.toLocaleString()} live ·{' '}
              {stats.toFinalise} to finalise · {stats.pending} pending · {stats.rejected} rejected
            </>
          ) : '·'}
        </p>
      </section>

      <section className="dash-section">
        <h2 className="dash-heading">Recent activity</h2>
        {recent.length === 0 ? (
          <p className="queue-empty">No recent activity.</p>
        ) : (
          <ul className="dash-recent">
            {recent.map(s => (
              <li key={s.id}>
                <Link to={`/admin/song/${s.id}`} className="dash-recent-row">
                  <span className="dash-recent-meta">
                    <span className="dash-recent-title">{s.title}</span>
                    <span className="dash-recent-artist">{s.artists}</span>
                  </span>
                  <span className={`queue-status ${statusLabel(s)}`}>{statusLabel(s)}</span>
                  <span className="dash-recent-time">{relTime(s.updated_at)}</span>
                  <span className="dash-recent-arrow" aria-hidden="true">{'→'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAdd && <AddSongPanel onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}
export default Dashboard;
```

- [ ] **Step 2: Append the styles**

Append to `frontend/src/styles/admin.css`:

```css
/* Dashboard landing — A4 */
.admin-dashboard { max-width: 1100px; }
.dash-section { margin-bottom: var(--space-6); }
.dash-heading { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 var(--space-3); }
.dash-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-3); }
.dash-tile { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); background: var(--bg-surface); border: 1px solid var(--border-hairline); border-radius: var(--radius-lg); text-decoration: none; color: var(--text-primary); }
.dash-tile:hover:not(.disabled) { background: var(--bg-surface-raised); border-color: var(--border-strong); }
.dash-tile-n { font-family: Manrope, sans-serif; font-weight: 700; font-size: 1.6rem; line-height: 1; }
.dash-tile-label { font-size: 0.85rem; color: var(--text-secondary); }
.dash-tile.disabled { opacity: 0.5; cursor: not-allowed; }
.dash-tile-soon { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.dash-health { font-size: 0.95rem; color: var(--text-secondary); margin: 0; }
.dash-health strong { color: var(--text-primary); }
.dash-recent { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.dash-recent-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2); border-bottom: 1px solid var(--border-hairline); text-decoration: none; color: var(--text-primary); }
.dash-recent-row:hover { background: var(--bg-surface-raised); }
.dash-recent-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dash-recent-title { font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dash-recent-artist { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dash-recent-time { font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; }
.dash-recent-arrow { color: var(--text-muted); }
.queue-status.rejected { color: var(--text-muted); border: 1px solid var(--border-hairline); }
```

- [ ] **Step 3: Wire the router and remove the stub**

In `frontend/src/App.jsx`:
- Replace the import `import DashboardStub from './components/admin/DashboardStub';` with `import Dashboard from './components/admin/Dashboard';`
- Replace `<Route index element={<DashboardStub />} />` with `<Route index element={<Dashboard />} />`

Then delete the file `frontend/src/components/admin/DashboardStub.jsx`.

- [ ] **Step 4: Verify build + lint**

Run: `cd frontend && npm run build && npx eslint src/components/admin/Dashboard.jsx src/App.jsx`
Expected: build succeeds; eslint reports 0 errors. Then confirm no dangling references:
Run: `grep -rn "DashboardStub" frontend/src` → Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/Dashboard.jsx frontend/src/styles/admin.css frontend/src/App.jsx
git add -A frontend/src/components/admin/DashboardStub.jsx
git commit -m "feat(A4): admin Dashboard landing (tiles + health + recent activity); remove stub"
```

---

### Task 4: Backend cleanup — delete the orphaned `/completion-stats` route

**Files:**
- Modify: `backend/routes/admin.js` (remove the `router.get('/completion-stats', …)` block)

**Interfaces:** none produced. Verify no consumer remains after Task 3 deletes the only frontend caller.

- [ ] **Step 1: Confirm there are no remaining callers**

Run: `grep -rn "completion-stats" backend frontend/src`
Expected: matches only inside `backend/routes/admin.js` (the route definition). If `frontend/src` still matches, STOP — Task 5's component deletion must precede this; re-order.

- [ ] **Step 2: Delete the route**

In `backend/routes/admin.js`, remove the entire handler `router.get('/completion-stats', async (req, res) => { … });` (currently lines ~1094–1320, beginning `router.get('/completion-stats'` and ending at its matching `});`). Use the `Edit` tool with the exact opening and closing text; do not disturb the following `router.post('/save-lyrics-link', …)` route.

- [ ] **Step 3: Verify the server still loads and tests pass**

Run: `cd backend && node -e "require('./routes/admin.js'); console.log('admin.js loads OK')"`
Expected: prints `admin.js loads OK` (no syntax error).
Run: `cd backend && node --test`
Expected: all tests PASS (unchanged count from Task 2).

- [ ] **Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "chore(A4): delete orphaned /completion-stats admin route"
```

---

### Task 5: Frontend cleanup — delete `DataCompletionDashboard` + its exclusive CSS

**Files:**
- Delete: `frontend/src/components/DataCompletionDashboard.jsx`
- Modify: `frontend/src/styles/../App.css` (`frontend/src/App.css` — remove DataCompletionDashboard-exclusive rules, **preserving shared `.stat-card` and `.action-buttons`**)

**Interfaces:** none. This is dead-code removal only.

- [ ] **Step 1: Confirm the component is unimported**

Run: `grep -rn "DataCompletionDashboard" frontend/src`
Expected: matches only in `frontend/src/components/DataCompletionDashboard.jsx` itself and `frontend/src/App.css` (a CSS comment/selectors). No `import` in any other file. If an import exists, STOP and reassess.

- [ ] **Step 2: Delete the component file**

Delete `frontend/src/components/DataCompletionDashboard.jsx`.

- [ ] **Step 3: Remove its exclusive CSS from `App.css` (surgical)**

The dead block runs from the comment `/* Data Completion Dashboard Styles */` (currently line ~3590) through the end of the `@media (max-width: 768px)` block that closes at line ~4014 (just before the `/* Old song-detail layout … */` comment at ~4016). Read that exact range first (`Read` with offset/limit), then remove **only** the DataCompletionDashboard-exclusive selectors, using the `Edit` tool per hunk (never a whole-file PowerShell rewrite — this file contains `→`/non-ASCII glyphs).

**DELETE these selectors and their rule bodies** (all exclusive to the old dashboard): `.data-completion-dashboard`, `.dashboard-header`, `.dashboard-header h2`, `.dashboard-header p`, `.dashboard-subtitle`, `.refresh-button` (+`:hover`), `.stats-grid`, `.stat-icon`, `.stat-value`, `.stat-content`, `.stat-title`, `.stat-subtitle`, `.priority-section` (+ `h3`), `.priority-grid`, `.priority-indicator`, `.completion-section` (+ variants), `.completion-grid`, `.completion-bar` (+ `.priority`, `:hover`, `-header`, `-track`, `-fill`), `.completion-label`, `.completion-stats`, `.recommendations-section`, `.recommendations-list`, `.recommendation-item` (+ `.urgent/.important/.moderate`), `.rec-icon`, `.rec-content`, `.rec-progress`, `.quick-actions`, `.lyrics-priority`/`.lyrics-summary`/`.lyrics-stat-card`/`.lyrics-priority-note`, `.dashboard-loading`, `.dashboard-error`, `.dashboard-placeholder`, `.error-icon`, `.retry-button` (+`:hover`), and — inside the two `@media` blocks (`max-width: 1024px` and `max-width: 768px`) — the `.completion-grid`, `.stats-grid`, and `.data-completion-dashboard` rules.

**KEEP (do NOT delete — shared with other components):**
- `.stat-card` and any `.stat-card` rule (used by `ArtistsManager.jsx`).
- `.action-buttons` and its `@media` rule (used by `ArtistsManager.jsx` and `BulkCategorizationWorkflow.jsx`).
- Everything from the `/* Old song-detail layout … */` comment (~line 4016) onward.

If removing rules leaves an `@media (max-width: 1024px)` or `@media (max-width: 768px)` block containing only kept rules (`.stat-card`, `.action-buttons`), leave that block with just those rules; if it would be left empty, remove the empty `@media { }` wrapper too.

- [ ] **Step 4: Verify nothing shared was broken and no dead selectors remain referenced**

Run: `grep -rn "data-completion-dashboard\|completion-bar\|completion-grid\|recommendation-item\|priority-indicator\|dashboard-header" frontend/src`
Expected: **no matches** (all removed; none referenced by surviving JSX).
Run: `grep -rn "stat-card\|action-buttons" frontend/src/components/ArtistsManager.jsx frontend/src/components/BulkCategorizationWorkflow.jsx`
Expected: matches still present in the JSX (classes still used), and:
Run: `grep -n "\.stat-card\|\.action-buttons" frontend/src/App.css`
Expected: the `.stat-card` and `.action-buttons` CSS rules still present (kept).
Run: `grep -nP "[^\x00-\x7F]" frontend/src/App.css | head`
Expected: only intentional glyphs (e.g. `→`), no mojibake (no `â€"`-style sequences).

- [ ] **Step 5: Build + lint**

Run: `cd frontend && npm run build && npx eslint src/`
Expected: build succeeds; eslint 0 errors (pre-existing `react-hooks/exhaustive-deps` warnings may remain; no new errors).

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/components/DataCompletionDashboard.jsx frontend/src/App.css
git commit -m "chore(A4): delete DataCompletionDashboard component + its exclusive CSS"
```

---

### Task 6: End-to-end smoke test + verification

**Files:** none (verification only). Follow the End-Session smoke-test guidance in `CLAUDE.md`. Heed the **backend stale-server** and **taskkill** hazards: restart the backend before smoking; never `taskkill /F /IM node.exe`.

- [ ] **Step 1: Full backend suite**

Run: `cd backend && node --test`
Expected: all PASS (42 prior + 3 new).

- [ ] **Step 2: Start a fresh backend and exercise the new endpoints**

Start the backend (restart to clear any stale process), then with the admin password header:

```bash
curl -s -H "X-Admin-Password: $ADMIN_PASSWORD" http://localhost:5000/api/admin/curation/catalogue-stats
curl -s -H "X-Admin-Password: $ADMIN_PASSWORD" "http://localhost:5000/api/admin/curation/recent?limit=5"
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Admin-Password: $ADMIN_PASSWORD" http://localhost:5000/api/admin/completion-stats
```

Expected: catalogue-stats returns `{total,live,toFinalise,pending,rejected}` with real numbers where `live + toFinalise` = included and totals are internally consistent; recent returns ≤5 rows newest-first with `id,title,artists,status,published,updated_at`; the deleted `completion-stats` returns `404`.

- [ ] **Step 3: Headless UI walk**

Start the frontend, log into `/admin`, and confirm:
- The three sections render with real data; tile numbers equal the `/curation/counts` values; the health line equals `/curation/catalogue-stats`.
- Clicking each enabled tile lands on `/admin/songs?queue=<key>` with the matching queue selected; the **Inbox** tile is disabled (no navigation).
- Recent-activity rows link to `/admin/song/:id` (the workbench) for the right song.
- **Add a song** (quick add) with a throwaway `ZZZSMOKE` title bumps **To be processed** by 1 and appears at the top of Recent activity after the panel closes; then clean it up (delete the probe song) and confirm counts return to baseline.
- No console errors originate from `Dashboard.jsx` (the pre-existing ArtistsManager `via.placeholder.com` / `<style jsx>` warnings are out of scope).

- [ ] **Step 4: Confirm DB is unchanged**

Verify queue counts are identical before/after the walk (excluding any intentionally-added-then-removed probe song). No curatorial data touched.

- [ ] **Step 5: Final commit if any smoke fixes were needed**

Only if Step 3/4 surfaced a fix. Otherwise proceed to End-Session (docs update + merge) outside this plan.

---

## Notes for the executor

- Tasks 1–2 are independent of 3; 3 consumes 1–2. Task 4 must run **after** Task 5 deletes the frontend caller *or* after Task 3 (whichever removes the last `completion-stats` reference) — Task 4 Step 1 guards this. The order 1→2→3→4→5→6 is safe because Task 3 removes the only live `completion-stats` consumer (`DataCompletionDashboard` was already unmounted in A2; Task 4's grep will confirm the component file is the sole remaining reference, which Task 5 then deletes). If a reviewer prefers, run Task 5 before Task 4.
- This plan is frontend + two read-only backend endpoints; it closes sub-project A. Sub-projects B–F remain future work.
