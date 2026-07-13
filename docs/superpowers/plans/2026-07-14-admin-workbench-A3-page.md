# Admin Workbench — A3: The Workbench Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the A2 stub at `/admin/song/:id` with the full Curation Workbench — one two-column screen for processing and editing a song (details, lyrics + highlights, video, links, analysis, notes) with autosave-on-blur, lifecycle decision buttons, and within-page Prev/Next.

**Architecture:** A container component (`Workbench.jsx`) fetches the single assemble-read `GET /workbench/:id` into state, renders a sticky top bar plus a two-column panel grid, and exposes save helpers. Panel PUTs return the reassembled workbench (state is swapped directly); video/lifecycle routes return partials, so the container re-fetches after them. Each autosaving text field is a self-contained `AutoText` (blur → PUT → per-field status). No backend changes — A1 shipped every endpoint.

**Tech Stack:** React 19 + React Router v7 (Vite), Node/Express, PostgreSQL. Admin fetches go through `adminFetch` (`src/api/adminApi.js`) — relative `/api` URLs via the Vite proxy + `X-Admin-Password`. Styling uses the Phase-3 design tokens in `frontend/src/styles/admin.css`.

**Spec:** [`docs/superpowers/specs/2026-07-14-admin-workbench-A3-page-design.md`](../specs/2026-07-14-admin-workbench-A3-page-design.md).

## Global Constraints

- **Branch:** work on `session-A3-workbench` (not `main`). End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Windows/PowerShell:** run git from the repo root; for multi-line commit messages write the message to a scratchpad file and use `git commit -F <file>` (long here-strings fail to parse in PS 5.1). Never do whole-file PowerShell rewrites of files containing non-ASCII glyphs — use the Edit tool per hunk, then `grep -nP '[^\x00-\x7F]'` the file to confirm no mojibake.
- **No frontend unit-test harness exists** (this repo has only backend `node:test`). Frontend tasks are verified by `cd frontend && npm run build` (must succeed) + `npx eslint src/` (0 new errors) + a concrete render/interaction check against a running backend (`cd backend && npm run dev`) + Vite dev server (`cd frontend && npm run dev`). **A3 has NO backend changes**, so `node --test` must stay green as-is (regression check only).
- **`adminFetch` only** for admin API calls — never hardcode `localhost:5000` or the password header. It returns a raw `fetch` Response; call `.json()` yourself.
- **Design tokens only** for new CSS (already used across `admin.css`): backgrounds `--bg-canvas`/`--bg-surface`/`--bg-surface-raised`/`--bg-overlay`; text `--text-primary`/`--text-secondary`/`--text-muted`/`--text-on-accent`; borders `--border-hairline`/`--border-strong`; accents `--accent-ember-60`/`--accent-ember-40`/`--accent-moss-60`; `--focus-ring`, `--color-danger`, `--color-warning`; spacing `--space-1..9`; radii `--radius-sm/md/lg/pill`; shadows `--shadow-card/raised`. Reuse component classes `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-sm`, `.input`/`.input-pill`, `.select`, `.tag`/`.tag-ember`/`.tag-moss`, `.modal-backdrop`/`.modal-card`. **No emoji, no raw hex colors, no gradients** (brand voice). Completeness/status use text labels styled by CSS class, never emoji or ✓/✗ glyphs.
- **Admin-only + copyright:** the workbench read returns full `lyrics` + `translation` (local-only, copyright). This is fine on the admin path; **never** add these fields to a public route. Do not weaken A1's `backend/test/lyrics_privacy.test.js`.
- **A1 API shapes consumed (do NOT change any backend file):**
  - `GET /api/admin/workbench/:id` → the **workbench object** (see below). `404 {error}` if missing.
  - `PUT /api/admin/workbench/:id/{details,lyrics,highlights,links,cover}` → `{ success:true, workbench }` (the full reassembled object). `400 {error}` on bad input, `404` if missing.
  - `PUT /api/admin/workbench/:id/processing` body `{ snooze_until?, park_reason?, lyrics_tried?, processing_note? }` → `{ success:true, processing }` (partial — the processing row only).
  - `POST /api/admin/workbench/:id/videos` body `{ youtube_id, video_title?, video_type?, is_primary? }` → `{ success:true, video }`.
  - `PUT /api/admin/workbench/videos/:videoId` body `{ video_title?, video_type? }` → `{ success:true, video }`.
  - `PUT /api/admin/workbench/videos/:videoId/primary` → `{ success:true, video }`.
  - `DELETE /api/admin/workbench/videos/:videoId` → `{ success:true, deleted:true, song_id }`.
  - Lifecycle (reused): `POST /api/admin/songs/:id/include` body `{ publish?:boolean }` → `{ success, song, message }`; `POST /api/admin/songs/:id/reject` → `{ success, song }`; `POST /api/admin/songs/:id/publish` → `{ success, song }` (409 if not `included`); `POST /api/admin/songs/:id/unpublish` → `{ success, song }`; `POST /api/admin/songs/:id/attach-spotify` → `{ success, ... }`.
- **The workbench object shape** (returned by GET and inside `{workbench}`):
  ```js
  {
    id, title, status,            // status: 'pending' | 'included' | 'rejected'
    published,                    // boolean
    language,                     // string | null
    spotify_id, spotify_url, bandcamp_url, soundcloud_url,   // string | null
    lyrics_status,                // 'found' | 'not_found' | 'not_searched' | null
    lyrics_url, lyrics_source, lyrics_highlights, status_notes, // string | null
    album: { name, images, release_date },   // images: JSON array (objects with .url) or null
    artists: [{ id, name, website_url }],
    videos: [{ id, youtube_id, video_title, video_type, is_primary }],
    lyrics,                       // full lyrics text | null  (local-only)
    lyrics_source_url,            // string | null
    translation,                  // string | null            (local-only)
    processing: { song_id, snooze_until, park_reason, lyrics_tried, processing_note },
    analysed,                     // boolean
    completeness: { lyrics, cover, video, play_link, analysis }  // all boolean
  }
  ```
  **Note:** there is no `duration` or numeric `year` field — the Details panel shows `album.release_date` as-is and never invents a duration.
- **Controlled vocabularies:** `video_type ∈ ['official','live','lyric','fan-made','other']`; `park_reason ∈ ['awaiting_community','needs_transcription','listened_unclear']`; `lyrics_status ∈ ['found','not_found','not_searched']`; lyrics-avenue keys `['google','genius','bandcamp','youtube','genre_site']`.

