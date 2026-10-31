import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, SOURCES, SOURCE_LABEL } from './bandCheckApi';
import { useBandcampLyricsRun } from './useBandcampLyricsRun';
import { RunProgress } from './BandcampLyricsResults';

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
  const [loading, setLoading] = useState(false); // a read is in flight (a fresh read of a slow source can take several seconds)
  const [choice, setChoice] = useState(() => new Map());
  const [result, setResult] = useState('');
  const [added, setAdded] = useState(0);
  const [adding, setAdding] = useState(false);
  const [markSaving, setMarkSaving] = useState(false);
  const [markError, setMarkError] = useState('');
  // Lyrics while reviewing: a fetch run (one chip per row), text pasted by hand (song key -> text), which rows are
  // expanded, held songs whose lyrics were saved from their row, and a per-row error.
  const lyr = useBandcampLyricsRun();
  const [pasted, setPasted] = useState(() => new Map());
  const [openRows, setOpenRows] = useState(() => new Set());
  const [savedHeld, setSavedHeld] = useState(() => new Set());
  const [rowError, setRowError] = useState(() => new Map());
  const seq = useRef(0);
  const resultRef = useRef(null);
  const focusResult = useRef(false);
  // held in a ref so an unstable parent callback can never retrigger load()
  const needIdentity = useRef(onNeedIdentity);
  useEffect(() => { needIdentity.current = onNeedIdentity; });

  const load = useCallback(async (fresh) => {
    const my = ++seq.current;
    setError(''); setLoading(true); setData(d => (fresh ? d : null));
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}${fresh ? '?fresh=1' : ''}`);
      if (my === seq.current) {
        setData(d);
        if (fresh) { // keep choices that are still new songs; drop ones that vanished or are now held
          const stillNew = new Set(d.releases.flatMap(r => r.songs).filter(s => s.state === 'new').map(s => s.key));
          setChoice(c => new Map([...c].filter(([k]) => stillNew.has(k))));
          const listed = new Set(d.releases.flatMap(r => r.songs).map(s => s.key));
          setPasted(p => new Map([...p].filter(([k]) => listed.has(k)))); // a Refresh must not drop text pasted for songs still listed
        } else { setChoice(new Map()); setPasted(new Map()); }
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
    } finally { if (my === seq.current) setLoading(false); }
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
      {data && <button className="btn btn-secondary btn-sm" disabled={loading} onClick={() => { setResult(''); load(true); }}>{loading ? 'Reading…' : 'Refresh'}</button>}
      {data && (
        <button className="btn btn-secondary btn-sm" disabled={markSaving} onClick={() => toggleReviewed(!reviewed)}>
          {reviewed ? 'Clear reviewed mark' : 'Mark catalogue reviewed'}
        </button>
      )}
      {markError && <span className="admin-message error">{markError}</span>}
      {data && (identity || {}).bandcamp && (
        <button className="btn btn-secondary btn-sm" disabled={lyr.state.phase === 'running'} onClick={() => lyr.start('catalogue', artistId)}>Fetch lyrics</button>
      )}
      {data && !(identity || {}).bandcamp && <span className="band-meta">Set a Bandcamp link under Links to fetch lyrics</span>}
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

  const results = new Map(lyr.state.results.map(r => [r.key, r]));
  const toggleRow = (key) => setOpenRows(o => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const setPastedText = (key, text) => setPasted(p => { const n = new Map(p); if (text.trim()) n.set(key, text); else n.delete(key); return n; });
  const saveHeld = async (s) => {
    setRowError(m => { const n = new Map(m); n.delete(s.key); return n; });
    try {
      const text = (pasted.get(s.key) || '').trim();
      await api(`/api/admin/bandcamp-lyrics/catalogue/${artistId}/save`, { method: 'POST',
        body: text ? { songId: s.match.song_id, text } : { songId: s.match.song_id, key: s.key, runId: lyr.state.runId } });
      setSavedHeld(h => new Set(h).add(s.key));
    } catch (e) { setRowError(m => new Map(m).set(s.key, e.message)); }
  };

  // chip + expandable text for a new or held row; only once a fetch has produced a result (rows with none show nothing extra)
  const lyricsBits = (s) => {
    if (s.state !== 'new' && !(s.state === 'in_catalogue' && s.match && s.match.status !== 'rejected')) return null;
    const res = results.get(s.key);
    const text = (pasted.get(s.key) || '').trim();
    if (!res && !text) return null;
    const held = s.state !== 'new';
    if (held && savedHeld.has(s.key)) return { chip: <span className="band-chip lyr-ok">lyrics saved</span>, panel: null };
    const found = !!res && res.status === 'found';
    const open = openRows.has(s.key);
    const chip = text ? <span className="band-chip lyr-ok">lyrics pasted</span>
      : found ? <span className="band-chip lyr-ok">lyrics found</span>
      : <span className="band-chip">no lyrics found</span>;
    const button = <button className="btn btn-ghost btn-sm" onClick={() => toggleRow(s.key)}>{open ? 'Hide' : (found && !text ? 'Read' : 'Add lyrics')}</button>;
    const panel = open && (
      <div className="lyr-panel">
        {found && !text && <pre className="bcl-lyrics" tabIndex={0}>{res.lyrics}</pre>}
        {!(found && !text) && (
          <textarea className="input" rows={5} aria-label={`Lyrics for ${s.title}`} placeholder="Paste lyrics here" value={pasted.get(s.key) || ''}
            onChange={e => setPastedText(s.key, e.target.value)} />
        )}
        {held && (found || text) && <button className="btn btn-primary btn-sm" onClick={() => saveHeld(s)}>Save lyrics</button>}
        {rowError.get(s.key) && <span className="modal-result">{rowError.get(s.key)}</span>}
      </div>
    );
    return { chip: <>{chip} {button}</>, panel };
  };

  const apply = async () => {
    setAdding(true); setResult('');
    try {
      const chosen = new Set([...processKeys, ...rejectKeys]);
      const pastedLyrics = Object.fromEntries([...pasted].filter(([k, t]) => chosen.has(k) && t.trim()));
      const body = { keys: processKeys, rejectKeys };
      if (lyr.state.phase === 'done' && lyr.state.runId) body.lyricsRunId = lyr.state.runId;
      if (Object.keys(pastedLyrics).length) body.pastedLyrics = pastedLyrics;
      const d = await api(`/api/admin/band-check/bands/${artistId}/add`, { method: 'POST', body });
      setAdded(d.added);
      setResult(`Added ${d.added}, rejected ${d.rejected}${d.skippedExisting ? `, ${d.skippedExisting} already held` : ''}${d.notFound ? `, ${d.notFound} no longer listed` : ''}`
        + `${d.lyricsSaved ? `, lyrics saved for ${d.lyricsSaved}` : ''}${d.lyricsFailed && d.lyricsFailed.length ? `, lyrics not saved for: ${d.lyricsFailed.join(', ')}` : ''}${d.lyricsRunMissing ? ' (the fetched lyrics had expired, so only pasted text was saved - fetch again to attach them)' : ''}.`);
      setPasted(p => new Map([...p].filter(([k]) => !chosen.has(k))));
      lyr.reset(); // the applied songs are now held and have their lyrics; a stale run must not label them
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
  const readOk = !error && !!data.counts && data.releases.length > 0 && Object.values(data.sources).every(s => s.status === 'ok');

  return (
    <div>
      {toolbar}
      {error && <div className="admin-message error">{error}</div>}
      {loading && <div className="band-meta" role="status">Reading the sources… this can take several seconds.</div>}
      <RunProgress state={lyr.state} />
      {lyr.state.phase === 'error' && <div className="admin-message error">{lyr.state.message}</div>}
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
          {rel.songs.map(s => { const lb = lyricsBits(s); return (
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
                {lb && lb.chip}
              </div>
              <div className="band-meta">
                {Object.keys(s.sources).map(src => (s.sources[src].url
                  ? <a key={src} className="band-chip" href={s.sources[src].url} target="_blank" rel="noreferrer">{SOURCE_LABEL[src]}</a>
                  : <span key={src} className="band-chip">{SOURCE_LABEL[src]}</span>))}
                {s.state === 'new' && Object.keys(s.sources).length === 1 && <span className="band-chip warn">one source only</span>}
                {s.match && <Link className="band-chip" to={`/admin/song/${s.match.song_id}`} title={s.match.matched_by === 'title' ? 'matched by title' : undefined}>{stateChip(s.match)}</Link>}
              </div>
              {lb && lb.panel}
            </div>
          ); })}
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
