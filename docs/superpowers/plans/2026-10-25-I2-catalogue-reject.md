# Reject inside the catalogue check (I2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the artist workbench's Catalogue panel, let the curator mark each new song *Process* or *Reject* and apply both in one action (rejects saved as `rejected` song rows), and prompt the manual "catalogue reviewed" mark.

**Architecture:** `bandCheck.addSelected` gains an optional `rejectKeys` list that reuses the existing insert path and then flips only the rows that apply just created to `rejected`; the add route passes it through. `CatalogueReview.jsx` replaces its single `picked` Set with a per-song `choice` Map (`'process' | 'reject'`) and adds the reviewed prompts.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test`; React 19 + Vite.

**Spec:** `docs/superpowers/specs/2026-10-25-I2-catalogue-reject-design.md`

## Global Constraints

- YAGNI; every change weighed against "does this risk the 650-song curated dataset?" This plan writes **only songs created by the same apply**; it never modifies an existing catalogue song (except the existing Bandcamp-link update, which is already limited to rows the apply just created).
- No migration.
- Rejected songs are never public: `status='rejected'`, `published=false`, `published_at=NULL`.
- `keys` alone must behave exactly as before; the response gains `rejected` (always present, `0` when none).
- Combined limit: `keys.length + rejectKeys.length` is 1..100 (`MAX_ADD`); a key in both lists is `BAD_INPUT`; a failing source aborts before any write (unchanged); one add at a time (`BUSY`, unchanged).
- Nothing may log or rethrow a fetch error's message, URL or token.
- Admin fetches go through `adminFetch` (via `api()` in `bandCheckApi.js`); styling uses existing admin classes / `--*` tokens; no raw colours; no new explanatory chrome. Never type `ADMIN_PASSWORD`.
- Backend tests: reuse the `ZZZBANDSVC` sentinel in `backend/test/bandCheckService.test.js`; run with `cd backend && npm test` (serial). Never `taskkill /IM node.exe`; no temp scripts inside `backend/`.
- `git add` explicit paths only (`backend/docs/` and `docs/examples/` are deliberately untracked). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; on PowerShell write the message to a scratchpad file and use `git commit -F`. Use the Edit tool per hunk for non-ASCII files (no PowerShell whole-file rewrites).

## Review Focus

- A key in both lists must write nothing (not "process wins"). Pinned in Task 1.
- A rejected song must never be public and must never reappear as *new* on the next read. Pinned in Task 1.
- An existing catalogue song (held/live) passed in `rejectKeys` must be left untouched. Pinned in Task 1.
- A reject-only apply (no `keys`) must work, and `keys` alone must return `rejected: 0`. Pinned in Task 1.
- The Reviewed prompts must not appear on an empty/failed read (no `counts` or no releases). Pinned in Task 2.
- Ticking Process then Reject on a row (and vice-versa) leaves exactly one choice; ticks survive a refresh only for songs still *new*. Pinned in Task 2.

---

### Task 1: `addSelected` accepts `rejectKeys`

**Files:**
- Modify: `backend/services/bandCheck/index.js` (`addSelected`, lines ~190-237)
- Modify: `backend/routes/admin.js` (the `POST /band-check/bands/:id/add` handler)
- Test: `backend/test/bandCheckService.test.js`

**Interfaces:**
- Consumes: `staging.insertCandidates(db, tracks, { note })` -> `{ added, skippedExisting }`; `staging.insertManualCandidate(db, {...})` -> `{ added, skippedExisting, song_id }`; existing `loadMerged`, `loadArtist`, `coded`, `MAX_ADD`, `SOURCE_LABELS` in the same file.
- Produces: `addSelected(db, artistId, keys, { adapters, rejectKeys })` -> `{ added, rejected, skippedExisting, notFound }`. `keys` may be `undefined` when `rejectKeys` is non-empty. Route `POST /api/admin/band-check/bands/:id/add` body `{ keys?, rejectKeys? }`.

- [ ] **Step 1: Update the two existing assertions, then write the failing tests**

In `backend/test/bandCheckService.test.js`, the existing test `addSelected: Spotify songs via intake, ...` has two exact-shape assertions; add `rejected: 0` to both:

```js
  assert.deepEqual(res, { added: 2, rejected: 0, skippedExisting: 1, notFound: 1 });