---

### Task 1: Workbench container + shared field primitives + route swap

**Files:**
- Create: `frontend/src/components/admin/SavedField.jsx` (exports `SaveTag`, `AutoText`)
- Create: `frontend/src/components/admin/Workbench.jsx`
- Modify: `frontend/src/App.jsx` (swap `WorkbenchStub` → `Workbench`)
- Modify: `frontend/src/styles/admin.css` (append workbench styles)

**Interfaces:**
- Produces (consumed by later tasks):
  - `SaveTag({ status })` — `status ∈ 'idle'|'saving'|'saved'|'error'`; renders a small inline indicator (empty when idle).
  - `AutoText({ label, initial, onSave, multiline?, rows?, placeholder?, monospace? })` — a self-contained autosaving field. Holds local value seeded from `initial` (re-seeds when `initial` changes), calls `onSave(value)` on blur **only if changed**; `onSave` returns `{ ok:boolean, error?:string }`; shows a `SaveTag`. Renders `<input class="input">` or `<textarea class="input">`.
  - `Workbench` renders the top bar region + a two-column `.wb-grid`. In this task the top bar is a **minimal inline header** (title, artists, a Back link); Task 2 replaces it with `WorkbenchTopBar`. The two columns are empty placeholders (`<div className="wb-col wb-col-main">`/`<div className="wb-col wb-col-side">`) that Tasks 3–7 fill.
  - Container helpers passed to panels (Tasks 3–7 rely on these names/signatures):
    - `savePanel(panel, body) => Promise<{ok, error?}>` — PUTs `/workbench/:id/${panel}`, and on success swaps `wb` from `d.workbench`.
    - `saveProcessing(body) => Promise<{ok, error?}>` — PUTs `/workbench/:id/processing`, merges `d.processing` into `wb.processing` on success.
    - `reload() => void` — re-fetches `GET /workbench/:id` into `wb`.
    - `wb` (the object above) and `id` (string route param).

- [ ] **Step 1: Write `SavedField.jsx`**

```jsx
import { useEffect, useState } from 'react';

export function SaveTag({ status }) {
  if (!status || status === 'idle') return null;
  const text = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  return <span className={`wb-save wb-save-${status}`}>{text}</span>;
}

// Self-contained autosaving text field. onSave(value) → { ok, error? }.
export function AutoText({ label, initial, onSave, multiline = false, rows = 3, placeholder, monospace = false }) {
  const [val, setVal] = useState(initial ?? '');
  const [status, setStatus] = useState('idle');

  // Re-seed when the upstream value changes (e.g. after a full-workbench swap).
  useEffect(() => { setVal(initial ?? ''); setStatus('idle'); }, [initial]);

  const commit = async () => {
    if ((val ?? '') === (initial ?? '')) return; // unchanged — no request
    setStatus('saving');
    const res = await onSave(val);
    setStatus(res && res.ok ? 'saved' : 'error');
  };

  const common = {
    className: `input${monospace ? ' wb-mono' : ''}`,
    value: val,
    placeholder,
    onChange: (e) => { setVal(e.target.value); if (status !== 'idle') setStatus('idle'); },
    onBlur: commit,
    style: { width: '100%' },
  };

  return (
    <label className="wb-field">
      <span className="wb-field-label">{label} <SaveTag status={status} /></span>
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
    </label>
  );
}
```

- [ ] **Step 2: Write `Workbench.jsx` (container with minimal header + empty columns)**

```jsx
import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

function Workbench() {
  const { id } = useParams();
  const [wb, setWb] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const reload = useCallback(() => {
    adminFetch(`/api/admin/workbench/${id}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d) => { if (d) { setWb(d); setNotFound(false); } })
      .catch(() => {});
  }, [id]);

  useEffect(() => { setWb(null); setNotFound(false); reload(); }, [reload]);

  const savePanel = useCallback(async (panel, body) => {
    try {
      const r = await adminFetch(`/api/admin/workbench/${id}/${panel}`, { method: 'PUT', body });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.workbench) { setWb(d.workbench); return { ok: true }; }
      return { ok: false, error: d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  }, [id]);

  const saveProcessing = useCallback(async (body) => {
    try {
      const r = await adminFetch(`/api/admin/workbench/${id}/processing`, { method: 'PUT', body });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.processing) { setWb((w) => (w ? { ...w, processing: d.processing } : w)); return { ok: true }; }
      return { ok: false, error: d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  }, [id]);

  if (notFound) {
    return (
      <div>
        <Link to="/admin/songs" className="btn btn-ghost btn-sm">&larr; Back to Songs</Link>
        <h1>Song not found</h1>
        <p className="admin-stub">No song with id {id}.</p>
      </div>
    );
  }
  if (!wb) return <div className="queue-empty">Loading…</div>;

  const artistNames = (wb.artists || []).map((a) => a.name).join(', ') || '—';

  return (
    <div className="workbench">
      <div className="wb-topbar">
        <Link to="/admin/songs" className="btn btn-ghost btn-sm">&larr; Back to Songs</Link>
        <h1 className="wb-title">{wb.title || `Song ${wb.id}`}</h1>
        <div className="wb-artist">{artistNames}</div>
      </div>
      <div className="wb-grid">
        <div className="wb-col wb-col-main">{/* Lyrics panel — Task 4/5 */}</div>
        <div className="wb-col wb-col-side">{/* Details/Video/Links/Analysis/Notes — Tasks 3,6,7 */}</div>
      </div>
    </div>
  );
}
export default Workbench;
```

- [ ] **Step 3: Wire the route in `App.jsx`**

Replace the stub import and the route element:
```jsx
// remove: import WorkbenchStub from './components/admin/WorkbenchStub';
import Workbench from './components/admin/Workbench';
```
```jsx
// was: <Route path="song/:id" element={<WorkbenchStub />} />
<Route path="song/:id" element={<Workbench />} />
```
(Leave `WorkbenchStub.jsx` on disk for now; Task 8 deletes it along with the other dead files. Nothing imports it after this change.)

- [ ] **Step 4: Append base workbench CSS to `admin.css`**

```css
/* Curation Workbench — A3 */
.workbench { max-width: 1200px; }
.wb-topbar { position: sticky; top: 0; z-index: 10; background: var(--bg-surface); border-bottom: 1px solid var(--border-hairline); padding: var(--space-3) var(--space-4); margin: calc(-1 * var(--space-5)) calc(-1 * var(--space-5)) var(--space-4); }
.wb-title { font-size: 1.15rem; margin: var(--space-2) 0 0; }
.wb-artist { color: var(--text-muted); font-size: 0.9rem; }
.wb-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--space-5); align-items: start; }
@media (max-width: 900px) { .wb-grid { grid-template-columns: 1fr; } }
.wb-col { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.wb-panel { background: var(--bg-surface); border: 1px solid var(--border-hairline); border-radius: var(--radius-lg); padding: var(--space-4); }
.wb-panel h2 { font-size: 0.95rem; margin: 0 0 var(--space-3); }
.wb-field { display: block; margin-bottom: var(--space-3); }
.wb-field-label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: var(--space-1); }
.wb-mono { font-family: ui-monospace, monospace; font-size: 0.85rem; }
.wb-readonly { font-size: 0.9rem; color: var(--text-primary); }
.wb-readonly .k { color: var(--text-muted); margin-right: var(--space-2); }
.wb-save { font-size: 0.72rem; margin-left: var(--space-2); }
.wb-save-saving { color: var(--text-muted); }
.wb-save-saved { color: var(--accent-moss-60); }
.wb-save-error { color: var(--color-danger); }
```

- [ ] **Step 5: Build + lint**

Run: `cd frontend && npm run build` → Expected: succeeds. Then `npx eslint src/` → Expected: 0 errors (13 pre-existing `react-hooks/exhaustive-deps` warnings elsewhere are OK; add none).

- [ ] **Step 6: Verify render (backend + dev server running)**

Log in at `/admin`, open Songs → click any row (or visit `/admin/song/<a-real-id>` directly). Expected: the page shows the song title + artist(s), a "Back to Songs" link (returns to the list), and an empty two-column area. Visit `/admin/song/999999` → Expected: "Song not found". Confirm no console errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/SavedField.jsx frontend/src/components/admin/Workbench.jsx frontend/src/App.jsx frontend/src/styles/admin.css
git commit -F <scratchpad-msg-file>
```
Message: `feat(A3): workbench container + autosave field primitive + route`

