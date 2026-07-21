# Triage 3b — Featured management view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Featured" scope in the admin Songs area (rail + count + list) that shows every featured song with a quick Unfeature button, a Featured badge on rows everywhere, and a Featured tile on the Dashboard.

**Architecture:** Reuse the derived-queue system — add a `featured` queue to `queueWhere`/`queueCounts`, surface `featured` per row, and reuse the existing `POST /songs/:id/unfeature`. Frontend adds the scope to the rail/list, a badge, a per-row Unfeature button (in the featured scope), and a Dashboard tile.

**Tech Stack:** Node/Express, PostgreSQL, `node:test`; React/Vite (live-smoke verified).

## Global Constraints

- Restart the backend fresh before smoke (plain `node server.js`, no reload). Temp scripts from the scratchpad.
- `curation.test.js` uses the `ZZZCUR` sentinel — new fixtures keep that prefix.
- `'featured'` is a controlled literal in `queueWhere` — never user input; injection-safe.
- Admin endpoints need the `x-admin-password` header (via `adminFetch`).
- Commit with `git commit -F <scratchpad-file>`. Branch: `session-triage-3b-featured-manage` (spec committed there).

---

### Task 1: Backend `featured` queue + count + row field (TDD)

**Files:**
- Modify: `backend/services/curation.js` (`queueWhere`, `QUEUE_NAMES`, `queueCounts`, `listCurationQueue` SELECT, `mapQueueRow`)
- Modify: `backend/test/curation.test.js` (append a test)

**Interfaces:**
- Produces: `listCurationQueue({queue:'featured'})` → rows where `featured=true`; each row has `featured:boolean`; `queueCounts(db).featured:number`.

- [ ] **Step 1: Write the failing test** (append before/after existing tests in `curation.test.js`):

```js
test('featured queue lists featured songs and queueCounts.featured tracks them', async () => {
  const f = await mkSong({ title: 'ZZZCUR Feat On', status: 'included', published: true });
  const n = await mkSong({ title: 'ZZZCUR Feat Off', status: 'included', published: true });
  await curation.setFeatured(pool, f, true);
  const before = (await curation.queueCounts(pool)).featured;
  const list = await curation.listCurationQueue(pool, { queue: 'featured' });
  const ids = list.rows.map(r => r.id);
  assert.ok(ids.includes(f), 'featured song present');
  assert.ok(!ids.includes(n), 'non-featured excluded');
  assert.equal(list.rows.find(r => r.id === f).featured, true, 'row carries featured');
  await curation.setFeatured(pool, n, true);
  assert.equal((await curation.queueCounts(pool)).featured, before + 1, 'count increments');
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd backend && npx node --test --test-name-pattern="featured queue lists"`
Expected: FAIL — `queueWhere` throws `BAD_QUEUE` for `'featured'` (or `featured` is undefined on the row).

- [ ] **Step 3: Add the `featured` queue + count**

In `curation.js`, in the `queueWhere` switch, add before `default:`:

```js
    case 'featured':
      return `s.featured=true`;
```

Add `'featured'` to `QUEUE_NAMES` (the array near the top of the queue section). In `queueCounts`, add `'featured'` to the `keys` array:

```js
  const keys = ['to-process','awaiting-community','remind-later','needs-lyrics',
    'needs-cover','needs-video','needs-analysis','to-finalise','live','all','featured'];
```

- [ ] **Step 4: Surface `featured` on rows**

In `listCurationQueue`'s SELECT, add `s.featured` to the column list (e.g. after `s.published`):

```js
    SELECT s.id, s.title, s.status, s.published, s.featured, s.language,
```

In `mapQueueRow`'s returned object, add `featured`:

```js
    id: r.id, title: r.title, artists: r.artists, status: r.status, published: r.published,
    featured: r.featured,
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass (92 prior + 1 new = 93).

- [ ] **Step 6: Commit**

```bash
git add backend/services/curation.js backend/test/curation.test.js
git commit -F <scratchpad-msg>   # "feat(triage-3b): featured queue scope + count + row featured field"
```

---

### Task 2: Featured scope UI — rail, list badge + Unfeature, Dashboard tile

**Files:**
- Modify: `frontend/src/components/admin/SongsArea.jsx` (`SELECTABLE_QUEUES`)
- Modify: `frontend/src/components/admin/QueueRail.jsx` (add Featured item)
- Modify: `frontend/src/components/admin/SongQueueList.jsx` (label, badge, Unfeature, row refactor)
- Modify: `frontend/src/components/admin/Dashboard.jsx` (Featured tile)
- Modify: `frontend/src/styles/components.css` (badge + row-wrap)

**Interfaces:** consumes Task 1 (`featured` queue/count/row field) + `POST /songs/:id/unfeature`.

- [ ] **Step 1: Make `featured` a selectable queue**

In `SongsArea.jsx`, add `'featured'` to `SELECTABLE_QUEUES`:

```js
  'awaiting-community', 'remind-later', 'to-finalise', 'live', 'all', 'featured',
```

- [ ] **Step 2: Add the Featured rail item**

In `QueueRail.jsx`, extend the `Publish` group:

```js
  ['Publish', [['to-finalise', 'To finalise', false], ['live', 'Live', false], ['featured', 'Featured', false]]],