```
```js
  assert.deepEqual(again, { added: 0, rejected: 0, skippedExisting: 2, notFound: 0 }); // double-click is harmless
```

Then append these tests after the existing `addSelected: a failing source aborts ...` test:

```js
test('addSelected: rejectKeys saves new songs as rejected rows, never public, and they read as rejected (not new) on the next check', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  const adapters = fakeAdapters({ spotify: SPOT, bandcamp: BAND });
  const res = await svc.addSelected(pool, a, undefined,
    { adapters, rejectKeys: ['zzzbandsvc fresh', 'zzzbandsvc bandcamp only', 'zzzbandsvc held', 'not a real key'] });
  assert.deepEqual(res, { added: 0, rejected: 2, skippedExisting: 1, notFound: 1 });

  const rows = (await pool.query(
    `SELECT title, status, published, published_at, data_source, spotify_id, bandcamp_url, status_notes
     FROM songs WHERE title LIKE 'ZZZBANDSVC%' ORDER BY title`)).rows;
  const by = Object.fromEntries(rows.map(r => [r.title, r]));
  for (const t of ['ZZZBANDSVC Fresh', 'ZZZBANDSVC Bandcamp Only']) {
    assert.equal(by[t].status, 'rejected', t);
    assert.equal(by[t].published, false, t);
    assert.equal(by[t].published_at, null, t);
    assert.match(by[t].status_notes, /^rejected via band check \(ZZZBANDSVC Merged\)/);
  }
  assert.equal(by['ZZZBANDSVC Fresh'].spotify_id, 'ZZZBANDSVCt2');
  assert.equal(by['ZZZBANDSVC Fresh'].bandcamp_url, 'https://zzzbandsvcm.bandcamp.com/track/fresh');
  assert.equal(by['ZZZBANDSVC Bandcamp Only'].data_source, 'manual');
  // the existing catalogue song passed in rejectKeys is untouched
  assert.deepEqual([by['ZZZBANDSVC Held'].status, by['ZZZBANDSVC Held'].published], ['included', true]);

  svc._resetForTests();
  const chk = await svc.checkBand(pool, a, { adapters, fresh: true });
  assert.equal(chk.counts.new, 0);
  assert.equal(chk.counts.rejected, 2);
  assert.equal(chk.counts.in_catalogue, 1);
});

test('addSelected: process and reject in one apply; a key in both lists, or too many keys in total, writes nothing', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  const adapters = fakeAdapters({ spotify: SPOT, bandcamp: BAND });
  const both = await svc.addSelected(pool, a, ['zzzbandsvc fresh'], { adapters, rejectKeys: ['zzzbandsvc fresh'] }).catch(e => e);
  assert.equal(both.code, 'BAD_INPUT');
  const tooMany = await svc.addSelected(pool, a, Array.from({ length: 60 }, (_, i) => 'a' + i),
    { adapters, rejectKeys: Array.from({ length: 41 }, (_, i) => 'b' + i) }).catch(e => e);
  assert.equal(tooMany.code, 'BAD_INPUT');
  for (const bad of [{ rejectKeys: 'x' }, { rejectKeys: [1] }, { rejectKeys: [] }]) {
    await assert.rejects(svc.addSelected(pool, a, undefined, { adapters, ...bad }), (e) => e.code === 'BAD_INPUT');
  }
  assert.equal((await pool.query(`SELECT count(*)::int n FROM songs WHERE title IN ('ZZZBANDSVC Fresh','ZZZBANDSVC Bandcamp Only')`)).rows[0].n, 0);

  const res = await svc.addSelected(pool, a, ['zzzbandsvc fresh'], { adapters, rejectKeys: ['zzzbandsvc bandcamp only'] });
  assert.deepEqual(res, { added: 1, rejected: 1, skippedExisting: 0, notFound: 0 });
  const st = Object.fromEntries((await pool.query(
    `SELECT title, status, status_notes FROM songs WHERE title IN ('ZZZBANDSVC Fresh','ZZZBANDSVC Bandcamp Only')`)).rows.map(r => [r.title, r]));
  assert.equal(st['ZZZBANDSVC Fresh'].status, 'pending');
  assert.match(st['ZZZBANDSVC Fresh'].status_notes, /^added via band check/);
  assert.equal(st['ZZZBANDSVC Bandcamp Only'].status, 'rejected');
});