---

### Task 2: Top bar — badges, completeness, decision buttons

**Files:**
- Create: `frontend/src/components/admin/WorkbenchTopBar.jsx`
- Modify: `frontend/src/components/admin/Workbench.jsx` (use the top bar; add a `doAction` helper)
- Modify: `frontend/src/styles/admin.css` (top-bar styles)

**Interfaces:**
- Consumes: `wb`, `reload`, `saveProcessing` from Task 1.
- Produces: `WorkbenchTopBar({ wb, onAction, onPark, nav })`.
  - `onAction(kind)` where `kind ∈ 'include'|'include-publish'|'reject'|'publish'|'unpublish'` — performs the lifecycle POST then `reload()`.
  - `onPark({ park_reason?, snooze_until? })` — calls `saveProcessing`.
  - `nav` — optional `{ hasPrev, hasNext, onPrev, onNext }`; **when absent or falsy, Prev/Next render nothing** (Task 8 supplies it). Render the `nav` buttons at the right of the identity row.

- [ ] **Step 1: Add the `doAction` helper to `Workbench.jsx`**

Inside `Workbench`, after `saveProcessing`:
```jsx
const doAction = useCallback(async (kind) => {
  if (kind === 'reject' && !window.confirm('Reject this song? It stays recoverable, but this clears the include decision.')) return;
  const map = {
    'include': ['include', { publish: false }],
    'include-publish': ['include', { publish: true }],
    'reject': ['reject', undefined],
    'publish': ['publish', undefined],
    'unpublish': ['unpublish', undefined],
  };
  const [path, body] = map[kind];
  try {
    const r = await adminFetch(`/api/admin/songs/${id}/${path}`, { method: 'POST', body });
    if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error || 'Action failed'); return; }
    reload();
  } catch { window.alert('Request failed'); }
}, [id, reload]);
```

- [ ] **Step 2: Write `WorkbenchTopBar.jsx`**

```jsx
const PARK_REASONS = [
  ['awaiting_community', 'Awaiting community'],
  ['needs_transcription', 'Needs transcription'],
  ['listened_unclear', 'Listened — unclear'],
];
const COMPLETE_ITEMS = [
  ['lyrics', 'Lyrics'], ['cover', 'Cover'], ['video', 'Video'],
  ['play_link', 'Play link'], ['analysis', 'Analysis'],
];

function StatusBadges({ wb }) {
  const live = wb.status === 'included' && wb.published;
  return (
    <span className="wb-badges">
      <span className={`queue-status ${live ? 'live' : wb.status}`}>{live ? 'live' : wb.status}</span>
      {wb.status === 'included' && !wb.published && <span className="wb-badge-muted">unpublished</span>}
    </span>
  );
}

function Completeness({ c }) {
  return (
    <span className="wb-complete">
      {COMPLETE_ITEMS.map(([k, label]) => {
        const done = !!(c && c[k]);
        const analysisPending = k === 'analysis' && !done;
        return (
          <span key={k} className={`wb-complete-item ${done ? 'done' : 'todo'}`}>
            {label}{analysisPending ? ' pending' : ''}
          </span>
        );
      })}
    </span>
  );
}

function WorkbenchTopBar({ wb, onAction, onPark, nav }) {
  const isPending = wb.status === 'pending';
  const isIncluded = wb.status === 'included';
  return (
    <div className="wb-decisions">
      <div className="wb-decisions-row">
        <StatusBadges wb={wb} />
        <Completeness c={wb.completeness} />
        {nav && (
          <span className="wb-nav">
            <button className="btn btn-secondary btn-sm" disabled={!nav.hasPrev} onClick={nav.onPrev}>&lsaquo; Prev</button>
            <button className="btn btn-secondary btn-sm" disabled={!nav.hasNext} onClick={nav.onNext}>Next &rsaquo;</button>
          </span>
        )}
      </div>
      <div className="wb-decisions-row">
        {isPending && <>
          <button className="btn btn-primary btn-sm" onClick={() => onAction('include')}>Include</button>
          <button className="btn btn-primary btn-sm" onClick={() => onAction('include-publish')}>Include &amp; publish</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onAction('reject')}>Reject</button>
          <select className="select" defaultValue="" onChange={(e) => { if (e.target.value) { onPark({ park_reason: e.target.value }); e.target.value = ''; } }}>
            <option value="">Park…</option>
            {PARK_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="input" type="date" title="Remind me later"
            onChange={(e) => { if (e.target.value) onPark({ snooze_until: e.target.value }); }} style={{ width: 150 }} />
        </>}
        {isIncluded && !wb.published && <button className="btn btn-primary btn-sm" onClick={() => onAction('publish')}>Publish</button>}
        {isIncluded && wb.published && <button className="btn btn-secondary btn-sm" onClick={() => onAction('unpublish')}>Unpublish</button>}
        {wb.status === 'rejected' && <button className="btn btn-primary btn-sm" onClick={() => onAction('include')}>Re-include</button>}
      </div>
    </div>
  );
}
export default WorkbenchTopBar;
```

