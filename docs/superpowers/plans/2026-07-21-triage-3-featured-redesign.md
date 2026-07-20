# Triage 3 — featured-songs redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the curator control of the homepage Featured section — a deterministic recency fill (not random-from-catalogue) with random cycling of a large pin set, a restored "set featured" toggle in the workbench, and a dropped inconsistent card date.

**Architecture:** Backend: the `/songs/featured` fill becomes recency-ordered and the pinned query cycles a random 4 when over-pinned; a `curation.setFeatured` service + `POST /songs/:id/feature|unfeature` routes (mirroring publish/unpublish) restore write access; `getWorkbench` returns `featured`. Frontend: a toggle in `WorkbenchTopBar` drives those routes via the existing `doAction`, and `SongCard` drops the date line.

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`), `node:test`; React/Vite frontend (live-smoke verified).

## Global Constraints

- Restart the backend fresh before smoke (launcher runs plain `node server.js`, no reload). Run temp scripts from the scratchpad, not `backend/`.
- Backend tests: `cd backend && npm test` (DB running). `curation.test.js` uses the `ZZZCUR` fixture sentinel — new fixtures MUST keep that prefix (per-file-sentinel rule).
- Display-only truth-source safety: the featured display query keeps gating on `status='included' AND published=true`; `setFeatured` only writes the `featured` flag (curator-owned display metadata), never curatorial state.
- Commit messages end with the required co-author + session trailer; use `git commit -F <scratchpad-file>` (here-string hazard). Branch: `session-triage-3-featured` (spec already committed there).

---

### Task 1: Deterministic fill + pin cycling in `GET /songs/featured`

**Files:**
- Modify: `backend/routes/spotify.js:119-203`

**Interfaces:**
- Consumes/produces: same route + response shape (`res.json(featuredSongs)`); only ordering changes.

- [ ] **Step 1: Cycle the pinned set (random 4 when over-pinned)**

In the pinned query (`spotify.js` ~line 145), change the ordering so an over-pinned set cycles:

```sql
      WHERE s.featured = true AND s.status = 'included' AND s.published = true
      GROUP BY s.id, s.spotify_id, s.title, s.duration_ms, s.popularity, s.spotify_url,
               s.playlist_added_at, s.energy, s.danceability, s.valence, s.tempo, s.custom_mood,
               al.name, al.release_date, al.images
      ORDER BY RANDOM()
      LIMIT $1
```

(Only the `ORDER BY s.playlist_added_at DESC` line becomes `ORDER BY RANDOM()`.) With > 4 pins this returns a random 4 per load; with ≤ 4 it returns all of them.

- [ ] **Step 2: Recency fill instead of random**

In the fill query (~line 184), change `ORDER BY RANDOM()` to recency:

```sql
        GROUP BY s.id, s.spotify_id, s.title, s.duration_ms, s.popularity, s.spotify_url,
                 s.playlist_added_at, s.energy, s.danceability, s.valence, s.tempo, s.custom_mood,
                 al.name, al.release_date, al.images
        ORDER BY COALESCE(s.playlist_added_at, s.date_added) DESC NULLS LAST
        LIMIT $${queryParams.length + 1}
```

- [ ] **Step 3: Remove the DEBUG logs**

Delete the `console.log('DEBUG: …')` lines in this handler (the "Looking for featured", "Pinned songs found/Pinned songs", and "Final response" logs at ~128, 149-150, 194). Keep the `console.error` in the catch.

- [ ] **Step 4: Verify behaviour (backend restarted)**

Restart the backend. With the current DB (~2 pins), the fill is now the most-recently-added:

Run:
```
curl -s "http://localhost:5000/api/spotify/songs/featured?limit=4" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('count',j.length);console.log(j.map(s=>s.title))})"
```
Expected: 4 songs; running it twice with ≤4 pins returns a **stable** fill (recency, not random churn). (Pin-cycling with >4 pins is exercised in Task 4 after the toggle exists.)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/spotify.js
git commit -F <scratchpad-msg>   # "feat(triage-3): featured fill by recency + cycle an over-pinned set"
```

---

### Task 2: `setFeatured` service + feature/unfeature routes + workbench field (TDD)

**Files:**
- Modify: `backend/services/curation.js` (add `setFeatured`, export it, add `featured` to `getWorkbench`)
- Modify: `backend/routes/admin.js` (add two routes after the unpublish route, ~line 1726)
- Modify: `backend/test/curation.test.js` (add a test before the `after()` hook)