test('addSelected: a failing source writes nothing for rejectKeys either', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  const bad = fakeAdapters({ spotify: Object.assign(new Error('x'), { code: 'RATE_LIMITED' }), bandcamp: BAND });
  await assert.rejects(svc.addSelected(pool, a, undefined, { adapters: bad, rejectKeys: ['zzzbandsvc fresh'] }), (e) => e.code === 'RATE_LIMITED');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM songs WHERE title IN ('ZZZBANDSVC Fresh','ZZZBANDSVC Bandcamp Only')`)).rows[0].n, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && node --test test/bandCheckService.test.js`
Expected: the three new tests and the two updated assertions FAIL (no `rejected` in the result; `rejectKeys` ignored).

- [ ] **Step 3: Implement**

In `backend/services/bandCheck/index.js` replace the whole `addSelected` function (from the `// Adds the songs the curator ticked...` comment through its closing brace; leave `module.exports` as is) with:

```js
// Adds the songs the curator ticked (keys) and/or saves the ones they rejected (rejectKeys) as `rejected` rows.
// Never trusts client data: only song keys come in, and the catalogue is re-read live.
async function addSelected(db, artistId, keys, { adapters, rejectKeys } = {}) {
  const proc = keys === undefined ? [] : keys;
  const rej = rejectKeys === undefined ? [] : rejectKeys;
  const okList = (l) => Array.isArray(l) && l.every(k => typeof k === 'string' && k);
  if (!okList(proc) || !okList(rej) || proc.length + rej.length < 1 || proc.length + rej.length > MAX_ADD) {
    throw coded('BAD_INPUT', `keys and rejectKeys must hold 1-${MAX_ADD} song keys in total`);
  }
  const procSet = new Set(proc);
  if (rej.some(k => procSet.has(k))) throw coded('BAD_INPUT', 'A song cannot be both processed and rejected');
  if (adding) throw coded('BUSY', 'Another add is in progress');
  adding = true;
  try {
    const artist = await loadArtist(db, artistId);
    adapters = adapters || defaultAdapters();
    const { sources, songs } = await loadMerged(db, artist, { adapters, fresh: true, now: Date.now });
    // a half-read catalogue would send Spotify songs down the manual path: fail before writing anything, so the curator can retry
    const failed = Object.values(sources).find(s => s.status === 'error');
    if (failed) {
      const label = SOURCE_LABELS[Object.keys(sources).find(k => sources[k] === failed)];
      throw coded(failed.code, `${label} could not be read, so nothing was added - retry, or clear that source under Identify sources`);
    }
    const byKey = new Map(songs.map(s => [s.key, s]));
    let skippedExisting = 0, notFound = 0;
    const pick = (list) => {
      const picked = [];
      for (const key of [...new Set(list)]) {
        const s = byKey.get(key);
        if (!s) notFound++;
        else if (s.state !== 'new') skippedExisting++;
        else picked.push(s);
      }
      return picked;
    };
    const toProcess = pick(proc), toReject = pick(rej);

    // Inserts picked songs as pending under `note`; reports the ids it created so a caller can act on exactly those rows.
    const insertPicked = async (picked, note) => {
      let added = 0;
      const spotifyIds = [], songIds = [];
      const withSpotify = picked.filter(s => s.sources.spotify && s.sources.spotify.mapped);
      if (withSpotify.length) {
        const r = await staging.insertCandidates(db, withSpotify.map(s => s.sources.spotify.mapped), { note });
        added += r.added; skippedExisting += r.skippedExisting;
        for (const s of withSpotify) {
          spotifyIds.push(s.sources.spotify.mapped.spotify_id);
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
        if (r.song_id) songIds.push(r.song_id);
      }
      return { added, spotifyIds, songIds };
    };

    const processed = await insertPicked(toProcess, `added via band check (${artist.name})`);
    let rejected = 0;
    if (toReject.length) {
      const rejectNote = `rejected via band check (${artist.name})`;
      const made = await insertPicked(toReject, rejectNote);
      // flip ONLY the rows this call just created: still pending, carrying this call's note, and one of the ids it reported
      const upd = await db.query(
        `UPDATE songs SET status='rejected', published=false, published_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE status='pending' AND status_notes=$1 AND (spotify_id = ANY($2::text[]) OR id = ANY($3::int[]))`,
        [rejectNote, made.spotifyIds, made.songIds]);
      rejected = upd.rowCount;
    }
    return { added: processed.added, rejected, skippedExisting, notFound };
  } finally { adding = false; }
}
```

In `backend/routes/admin.js` replace the add handler body:

```js
router.post('/band-check/bands/:id/add', async (req, res) => {
  try {
    const { keys, rejectKeys } = req.body || {};
    res.json({ success: true, ...(await bandCheck.addSelected(pool, bandId(req), keys, { adapters: bandAdapters, rejectKeys })) });
  }
  catch (e) { bandCheckError(res, e, 'add the songs'); }
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && node --test test/bandCheckService.test.js` -> all PASS. Then the full suite once: `cd backend && npm test` -> all pass (previous total 369 plus the 3 new tests = 372; report the actual number). Also `node --check routes/admin.js`.

- [ ] **Step 5: Commit**

```bash
git add backend/services/bandCheck/index.js backend/routes/admin.js backend/test/bandCheckService.test.js
git commit -m "feat(band-check): rejectKeys saves chosen new songs as rejected rows"
```

---

### Task 2: Catalogue panel - Process / Reject choices, Apply, reviewed prompts

**Files:**
- Modify (replace whole file): `frontend/src/components/admin/CatalogueReview.jsx`
- Modify: the stylesheet that defines `.band-check` (find it with `grep -rn "band-check" frontend/src --include=*.css`; add the `.band-choice` / `.band-song` rules next to it)

**Interfaces:**
- Consumes: `POST /api/admin/band-check/bands/:id/add` body `{ keys: string[], rejectKeys: string[] }` -> `{ added, rejected, skippedExisting, notFound }` (Task 1); props `CatalogueReview({ artistId, identity, onNeedIdentity, onAdded, reviewed, onReviewedChange, refreshKey })` unchanged.
- Produces: same component export; no prop changes.

- [ ] **Step 1: Replace `CatalogueReview.jsx` with this complete file**

```jsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, SOURCES, SOURCE_LABEL } from './bandCheckApi';

const PARTIAL = { bandcamp: 'first 40 releases', musicbrainz: 'first 1,000 recordings' };

function stateChip(match) {
  if (match.status === 'rejected') return 'rejected';
  if (match.status === 'pending') return 'pending';
  return match.published ? 'live' : 'not live';
}

// choice: song key -> 'process' | 'reject'. Untouched songs are left alone.
function CatalogueReview({ artistId, identity, onNeedIdentity, onAdded, reviewed, onReviewedChange, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState(() => new Map());
  const [result, setResult] = useState('');
  const [added, setAdded] = useState(0);
  const [adding, setAdding] = useState(false);
  const [markSaving, setMarkSaving] = useState(false);
  const [markError, setMarkError] = useState('');
  const seq = useRef(0);
  const resultRef = useRef(null);
  const focusResult = useRef(false);
  // held in a ref so an unstable parent callback can never retrigger load()
  const needIdentity = useRef(onNeedIdentity);
  useEffect(() => { needIdentity.current = onNeedIdentity; });

  const load = useCallback(async (fresh) => {
    const my = ++seq.current;
    setError(''); setData(d => (fresh ? d : null));
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}${fresh ? '?fresh=1' : ''}`);
      if (my === seq.current) {
        setData(d);
        if (fresh) { // keep choices that are still new songs; drop ones that vanished or are now held
          const stillNew = new Set(d.releases.flatMap(r => r.songs).filter(s => s.state === 'new').map(s => s.key));
          setChoice(c => new Map([...c].filter(([k]) => stillNew.has(k))));
        } else setChoice(new Map());
      }
    } catch (e) {
      if (my !== seq.current) return;
      // NO_IDENTITY (409) carries the band: ask the parent to open the Links step
      if (e.artist) {
        setData({ artist: e.artist, sources: {}, releases: [], counts: null });
        needIdentity.current?.(SOURCES.find(s => !(e.artist.identity || {})[s]) || null);
      } else {
        setError(e.message);
        setData(prev => prev || { artist: { id: artistId, name: '', identity: { spotify: null, bandcamp: null, musicbrainz: null } }, sources: {}, releases: [], counts: null });
      }
    }
  }, [artistId]);
  useEffect(() => { load(false); }, [load]);
  // the parent bumps refreshKey (starts at 0, so mount does not double-load) when identity changed
  useEffect(() => { if (refreshKey) load(true); }, [refreshKey, load]);
  // after a successful apply the focused Apply button unmounts: move focus to the footer message
  useEffect(() => {
    if (result && focusResult.current) { focusResult.current = false; resultRef.current?.focus(); }
  }, [result]);

  const toggleReviewed = async (next) => {
    setMarkSaving(true); setMarkError('');
    const res = await onReviewedChange(next);
    setMarkSaving(false);
    if (!res || !res.ok) setMarkError((res && res.error) || 'Save failed');
  };

  const toolbar = (
    <div className="queue-toolbar band-toolbar">
      <h2>Catalogue</h2>
      {data && <button className="btn btn-secondary btn-sm" onClick={() => { setResult(''); load(true); }}>Refresh</button>}
      {data && (
        <button className="btn btn-secondary btn-sm" disabled={markSaving} onClick={() => toggleReviewed(!reviewed)}>
          {reviewed ? 'Clear reviewed mark' : 'Mark catalogue reviewed'}
        </button>
      )}
      {markError && <span className="admin-message error">{markError}</span>}
    </div>
  );

  if (data === null) return <div>{toolbar}<div className="queue-empty">Reading the sources…</div></div>;
  const newSongs = data.releases.flatMap(r => r.songs).filter(s => s.state === 'new');
  const processKeys = [...choice].filter(([, v]) => v === 'process').map(([k]) => k);
  const rejectKeys = [...choice].filter(([, v]) => v === 'reject').map(([k]) => k);
  const P = processKeys.length, R = rejectKeys.length;
  // ticking the same box again clears the choice; ticking the other box switches it
  const setOne = (key, value) => {
    setResult('');
    setChoice(c => { const n = new Map(c); if (n.get(key) === value) n.delete(key); else n.set(key, value); return n; });
  };
  const setMany = (songs, value) => {
    setResult('');
    setChoice(c => { const n = new Map(c); songs.filter(s => s.state === 'new').forEach(s => n.set(s.key, value)); return n; });
  };

  const apply = async () => {
    setAdding(true); setResult('');
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}/add`, { method: 'POST', body: { keys: processKeys, rejectKeys } });
      setAdded(d.added);
      setResult(`Added ${d.added}, rejected ${d.rejected}${d.skippedExisting ? `, ${d.skippedExisting} already held` : ''}${d.notFound ? `, ${d.notFound} no longer listed` : ''}.`);
      focusResult.current = true;
      onAdded?.();
      await load(true);
    } catch (e) { setError(e.message); } finally { setAdding(false); }
  };

  // notes only for sources that say something: could not be read, partial, or shares nothing with the rest
  const notes = Object.entries(data.sources).flatMap(([s, st]) => {
    const out = [];
    if (st.status !== 'ok') out.push({ key: `${s}:err`, kind: 'error', text: `${SOURCE_LABEL[s]}: ${st.message || 'could not be read this time'}` });
    else if (st.truncated) out.push({ key: `${s}:partial`, kind: 'partial', text: `${SOURCE_LABEL[s]}: partial${PARTIAL[s] ? ` (${PARTIAL[s]})` : ''}` });
    const otherSongs = Object.entries(data.sources).some(([o, os]) => o !== s && os.status === 'ok' && os.songs > 0);
    if (st.status === 'ok' && st.songs > 0 && st.overlap === 0 && (otherSongs || data.artist.songs > 0)) {
      out.push({ key: `${s}:suspect`, kind: 'warn', source: s, text: `${SOURCE_LABEL[s]} shares no songs with the other sources or the catalogue - check it is the right band` });
    }
    return out;
  });

  const noIdentity = SOURCES.every(s => !(identity || {})[s]);
  // reviewed prompts only on a real read: counts exist and there is something listed
  const readOk = !!data.counts && data.releases.length > 0;

  return (
    <div>
      {toolbar}
      {error && <div className="admin-message error">{error}</div>}
      {(data.counts || newSongs.length > 0) && (
        <div className="band-counts">
          {data.counts && (
            <div className="band-counts-list band-meta">
              <span>{data.counts.new} new</span><span>{data.counts.in_catalogue} held</span><span>{data.counts.rejected} rejected</span><span>{data.counts.single_source} on one source only</span>
            </div>
          )}
          {newSongs.length > 0 && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setMany(newSongs, 'process')}>Process all new ({newSongs.length})</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMany(newSongs, 'reject')}>Reject all new ({newSongs.length})</button>
            </>
          )}
        </div>
      )}
      {readOk && !reviewed && data.counts.new === 0 && (
        <div className="band-note">
          <span>Nothing new left.</span>{' '}
          <button className="btn btn-secondary btn-sm" disabled={markSaving} onClick={() => toggleReviewed(true)}>Mark catalogue reviewed</button>
        </div>
      )}
      {readOk && reviewed && data.counts.new > 0 && (
        <div className="band-note warn">
          <span>{data.counts.new} new since you marked this reviewed.</span>{' '}
          <button className="btn btn-secondary btn-sm" disabled={markSaving} onClick={() => toggleReviewed(false)}>Back to Needs catalogue check</button>
        </div>
      )}
      {notes.map(n => (n.source
        ? <button key={n.key} className={`band-note ${n.kind} band-note-btn`} onClick={() => onNeedIdentity(n.source)}>{n.text}</button>
        : <div key={n.key} className={`band-note ${n.kind}`}>{n.text}</div>))}
      {noIdentity && data.releases.length === 0 && <div className="queue-empty">Set at least one source under Links, then Refresh.</div>}
      {data.releases.map((rel, i) => (
        <section key={`${rel.source}:${rel.name}:${rel.release_date}:${i}`} className="band-release">
          <div className="band-release-head">
            <div><h3>{rel.name}</h3> <span className="band-meta">{rel.album_type || ''} {rel.release_date ? `· ${rel.release_date.slice(0, 4)}` : ''}</span></div>
            {rel.songs.some(s => s.state === 'new') && (
              <div>
                <button className="btn btn-ghost btn-sm" onClick={() => setMany(rel.songs, 'process')}>Process all new</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setMany(rel.songs, 'reject')}>Reject all new</button>
              </div>
            )}
          </div>
          {rel.songs.map(s => (
            <div key={s.key} className={`inbox-row ${s.state === 'in_catalogue' ? 'band-held' : ''}`}>
              <div className="band-song">
                {s.state === 'new'
                  ? (
                    <span className="band-choice">
                      <label><input type="checkbox" aria-label={`Process ${s.title}`} checked={choice.get(s.key) === 'process'} onChange={() => setOne(s.key, 'process')} /> Process</label>
                      <label><input type="checkbox" aria-label={`Reject ${s.title}`} checked={choice.get(s.key) === 'reject'} onChange={() => setOne(s.key, 'reject')} /> Reject</label>
                    </span>
                  )
                  : <span className="band-check" aria-hidden="true" />}
                <strong>{s.title}</strong>
                {s.also_on.length > 0 && <span className="band-meta"> · also on {s.also_on.join(', ')}</span>}
              </div>
              <div className="band-meta">
                {Object.keys(s.sources).map(src => (s.sources[src].url
                  ? <a key={src} className="band-chip" href={s.sources[src].url} target="_blank" rel="noreferrer">{SOURCE_LABEL[src]}</a>
                  : <span key={src} className="band-chip">{SOURCE_LABEL[src]}</span>))}
                {s.state === 'new' && Object.keys(s.sources).length === 1 && <span className="band-chip warn">one source only</span>}
                {s.match && <Link className="band-chip" to={`/admin/song/${s.match.song_id}`} title={s.match.matched_by === 'title' ? 'matched by title' : undefined}>{stateChip(s.match)}</Link>}
              </div>
            </div>
          ))}
        </section>
      ))}
      {(P + R > 0 || result) && (
        <div className="band-footer">
          {result && (
            <div ref={resultRef} tabIndex={-1} role="status" className="admin-message success">
              {result}{added > 0 && <> <Link to="/admin/songs?queue=to-process">Open To be processed</Link></>}
            </div>
          )}
          {P + R > 0 && (
            <button className="btn btn-primary" disabled={adding} onClick={apply}>
              {adding ? 'Applying…' : `Apply: process ${P} · reject ${R}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CatalogueReview;