- [ ] **Step 3: Render the top bar in `Workbench.jsx`**

Add `import WorkbenchTopBar from './WorkbenchTopBar';`. In the `.wb-topbar` block, below the title/artist, add:
```jsx
<WorkbenchTopBar wb={wb} onAction={doAction} onPark={saveProcessing} nav={null} />
```
(`nav={null}` for now — Task 8 replaces it.)

- [ ] **Step 4: Append top-bar CSS to `admin.css`**

```css
.wb-decisions { margin-top: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
.wb-decisions-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.wb-badges { display: inline-flex; gap: var(--space-2); align-items: center; }
.wb-badge-muted { font-size: 0.68rem; color: var(--text-muted); border: 1px solid var(--border-hairline); border-radius: var(--radius-pill); padding: 1px var(--space-2); }
.wb-complete { display: inline-flex; gap: var(--space-1); flex-wrap: wrap; }
.wb-complete-item { font-size: 0.68rem; padding: 1px var(--space-2); border-radius: var(--radius-pill); border: 1px solid var(--border-hairline); }
.wb-complete-item.done { color: var(--accent-moss-60); border-color: var(--accent-moss-60); }
.wb-complete-item.todo { color: var(--text-muted); }
.wb-nav { margin-left: auto; display: inline-flex; gap: var(--space-2); }
```

- [ ] **Step 5: Build + lint** — `cd frontend && npm run build` (succeeds), `npx eslint src/` (0 errors).

- [ ] **Step 6: Verify (backend + dev server)**

Open a **pending** song: see status badge `pending`, a completeness row, and buttons Include / Include & publish / Reject / Park… / date. Click **Include** → badge flips to `included` + `unpublished`, buttons become **Publish**. Click **Publish** → badge `live`, button **Unpublish**. Click **Reject** on a pending song → confirm dialog appears; cancel leaves it unchanged. Pick a Park reason → no error (verify later in Notes panel). Confirm no console errors and that completeness labels reflect the data.

- [ ] **Step 7: Commit** — `feat(A3): workbench top bar — badges, completeness, lifecycle actions`

---

### Task 3: Details panel (title + language autosave, read-only meta, cover paste)

**Files:**
- Create: `frontend/src/components/admin/DetailsPanel.jsx`
- Modify: `frontend/src/components/admin/Workbench.jsx` (mount in the side column)

**Interfaces:**
- Consumes: `wb`, `savePanel` from Task 1; `AutoText` from `SavedField`.
- Produces: `DetailsPanel({ wb, savePanel })`.

- [ ] **Step 1: Write `DetailsPanel.jsx`**

```jsx
import { AutoText } from './SavedField';

function coverUrl(images) {
  if (!images) return null;
  let arr = images;
  if (typeof images === 'string') { try { arr = JSON.parse(images); } catch { return null; } }
  return Array.isArray(arr) && arr[0] && arr[0].url ? arr[0].url : null;
}

function DetailsPanel({ wb, savePanel }) {
  const artistNames = (wb.artists || []).map((a) => a.name).join(', ') || '—';
  const cover = coverUrl(wb.album && wb.album.images);
  return (
    <section className="wb-panel">
      <h2>Details</h2>
      <AutoText label="Title" initial={wb.title} onSave={(v) => savePanel('details', { title: v })} />
      <AutoText label="Language sung in" initial={wb.language} placeholder="e.g. English"
        onSave={(v) => savePanel('details', { language: v })} />
      <div className="wb-readonly">
        <div><span className="k">Artist(s)</span>{artistNames}</div>
        <div><span className="k">Album</span>{(wb.album && wb.album.name) || '—'}</div>
        <div><span className="k">Released</span>{(wb.album && wb.album.release_date) || '—'}</div>
        <div><span className="k">Spotify id</span>{wb.spotify_id || '—'}</div>
      </div>
      <div className="wb-cover">
        {cover ? <img src={cover} alt="" className="wb-cover-img" /> : <span className="wb-cover-ph" />}
        <AutoText label="Cover image URL (paste)" initial={cover || ''} placeholder="https://…"
          onSave={(v) => savePanel('cover', { cover_url: v })} />
      </div>
    </section>
  );
}
export default DetailsPanel;
```
_Note: `cover` autosave sends `cover_url`; the backend rejects a blank/ non-http URL with 400, so `AutoText` shows "Save failed" if the field is cleared — acceptable (there is no "remove cover" in A1). Re-seeds to the saved cover after success._

- [ ] **Step 2: Mount in `Workbench.jsx`**

Add `import DetailsPanel from './DetailsPanel';`. In `.wb-col-side`:
```jsx
<DetailsPanel wb={wb} savePanel={savePanel} />
```

- [ ] **Step 3: Append cover CSS to `admin.css`**

```css
.wb-cover { margin-top: var(--space-3); }
.wb-cover-img { width: 120px; height: 120px; object-fit: cover; border-radius: var(--radius-md); display: block; margin-bottom: var(--space-2); }
.wb-cover-ph { display: block; width: 120px; height: 120px; border-radius: var(--radius-md); margin-bottom: var(--space-2); background-image: repeating-linear-gradient(45deg, var(--bg-surface-raised), var(--bg-surface-raised) 6px, var(--bg-surface) 6px, var(--bg-surface) 12px); }
```

- [ ] **Step 4: Build + lint** — build succeeds; `npx eslint src/` 0 errors.

- [ ] **Step 5: Verify**

Open a song. Edit **Title** → blur → "Saved" appears; reload the page → the new title persists. Edit **Language** → blur → persists. Confirm Artist/Album/Released/Spotify id show read-only. For a song with a cover, the image shows; paste a valid image URL into the cover field → blur → "Saved" and the image updates after the state swap. No console errors.