```

- [ ] **Step 3: Label + badge + Unfeature in the list**

In `SongQueueList.jsx`:

Add to `QUEUE_LABELS`:

```js
  'live': 'Live', 'all': 'All songs', 'featured': 'Featured',
```

Add an `unfeature` handler (near `load`):

```js
  const unfeature = useCallback(async (id) => {
    try {
      const r = await adminFetch(`/api/admin/songs/${id}/unfeature`, { method: 'POST' });
      if (r.ok) load(); else window.alert('Failed to unfeature');
    } catch { window.alert('Request failed'); }
  }, [load]);
```

Replace the row `.map(...)` (the `<button className="song-row" …>…</button>` block) with a wrapper that
keeps whole-row navigation and adds the badge + (featured-scope-only) Unfeature sibling:

```jsx
        rows.map(row => (
          <div key={row.id} className="song-row-wrap">
            <button className="song-row" onClick={() => navigate(`/admin/song/${row.id}`, {
              state: { from: queue, ids: rows.map((r) => r.id), index: rows.findIndex((r) => r.id === row.id) },
            })}>
              <span className={`cover ${row.has_art ? '' : 'placeholder'}`} style={coverStyle(row)} />
              <span className="song-meta">
                <span className="song-title">{row.title}</span>
                <span className="song-artist">{row.artists || '—'}</span>
              </span>
              <span className={`queue-status ${statusClass(row)}`}>{statusLabel(row)}</span>
              {row.featured && <span className="featured-badge">Featured</span>}
              <span className="miss-chips">
                {(row.missing || []).map(m => (
                  <span key={m} className="miss-chip warn">no {m}</span>
                ))}
              </span>
            </button>
            {queue === 'featured' && (
              <button className="btn btn-secondary btn-sm song-row-action"
                onClick={() => unfeature(row.id)}>Unfeature</button>
            )}
          </div>
        ))
```

- [ ] **Step 4: Dashboard Featured tile**

In `Dashboard.jsx`, add to the `TILES` array:

```js
  ['to-finalise', 'To finalise', false],
  ['featured', 'Featured', false],
  ['inbox', 'Inbox', true],
```

- [ ] **Step 5: CSS**

In `components.css` (admin section), add:

```css
.song-row-wrap { display: flex; align-items: center; gap: var(--space-2); }
.song-row-wrap .song-row { flex: 1; }
.featured-badge {
  display: inline-flex; align-items: center; padding: 2px 10px;
  border-radius: var(--radius-pill); font: var(--text-meta); white-space: nowrap;
  background: var(--accent-ember-60); color: var(--text-on-accent);
}
```

- [ ] **Step 6: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/SongsArea.jsx frontend/src/components/admin/QueueRail.jsx frontend/src/components/admin/SongQueueList.jsx frontend/src/components/admin/Dashboard.jsx frontend/src/styles/components.css
git commit -F <scratchpad-msg>   # "feat(triage-3b): Featured admin scope + badge + quick Unfeature + dashboard tile"
```

---

### Task 3: Live smoke

**Files:** none. Backend restarted (or temp :5001); frontend running; admin password to hand.

- [ ] **Step 1: Count + scope** — the **Featured** rail item and Dashboard **Featured (N)** tile show the
  featured count; opening the scope lists exactly the featured songs (feature 2–3 first via the workbench
  or API).
- [ ] **Step 2: Quick Unfeature** — click a row's **Unfeature** → it disappears from the list, the count
  drops, and it's gone from the homepage Featured section.
- [ ] **Step 3: Badge** — a featured song shows the **Featured** badge in the Live/All scopes too.
- [ ] **Step 4: Restore** any featured state you changed to the curator's intended set. Record the result.

---

### Task 4: Docs + finish

**Files:** `docs/PROJECT_STATE.md`, `docs/CURATOR_TRIAGE_BACKLOG.md`

- [ ] **Step 1: PROJECT_STATE.md** — Decision Log + Changelog entry (2026-07-21): Featured management view
  (admin `featured` scope + count + badge + quick Unfeature reusing `/unfeature`; Dashboard tile);
  curator-chosen unfeature-only. Advance Current/Next session.
- [ ] **Step 2: CURATOR_TRIAGE_BACKLOG.md** — add a note under the resolved Featured section that a
  follow-up management view was added (triage 3b).
- [ ] **Step 3: Commit docs**, then invoke `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:** featured scope (queueWhere + QUEUE_NAMES + count) → Task 1; row `featured` field → Task 1;
rail item → Task 2 Step 2; badge → Task 2 Step 3; quick Unfeature (reuse route) → Task 2 Step 3; Dashboard
tile → Task 2 Step 4; backend test → Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact edit; `<scratchpad-msg>` is the executor's commit-message file. ✓

**Type consistency:** `listCurationQueue` row gains `featured` (SELECT + `mapQueueRow`), consumed as `row.featured` in the badge + Unfeature guard and asserted in the test; `queueCounts().featured` consumed by the rail (`counts.featured`) and Dashboard tile and asserted in the test; `'featured'` queue key is consistent across `queueWhere`/`QUEUE_NAMES`/`queueCounts`/`SELECTABLE_QUEUES`/`QUEUE_LABELS`/rail/tile. ✓