**Interfaces:**
- Produces: `curation.setFeatured(db, id, boolean) → { id, title, featured }` (throws `NOT_FOUND`); `POST /api/admin/songs/:id/feature` and `/unfeature`; `getWorkbench(...).featured: boolean`.

- [ ] **Step 1: Write the failing test**

In `backend/test/curation.test.js`, before the `after(...)` cleanup hook, add:

```js
test('setFeatured toggles the featured flag and 404s on a missing song', async () => {
  const id = await mkSong({ title: 'ZZZCUR Featurable', status: 'included', published: true });
  const on = await curation.setFeatured(pool, id, true);
  assert.equal(on.featured, true);
  assert.equal(on.id, id);
  const off = await curation.setFeatured(pool, id, false);
  assert.equal(off.featured, false);
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.featured, false);
  await assert.rejects(curation.setFeatured(pool, 999999999, true), e => e.code === 'NOT_FOUND');
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd backend && npx node --test --test-name-pattern="setFeatured toggles"`
Expected: FAIL — `curation.setFeatured is not a function`.

- [ ] **Step 3: Implement `setFeatured` + export + workbench field**

In `backend/services/curation.js`, add the function (near `saveHighlights`/`saveLinks`):

```js
async function setFeatured(db, id, featured) {
  await assertSong(db, id);
  const r = await db.query(
    `UPDATE songs SET featured=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1
     RETURNING id, title, featured`, [id, !!featured]);
  return r.rows[0];
}
```

Add `featured: s.featured` to the object returned by `getWorkbench` (the `s.*` select already includes it) — e.g. on the line with `status: s.status, published: s.published,`:

```js
    id: s.id, title: s.title, status: s.status, published: s.published, featured: s.featured, language: s.language,
```

Add `setFeatured` to `module.exports` (the list ending `…setCover, quickCapture }`):

```js
  saveDetails, saveLyrics, saveHighlights, saveLinks, setCover, quickCapture, setFeatured };
```

- [ ] **Step 4: Add the routes**

In `backend/routes/admin.js`, after the `/songs/:id/unpublish` route (~line 1726), add:

```js
router.post('/songs/:id/feature', async (req, res) => {
  try {
    const song = await curation.setFeatured(pool, parseInt(req.params.id), true);
    res.json({ success: true, song, message: `Featured: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('feature error:', e);
    res.status(500).json({ error: 'Failed to feature song', details: e.message });
  }
});