- [ ] **Step 6: Commit** — `feat(A3): workbench Details panel (title/language autosave, cover paste)`

---

### Task 4: Lyrics panel (paste, status, source, translation, avenues, quick-search)

**Files:**
- Create: `frontend/src/components/admin/LyricsPanel.jsx`
- Modify: `frontend/src/components/admin/Workbench.jsx` (mount in the main column)

**Interfaces:**
- Consumes: `wb`, `savePanel`, `saveProcessing` from Task 1; `AutoText`, `SaveTag` from `SavedField`.
- Produces: `LyricsPanel({ wb, savePanel, saveProcessing })`. Task 5 adds the highlights picker **inside this file**.

- [ ] **Step 1: Write `LyricsPanel.jsx`**

```jsx
import { useState } from 'react';
import { AutoText, SaveTag } from './SavedField';

const LYRICS_STATUSES = ['found', 'not_found', 'not_searched'];
const AVENUES = [['google', 'Google'], ['genius', 'Genius'], ['bandcamp', 'Bandcamp'], ['youtube', 'YouTube'], ['genre_site', 'Genre sites']];

function searchLinks(title, artist) {
  const q = encodeURIComponent(`${title || ''} ${artist || ''}`.trim());
  return [
    ['Google', `https://www.google.com/search?q=${q}%20lyrics`],
    ['Genius', `https://genius.com/search?q=${q}`],
    ['Bandcamp', `https://bandcamp.com/search?q=${q}`],
    ['YouTube', `https://www.youtube.com/results?search_query=${q}`],
  ];
}

function LyricsPanel({ wb, savePanel, saveProcessing }) {
  const artist = (wb.artists || []).map((a) => a.name).join(' ');
  const [statusSave, setStatusSave] = useState('idle');
  const tried = Array.isArray(wb.processing?.lyrics_tried) ? wb.processing.lyrics_tried : [];

  const onStatus = async (e) => {
    setStatusSave('saving');
    const res = await savePanel('lyrics', { lyrics_status: e.target.value });
    setStatusSave(res.ok ? 'saved' : 'error');
  };
  const toggleAvenue = (key) => {
    const next = tried.includes(key) ? tried.filter((k) => k !== key) : [...tried, key];
    saveProcessing({ lyrics_tried: next });
  };

  return (
    <section className="wb-panel">
      <h2>Lyrics</h2>

      <div className="wb-quicklinks">
        <span className="wb-field-label">Search for lyrics:</span>
        {searchLinks(wb.title, artist).map(([label, href]) => (
          <a key={label} className="btn btn-secondary btn-sm" href={href} target="_blank" rel="noreferrer">{label}</a>
        ))}
      </div>

      <AutoText label="Full lyrics (local-only)" initial={wb.lyrics} multiline rows={12} monospace
        onSave={(v) => savePanel('lyrics', { lyrics: v })} />
      <AutoText label="Lyrics source URL" initial={wb.lyrics_source_url} placeholder="https://…"
        onSave={(v) => savePanel('lyrics', { source_url: v })} />

      <label className="wb-field">
        <span className="wb-field-label">Lyrics status <SaveTag status={statusSave} /></span>
        <select className="select" value={wb.lyrics_status || 'not_searched'} onChange={onStatus}>
          {LYRICS_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </label>

      <div className="wb-field">
        <span className="wb-field-label">Avenues tried</span>
        <div className="wb-avenues">
          {AVENUES.map(([key, label]) => (
            <label key={key} className="wb-check">
              <input type="checkbox" checked={tried.includes(key)} onChange={() => toggleAvenue(key)} /> {label}
            </label>
          ))}
        </div>
      </div>

      <AutoText label="Translation (local-only)" initial={wb.translation} multiline rows={6}
        onSave={(v) => savePanel('lyrics', { translation: v })} />

      {/* Task 5 inserts the Highlights picker here */}
    </section>
  );
}
export default LyricsPanel;
```
_Note: A1's `saveLyrics` treats an empty `lyrics` value as **delete the row**; `translation`/`source_url` are only updatable when a lyrics row exists (they no-op otherwise). This matches the workflow (paste lyrics first, then translation)._

- [ ] **Step 2: Mount in `Workbench.jsx`**

Add `import LyricsPanel from './LyricsPanel';`. In `.wb-col-main`:
```jsx
<LyricsPanel wb={wb} savePanel={savePanel} saveProcessing={saveProcessing} />
```

- [ ] **Step 3: Append lyrics CSS to `admin.css`**

```css
.wb-quicklinks { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-3); }
.wb-avenues { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.wb-check { font-size: 0.85rem; color: var(--text-secondary); display: inline-flex; align-items: center; gap: var(--space-1); }
```

- [ ] **Step 4: Build + lint** — build succeeds; eslint 0 errors.

- [ ] **Step 5: Verify**

Open a song. Paste text into **Full lyrics** → blur → "Saved"; reload → lyrics persist (and the top-bar "Lyrics" completeness flips to done). Set **Lyrics status** → "Saved". Tick/untick **Avenues** → reload → selection persists. Type a **Translation** → blur → persists (only works once lyrics exist). Click a **Search** link → opens the query in a new tab. Clear the full-lyrics field entirely → blur → the lyrics row is deleted (completeness "Lyrics" → todo). No console errors.

- [ ] **Step 6: Commit** — `feat(A3): workbench Lyrics panel (paste, status, avenues, quick-search, translation)`

---

### Task 5: Highlights picker (interactive select-from-lyrics)

**Files:**
- Modify: `frontend/src/components/admin/LyricsPanel.jsx` (add the picker + capture the lyrics textarea selection)
- Modify: `frontend/src/styles/admin.css` (highlights styles)

**Interfaces:**
- Consumes: `savePanel('highlights', { lyrics_highlights })` — newline-joined string.
- The full-lyrics `<textarea>` must expose its current selection. Since `AutoText` owns that textarea internally, add a **dedicated ref** to the lyrics textarea by rendering it directly in this panel (replace the lyrics `AutoText` with a local autosaving textarea that also holds a ref), OR add an `inputRef` prop to `AutoText`. **Use the `inputRef` prop approach** (smaller change, keeps autosave logic in one place).

- [ ] **Step 1: Add an optional `inputRef` prop to `AutoText` in `SavedField.jsx`**

In `AutoText`, accept `inputRef` and attach it:
```jsx
export function AutoText({ label, initial, onSave, multiline = false, rows = 3, placeholder, monospace = false, inputRef }) {
```
and add `ref: inputRef` to `common`:
```jsx
  const common = {
    ref: inputRef,
    className: `input${monospace ? ' wb-mono' : ''}`,
    // …unchanged…
  };
```

- [ ] **Step 2: Add the picker to `LyricsPanel.jsx`**

At the top add `useRef`:
```jsx
import { useRef, useState } from 'react';
```
Inside the component, before `return`:
```jsx
const lyricsRef = useRef(null);
const highlights = (wb.lyrics_highlights || '').split('\n').map((h) => h.trim()).filter(Boolean);

const addHighlight = () => {
  const el = lyricsRef.current;
  if (!el) return;
  const sel = el.value.substring(el.selectionStart, el.selectionEnd).trim();
  if (!sel) { window.alert('Select a passage in the lyrics box first.'); return; }
  if (highlights.includes(sel)) return;
  savePanel('highlights', { lyrics_highlights: [...highlights, sel].join('\n') });
};
const removeHighlight = (h) => {
  savePanel('highlights', { lyrics_highlights: highlights.filter((x) => x !== h).join('\n') });
};
```
Pass the ref to the lyrics `AutoText`:
```jsx
<AutoText label="Full lyrics (local-only)" initial={wb.lyrics} multiline rows={12} monospace
  inputRef={lyricsRef} onSave={(v) => savePanel('lyrics', { lyrics: v })} />
```
Replace the `{/* Task 5 inserts the Highlights picker here */}` comment with:
```jsx
<div className="wb-field">
  <div className="wb-highlights-head">
    <span className="wb-field-label">Key lyrics (public highlights)</span>
    <button type="button" className="btn btn-secondary btn-sm" onClick={addHighlight}>+ Add selection</button>
  </div>
  {highlights.length === 0
    ? <p className="admin-stub">Select a line in the lyrics box above, then “Add selection”.</p>
    : <ul className="wb-highlights">
        {highlights.map((h) => (
          <li key={h}><span>{h}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeHighlight(h)}>Remove</button>
          </li>
        ))}
      </ul>}
</div>
```

- [ ] **Step 3: Append highlights CSS to `admin.css`**

```css
.wb-highlights-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
.wb-highlights { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.wb-highlights li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); background: var(--bg-surface-raised); border-radius: var(--radius-md); padding: var(--space-1) var(--space-2); font-size: 0.85rem; }
```

- [ ] **Step 4: Build + lint** — build succeeds; eslint 0 errors.

- [ ] **Step 5: Verify**

Open a song with lyrics. Select a line inside the full-lyrics box → click **+ Add selection** → the line appears in the "Key lyrics" list; reload → it persists (stored newline-joined in `lyrics_highlights`). Add a second. **Remove** one → it disappears and persists. With nothing selected, clicking Add shows the "select first" alert. No console errors.

- [ ] **Step 6: Commit** — `feat(A3): workbench highlights picker (select-from-lyrics)`

---

### Task 6: Video panel (list, add-by-URL, set primary, delete)

**Files:**
- Create: `frontend/src/components/admin/VideoPanel.jsx`
- Modify: `frontend/src/components/admin/Workbench.jsx` (mount in side column; pass `id` + `reload`)

**Interfaces:**
- Consumes: `wb.videos`, `id`, `reload` from Task 1.
- Produces: `VideoPanel({ wb, id, reload })`. Uses `adminFetch` directly for the video routes (they return partials, so call `reload()` after each mutation).

- [ ] **Step 1: Write `VideoPanel.jsx`**

```jsx
import { useState } from 'react';
import { adminFetch } from '../../api/adminApi';