```

Notes for the implementer: the file keeps every behaviour of the previous version except the changes above (picked Set -> choice Map; "Select all new"/"Select new" -> Process/Reject buttons; per-row checkboxes; Apply footer and result text; reviewed prompts; `toggleReviewed` shared by the toolbar and the prompts). Keep the `·`, `…`, `—`-style characters intact (the `·` and `…` above are literal characters in this file).

- [ ] **Step 2: Add the row-layout CSS**

Find the file defining `.band-check` and add, next to it, using existing tokens (look at neighbouring `.band-*` rules for the spacing/colour variables they use; no raw colours):

```css
.band-song { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; min-width: 0; }
.band-choice { display: inline-flex; gap: var(--space-3); flex: none; }
.band-choice label { display: inline-flex; align-items: center; gap: var(--space-1); font-size: 0.9em; cursor: pointer; }
```

The old `label`-wrapped row relied on `.inbox-row label` styles; check `grep -rn "inbox-row" frontend/src --include=*.css` and make sure the new `.band-song` block looks the same (title next to the controls, wraps on a phone). Adjust only these new rules.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run lint && npm run build` -> 0 errors (5 pre-existing warnings). No browser is available to this task (admin login gate); say so honestly. The browser check is Task 3.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/CatalogueReview.jsx <the stylesheet you edited>
git commit -m "feat(admin): Process/Reject choices in the catalogue check, Apply, reviewed prompts"
```

---

### Task 3: Verification and docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `CLAUDE.md` (the `services/bandCheck/` bullet: `addSelected` takes `rejectKeys`; the Catalogue panel's Process/Reject choices), `docs/superpowers/specs/2026-10-25-I2-catalogue-reject-design.md` only if a deviation was needed.

- [ ] **Step 1: Full test run and build**

`cd backend && npm test` (record the count); `cd frontend && npm run lint && npm run build`.

- [ ] **Step 2: Real-browser check through a throwaway mock harness**

Same method as I1 (throwaway Vite harness in the scratchpad on port :5199, never in the repo; mock `adminFetch` and the `/api/admin/band-check/*` and `/api/admin/artists/:id` endpoints; mount the REAL `ArtistWorkbench`; drive with headless Chrome / claude-in-chrome; never type `ADMIN_PASSWORD`; never click anything that triggers `window.confirm`/`alert`; stop only your own PID). Mock `POST .../add` statefully: process keys become `pending` held songs, reject keys become `rejected` held songs, response `{ success, added, rejected, skippedExisting, notFound }`, and the next GET reflects the new states and counts. Check: Process and Reject boxes are mutually exclusive per row (ticking the other switches; ticking the same clears); header and counts "Process all new" / "Reject all new" only affect *new* songs; footer reads `Apply: process P · reject R` and appears only when P+R>0; after Apply the result reads `Added A, rejected R`, focus lands on it, the link shows only when A>0, held/rejected chips appear and "N new" falls; ticks survive Refresh only for songs still new; "Nothing new left. Mark catalogue reviewed" appears at 0 new when not reviewed and the button marks it; "N new since you marked this reviewed" appears when reviewed with new>0 and "Back to Needs catalogue check" clears the mark; neither prompt shows on an error/empty read; phone width (390px) and keyboard tab order; no console errors. Fix genuine defects minimally with commits; list nits.

- [ ] **Step 3: Docs and commit**

Update `docs/PROJECT_STATE.md` (Current State entry, Next Tasks smoke list: open a catalogue, tick a mix of Process/Reject, Apply, see rejected chips and the song under Songs > All songs as rejected, mark reviewed via the prompt; Changelog), `CLAUDE.md` bullets, then:

```bash
git add docs/PROJECT_STATE.md CLAUDE.md
git commit -m "docs: sub-project I2 (reject in the catalogue check) state"
git push
```