router.post('/songs/:id/unfeature', async (req, res) => {
  try {
    const song = await curation.setFeatured(pool, parseInt(req.params.id), false);
    res.json({ success: true, song, message: `Unfeatured: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('unfeature error:', e);
    res.status(500).json({ error: 'Failed to unfeature song', details: e.message });
  }
});
```

Confirm `curation` is already required in `admin.js` (it is — used by the workbench routes).

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass, including the new `setFeatured` test.

- [ ] **Step 6: Commit**

```bash
git add backend/services/curation.js backend/routes/admin.js backend/test/curation.test.js
git commit -F <scratchpad-msg>   # "feat(triage-3): setFeatured service + feature/unfeature routes + workbench field"
```

---

### Task 3: Workbench toggle + drop the card date (frontend)

**Files:**
- Modify: `frontend/src/components/admin/Workbench.jsx` (doAction map)
- Modify: `frontend/src/components/admin/WorkbenchTopBar.jsx` (toggle button)
- Modify: `frontend/src/components/SongCard.jsx` (remove date)

**Interfaces:**
- Consumes: `POST /songs/:id/feature|unfeature` (Task 2), `wb.featured` (Task 2).

- [ ] **Step 1: Map feature/unfeature actions**

In `Workbench.jsx`, add two entries to the `doAction` `map`:

```js
    const map = {
      'include': ['include', { publish: false }],
      'include-publish': ['include', { publish: true }],
      'reject': ['reject', undefined],
      'publish': ['publish', undefined],
      'unpublish': ['unpublish', undefined],
      'feature': ['feature', undefined],
      'unfeature': ['unfeature', undefined],
    };
```

- [ ] **Step 2: Add the Featured toggle to the top bar**

In `WorkbenchTopBar.jsx`, in the second `wb-decisions-row`, after the publish/unpublish buttons (after the line with `onClick={() => onAction('unpublish')}`), add:

```jsx
        {isIncluded && (
          <button
            className={`btn btn-sm ${wb.featured ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onAction(wb.featured ? 'unfeature' : 'feature')}
            title={wb.published ? 'Feature on the homepage' : 'Featured only appears once the song is published'}
          >
            {wb.featured ? 'Featured' : 'Feature'}
          </button>
        )}
```

- [ ] **Step 3: Drop the date line from `SongCard`**

In `SongCard.jsx`, remove the added-date span from the `song-meta` block:

```jsx
        <div className="song-meta">
          <span className="song-year">
            {song.release_date ? new Date(song.release_date).getFullYear() : 'Unknown'}
          </span>
          <span className="song-duration">{formatDuration(song.duration_ms)}</span>
        </div>
```

Then delete the now-unused `formatPlaylistAddDate` helper (the whole `const formatPlaylistAddDate = …` block). Leave `MoodBadge` and everything else unchanged.

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds (no unused-var/import errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/Workbench.jsx frontend/src/components/admin/WorkbenchTopBar.jsx frontend/src/components/SongCard.jsx
git commit -F <scratchpad-msg>   # "feat(triage-3): workbench Featured toggle + drop card date"
```

---

### Task 4: Live smoke

**Files:** none. Backend restarted fresh; frontend running. Admin password to hand for the workbench.

- [ ] **Step 1: Toggle featured from the workbench**

Open a published (live) song's workbench. Click **Feature** → button flips to "Featured" after reload; reopen the page → still Featured. Confirm the homepage Featured section shows that song **leading**.

- [ ] **Step 2: Over-pin → random cycle**

Feature ≥ 5 published songs. Load the homepage several times → the Featured four are always drawn from the pinned set and **reshuffle across reloads**.

- [ ] **Step 3: Under-pin → stable recency fill**

Unfeature down to ≤ 3 pins. Homepage Featured = pins first, remaining slots the **most-recently-added** songs, **stable** across reloads (no random churn).

- [ ] **Step 4: Card date gone; mood chip intact**

On homepage + browse + an artist page: cards show **no added-date**; the mood chip still appears only on songs that have a mood.

- [ ] **Step 5: Record the smoke result.**

---

### Task 5: Docs + finish

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `docs/CURATOR_TRIAGE_BACKLOG.md`

- [ ] **Step 1: PROJECT_STATE.md** — Decision Log entry (2026-07-21): featured model (pins→cycle-4-when->4, else recency fill), restored workbench toggle (`setFeatured` + feature/unfeature routes), card date dropped, mood chip kept. Advance Current/Next session + Changelog + reprioritised-order status (item 3 done).

- [ ] **Step 2: CURATOR_TRIAGE_BACKLOG.md** — move the three "Featured songs" bullets to ✅ Resolved (featured model + toggle; date dropped; mood kept-by-decision).

- [ ] **Step 3: PROJECT_PLAN.md** — mark triage item 3 done.

- [ ] **Step 4: Commit docs.**

```bash
git add docs/PROJECT_STATE.md docs/PROJECT_PLAN.md docs/CURATOR_TRIAGE_BACKLOG.md
git commit -F <scratchpad-msg>   # "docs(triage-3): record featured redesign"
```

- [ ] **Step 5: Finish the branch** — invoke `superpowers:finishing-a-development-branch` (verify backend tests + frontend build, then present merge options).

---

## Self-Review

**Spec coverage:**
- Featured model: ≥4 pins → random 4 (Task 1 Step 1); <4 → pins + recency fill (Task 1 Step 2). ✓
- Restore set-featured: `setFeatured` service + feature/unfeature routes + workbench field (Task 2) + top-bar toggle (Task 3). ✓
- Mood chip kept: no code change; documented in Task 5. ✓
- Drop card date: Task 3 Step 3. ✓
- Backend test: Task 2 Step 1. ✓
- Verification: Task 1 Step 4 (curl), Task 2 Step 5 (npm test), Task 4 (live smoke). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact edit. `<scratchpad-msg>` is the executor's scratchpad commit-message file. ✓

**Type consistency:** `setFeatured(db, id, boolean) → { id, title, featured }` — used by both routes (`song.title`, `song.featured`) and the test (`.featured`, `.id`). `getWorkbench().featured` consumed by `WorkbenchTopBar` (`wb.featured`) and asserted in the test. `doAction('feature'|'unfeature')` maps to the route paths. ✓