const VIDEO_TYPES = ['official', 'live', 'lyric', 'fan-made', 'other'];

function parseYouTubeId(input) {
  const s = (input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function VideoPanel({ wb, id, reload }) {
  const [url, setUrl] = useState('');
  const [type, setType] = useState('official');
  const [msg, setMsg] = useState('');

  const add = async () => {
    const yt = parseYouTubeId(url);
    if (!yt) { setMsg('Could not find an 11-char YouTube id in that URL.'); return; }
    setMsg('');
    const r = await adminFetch(`/api/admin/workbench/${id}/videos`, { method: 'POST', body: { youtube_id: yt, video_type: type } });
    if (r.ok) { setUrl(''); reload(); } else { const d = await r.json().catch(() => ({})); setMsg(d.error || 'Add failed'); }
  };
  const setPrimary = async (videoId) => {
    const r = await adminFetch(`/api/admin/workbench/videos/${videoId}/primary`, { method: 'PUT' });
    if (r.ok) reload();
  };
  const del = async (videoId) => {
    if (!window.confirm('Delete this video?')) return;
    const r = await adminFetch(`/api/admin/workbench/videos/${videoId}`, { method: 'DELETE' });
    if (r.ok) reload();
  };

  const videos = wb.videos || [];
  return (
    <section className="wb-panel">
      <h2>Video</h2>
      {videos.length === 0 ? <p className="admin-stub">No videos yet.</p> : (
        <ul className="wb-videos">
          {videos.map((v) => (
            <li key={v.id}>
              <label className="wb-check">
                <input type="radio" name="primary-video" checked={!!v.is_primary} onChange={() => setPrimary(v.id)} /> primary
              </label>
              <a href={`https://www.youtube.com/watch?v=${v.youtube_id}`} target="_blank" rel="noreferrer">{v.video_title || v.youtube_id}</a>
              <span className="wb-vtype">{v.video_type}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => del(v.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      <div className="wb-video-add">
        <input className="input" placeholder="YouTube URL or id" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {VIDEO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" className="btn btn-primary btn-sm" onClick={add}>Add</button>
      </div>
      {msg && <div className="modal-result">{msg}</div>}
    </section>
  );
}
export default VideoPanel;
```

- [ ] **Step 2: Mount in `Workbench.jsx`**

Add `import VideoPanel from './VideoPanel';`. In `.wb-col-side` after `DetailsPanel`:
```jsx
<VideoPanel wb={wb} id={id} reload={reload} />
```

- [ ] **Step 3: Append video CSS to `admin.css`**

```css
.wb-videos { list-style: none; padding: 0; margin: 0 0 var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
.wb-videos li { display: flex; align-items: center; gap: var(--space-2); font-size: 0.85rem; }
.wb-videos li a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-vtype { font-size: 0.7rem; color: var(--text-muted); border: 1px solid var(--border-hairline); border-radius: var(--radius-pill); padding: 0 var(--space-2); }
.wb-video-add { display: flex; gap: var(--space-2); align-items: center; }
```

- [ ] **Step 4: Build + lint** — build succeeds; eslint 0 errors.

- [ ] **Step 5: Verify**

Open a song. Paste a full YouTube watch URL → **Add** → it appears in the list and becomes primary (first video); top-bar "Video" completeness flips to done. Add a second (paste just an 11-char id) → choose its **primary** radio → primary moves. **Delete** the primary → confirm → it's removed and primary promotes to the remaining one. Paste a non-YouTube string → Add → shows the parse message, no request error. No console errors.

- [ ] **Step 7: Commit** — `feat(A3): workbench Video panel (add-by-URL, primary, delete)`

---

### Task 7: Links, Analysis, and Notes panels

**Files:**
- Create: `frontend/src/components/admin/LinksPanel.jsx`
- Create: `frontend/src/components/admin/AnalysisPanel.jsx`
- Create: `frontend/src/components/admin/NotesPanel.jsx`
- Modify: `frontend/src/components/admin/Workbench.jsx` (mount all three in the side column; pass `id`, `reload`)

**Interfaces:**
- Consumes: `wb`, `savePanel`, `saveProcessing`, `id`, `reload`, `AutoText`.
- Produces: `LinksPanel({ wb, savePanel, id, reload })`, `AnalysisPanel({ wb })`, `NotesPanel({ wb, savePanel, saveProcessing })`.

- [ ] **Step 1: Write `LinksPanel.jsx`**

```jsx
import { adminFetch } from '../../api/adminApi';
import { AutoText } from './SavedField';

function LinksPanel({ wb, savePanel, id, reload }) {
  const artistSite = (wb.artists || []).map((a) => a.website_url).find(Boolean);
  const attachSpotify = async () => {
    const r = await adminFetch(`/api/admin/songs/${id}/attach-spotify`, { method: 'POST' });
    if (r.ok) reload(); else { const d = await r.json().catch(() => ({})); window.alert(d.error || 'Attach failed'); }
  };
  return (
    <section className="wb-panel">
      <h2>Play sources &amp; links</h2>
      <AutoText label="Spotify URL" initial={wb.spotify_url} placeholder="https://open.spotify.com/track/…"
        onSave={(v) => savePanel('links', { spotify_url: v })} />
      <AutoText label="Bandcamp / website URL" initial={wb.bandcamp_url} placeholder="https://…"
        onSave={(v) => savePanel('links', { bandcamp_url: v })} />
      <AutoText label="SoundCloud URL" initial={wb.soundcloud_url} placeholder="https://…"
        onSave={(v) => savePanel('links', { soundcloud_url: v })} />
      {artistSite && <p className="admin-stub">Artist website on file: {artistSite}</p>}
      {!wb.spotify_id && <button type="button" className="btn btn-secondary btn-sm" onClick={attachSpotify}>Attach Spotify by search</button>}
    </section>
  );
}
export default LinksPanel;
```

- [ ] **Step 2: Write `AnalysisPanel.jsx`**

```jsx
function AnalysisPanel({ wb }) {
  return (
    <section className="wb-panel">
      <h2>Analysis</h2>
      <p className="wb-readonly">
        {wb.analysed ? 'Analysed (gemma4:latest)' : 'Not yet analysed'}
      </p>
      <p className="admin-stub">Coded themes are added by the external analysis process (sub-project B). Read-only here.</p>
    </section>
  );
}
export default AnalysisPanel;
```

- [ ] **Step 3: Write `NotesPanel.jsx`**

```jsx
import { AutoText } from './SavedField';

const PARK_LABELS = { awaiting_community: 'Awaiting community', needs_transcription: 'Needs transcription', listened_unclear: 'Listened — unclear' };

function NotesPanel({ wb, savePanel, saveProcessing }) {
  const p = wb.processing || {};
  return (
    <section className="wb-panel">
      <h2>Notes</h2>
      <AutoText label="Status notes" initial={wb.status_notes} multiline rows={3}
        onSave={(v) => savePanel('details', { status_notes: v })} />
      <AutoText label="Processing note" initial={p.processing_note} multiline rows={3}
        onSave={(v) => saveProcessing({ processing_note: v })} />
      {(p.park_reason || p.snooze_until) && (
        <p className="admin-stub">
          {p.park_reason ? `Parked: ${PARK_LABELS[p.park_reason] || p.park_reason}. ` : ''}
          {p.snooze_until ? `Remind after ${String(p.snooze_until).slice(0, 10)}.` : ''}
        </p>
      )}
    </section>
  );
}
export default NotesPanel;
```

- [ ] **Step 4: Mount all three in `Workbench.jsx`**

Add imports; in `.wb-col-side` after `VideoPanel`:
```jsx
<LinksPanel wb={wb} savePanel={savePanel} id={id} reload={reload} />
<AnalysisPanel wb={wb} />
<NotesPanel wb={wb} savePanel={savePanel} saveProcessing={saveProcessing} />
```

- [ ] **Step 5: Build + lint** — build succeeds; eslint 0 errors.

- [ ] **Step 6: Verify**

Open a song. Edit each link field → blur → "Saved"; reload → persists; top-bar "Play link" completeness reflects presence. Enter a non-URL (e.g. `abc`) in Spotify URL → blur → "Save failed" (backend 400). Analysis panel shows "Not yet analysed" (or analysed for a coded song). Set a **Park** reason / **Remind** date from the top bar (Task 2) → Notes panel shows the parked/remind line after `saveProcessing` (reload if needed). Edit **Processing note** and **Status notes** → persist. For a manual song without `spotify_id`, the **Attach Spotify** button shows. No console errors.

- [ ] **Step 7: Commit** — `feat(A3): workbench Links, Analysis, Notes panels`

---

### Task 8: Within-page Prev/Next + delete superseded components (parity check)

**Files:**
- Modify: `frontend/src/components/admin/SongQueueList.jsx` (navigate with `location.state`)
- Modify: `frontend/src/components/admin/Workbench.jsx` (read `location.state`, build `nav`)
- Delete: `frontend/src/components/admin/WorkbenchStub.jsx`, `frontend/src/components/StagingQueue.jsx`, `frontend/src/components/LyricsLookupManager.jsx`, `frontend/src/components/YouTubeVideoManager.jsx`, `frontend/src/components/ManageSongsTab.jsx`

**Interfaces:**
- Consumes: `WorkbenchTopBar`'s `nav` prop `{ hasPrev, hasNext, onPrev, onNext }` (Task 2).

- [ ] **Step 1: Pass the page's id list from `SongQueueList.jsx`**

In the row `onClick`, replace `navigate(\`/admin/song/${row.id}\`)` with a state-carrying navigate that captures the current page's ids and the clicked index:
```jsx
onClick={() => navigate(`/admin/song/${row.id}`, {
  state: { from: queue, ids: rows.map((r) => r.id), index: rows.findIndex((r) => r.id === row.id) },
})}
```

- [ ] **Step 2: Build `nav` in `Workbench.jsx` from `location.state`**

Add `useLocation`, `useNavigate`:
```jsx
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
```
Inside the component:
```jsx
const location = useLocation();
const navigate = useNavigate();
const navState = location.state && Array.isArray(location.state.ids) ? location.state : null;
let nav = null;
if (navState) {
  const idx = navState.ids.indexOf(parseInt(id));
  const go = (targetIdx) => {
    const targetId = navState.ids[targetIdx];
    navigate(`/admin/song/${targetId}`, { state: { ...navState, index: targetIdx } });
  };
  nav = {
    hasPrev: idx > 0,
    hasNext: idx >= 0 && idx < navState.ids.length - 1,
    onPrev: () => go(idx - 1),
    onNext: () => go(idx + 1),
  };
}
```
Pass it: `<WorkbenchTopBar wb={wb} onAction={doAction} onPark={saveProcessing} nav={nav} />`.
(When the page is opened by a direct URL there is no `location.state`, so `nav` stays `null` and Prev/Next render nothing — per spec.)

- [ ] **Step 3: Build + lint, then verify Prev/Next**

`cd frontend && npm run build` (succeeds); `npx eslint src/` (0 errors). Verify: from Songs, click a middle row → **‹ Prev / Next ›** appear and step to the neighbouring songs (state carries across). On the first row Prev is disabled; on the last row of the page Next is disabled. Open `/admin/song/<id>` directly (new tab) → Prev/Next are absent. No console errors.

- [ ] **Step 4: Parity check before deleting**

Confirm every field the 4 doomed components managed is reachable in the new workbench, and that **nothing imports them** any more:
```bash
grep -rn "StagingQueue\|LyricsLookupManager\|YouTubeVideoManager\|ManageSongsTab\|WorkbenchStub" frontend/src
```
Expected: **no matches** (all were unmounted at A2; Task 1 removed the last `WorkbenchStub` import). Parity map (all covered — see spec §6): StagingQueue lifecycle → top-bar decisions + Links; LyricsLookupManager → Lyrics panel; YouTubeVideoManager → Video panel; ManageSongsTab edit modal → Details + Links. If the grep finds a live import, stop and wire it before deleting. If any managed field has no home in the new UI, **flag it to the curator** (do not silently drop) — the expected outcome is a clean parity with nothing to flag.

- [ ] **Step 5: Delete the dead files**

```bash
git rm frontend/src/components/admin/WorkbenchStub.jsx \
       frontend/src/components/StagingQueue.jsx \
       frontend/src/components/LyricsLookupManager.jsx \
       frontend/src/components/YouTubeVideoManager.jsx \
       frontend/src/components/ManageSongsTab.jsx
```

- [ ] **Step 6: Build + lint again (no broken imports)**

`cd frontend && npm run build` → Expected: succeeds (proves nothing referenced the deleted files). `npx eslint src/` → 0 errors.

- [ ] **Step 7: Commit** — `feat(A3): within-page Prev/Next; delete 4 superseded admin components`

---

### Task 9: End-to-end smoke test + docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md` (advance A3 → done, A4 next; changelog + any decisions).

- [ ] **Step 1: Regression — backend tests still green**

Run (from `backend/`): `node --test` → Expected: all tests pass (A3 changed no backend file; this confirms no accidental change).

- [ ] **Step 2: Full workbench smoke (backend + dev server, admin logged in)**

Drive one pending song end-to-end and confirm each observable:
1. Songs → open a **pending** song via a row click.
2. Paste lyrics → "Saved"; top-bar **Lyrics** → done.
3. Select a line → **+ Add selection** → appears in Key lyrics.
4. Add a YouTube video → primary set; **Video** → done.
5. Save a Spotify URL → **Play link** → done.
6. **Include & publish** → badge → `live`; completeness refreshes.
7. **‹ Prev / Next ›** steps within the queue; direct-URL open hides them.
8. On a pending song, **Reject** → confirm dialog; cancel → unchanged.
9. Reload the page → every saved value persisted.
10. Clean up test edits (unpublish / revert the demo song, delete the test video, clear test lyrics) so the shared DB is left as found.

Record the pass/fail of each in the session notes.

- [ ] **Step 3: Update docs**

In `docs/PROJECT_STATE.md`: set Current session = A3 done, Next session = A4; add a Changelog entry (what shipped, smoke result, files deleted); note in Decision Log any A3 choices worth keeping (two-column layout; interactive highlights; Prev/Next within-page; playlist-indicator deferred to F). In `docs/PROJECT_PLAN.md`: mark A3 ☑, confirm A4 is next.

- [ ] **Step 4: Commit** — `docs(A3): mark A3 complete — Curation Workbench; A4 next`

- [ ] **Step 5: Merge decision**

Per the project End-Session guide, push `session-A3-workbench` and present the merge choice to the curator (merge to `main` or await click-through) using the `finishing-a-development-branch` skill.

---

## Notes for the implementer

- **Autosave contract:** `AutoText` only fires `onSave` when the value actually changed and shows the returned status; a failed save keeps the typed value (no data loss). Selects/checkboxes save on change.
- **State refresh rules:** panel PUTs (`details/lyrics/highlights/links/cover`) return `{workbench}` → the container swaps state (completeness + top bar update for free). `processing` returns a partial → merged locally. **Video routes and lifecycle routes return partials → always `reload()` after them.**
- **Never** hardcode `localhost:5000` or the password header — `adminFetch` handles both. **Never** add `lyrics`/`translation` to a public route.
- Match the existing A2 component style (small focused components, design tokens, no emoji).
