import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '../../api/adminApi';
import { api } from './bandCheckApi';
import { defaultKeeper, previewLines } from '../../utils/mergeText';

// Fold a duplicate artist into the one that stays. The curator picks the other artist, sees which one is kept (Swap flips
// it) and a preview of exactly that direction, then confirms. The server re-checks the preview's hash, so a merge never
// runs on a screen that has gone stale. Nothing here merges without a preview of the direction shown.
function ArtistMergePanel({ artist, initialOther, onMerged }) {
  const self = { id: artist.id, name: artist.name, songs: artist.songs, live_songs: artist.live_songs };
  const [open, setOpen] = useState(initialOther != null);
  const [text, setText] = useState('');
  const [results, setResults] = useState(null);
  const [other, setOther] = useState(null);
  const [keepThis, setKeepThis] = useState(true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewKey, setPreviewKey] = useState(0); // bumps to re-fetch the preview after a stale-merge error

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const choose = (o) => {
    setOther(o); setKeepThis(defaultKeeper(self, o) === 'a'); setPreview(null); setError('');
  };

  // The artist named in the URL (the shared-id notice links here).
  useEffect(() => {
    if (initialOther == null || initialOther === artist.id) return undefined;
    let live = true;
    api(`/api/admin/artists/${initialOther}`)
      .then((o) => { if (live) choose({ id: o.id, name: o.name, songs: o.songs, live_songs: o.live_songs }); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOther, artist.id]);

  // Debounced search by name; only the latest response is applied.
  const searchSeq = useRef(0);
  useEffect(() => {
    const q = text.trim();
    const my = ++searchSeq.current;
    if (q.length < 2) { setResults(null); return undefined; }
    const t = setTimeout(() => {
      api(`/api/admin/artists?q=${encodeURIComponent(q)}&limit=8`)
        .then((d) => { if (my === searchSeq.current) setResults(d.rows.filter((r) => r.id !== artist.id)); })
        .catch(() => { if (my === searchSeq.current) setResults([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [text, artist.id]);

  const keeper = other && (keepThis ? self : other);
  const loser = other && (keepThis ? other : self);

  // The preview of the direction on screen; a stale response (direction swapped, another artist chosen) is dropped.
  const previewSeq = useRef(0);
  useEffect(() => {
    const my = ++previewSeq.current;
    setPreview(null);
    if (!other) return;
    api(`/api/admin/artists/${loser.id}/merge-preview?keeper=${keeper.id}`)
      .then((p) => { if (my === previewSeq.current) { setPreview(p); setError(''); } })
      .catch((e) => { if (my === previewSeq.current) setError(e.message); });
    // keeper and loser derive from other + keepThis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other, keepThis, previewKey]);

  const doMerge = async () => {
    if (!preview || busy) return;
    if (!window.confirm(`Merge "${loser.name}" into "${keeper.name}"? "${loser.name}" will be removed.`)) return;
    setBusy(true); setError('');
    try {
      const r = await adminFetch(`/api/admin/artists/${loser.id}/merge`, { method: 'POST', body: { keeper: keeper.id, hash: preview.hash } });
      const d = await r.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!r.ok) { setError(d.message || d.error || 'The merge failed'); return; }
      window.dispatchEvent(new Event('enrichment-changed')); // the queue counts changed (the loser's proposal is gone)
      if (onMerged) onMerged(keeper.id);
    } catch {
      if (mounted.current) setError('The merge failed');
    } finally { if (mounted.current) setBusy(false); }
  };

  if (!open) {
    return (
      <section className="wb-panel">
        <button className="btn btn-ghost btn-sm" aria-expanded="false" onClick={() => setOpen(true)}>Merge into another artist</button>
      </section>
    );
  }
  return (
    <section className="wb-panel">
      <h2>Merge duplicate artists</h2>
      {error && <div className="admin-message error">{error}{other && <> <button className="btn btn-ghost btn-sm" onClick={() => setPreviewKey((k) => k + 1)}>Refresh preview</button></>}</div>}
      {!other && (
        <>
          <input className="input" aria-label="Find the other artist" placeholder="Find the other artist by name" value={text} onChange={(e) => setText(e.target.value)} />
          {results && results.length === 0 && <div className="band-meta">No other artist found.</div>}
          {results && results.map((r) => (
            <div key={r.id} className="band-cand">
              <div className="band-cand-text"><strong>{r.name}</strong> <span className="band-meta">{r.songs} songs · {r.live_songs} live</span></div>
              <button className="btn btn-secondary btn-sm" onClick={() => choose(r)}>Choose</button>
            </div>
          ))}
          <div><button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button></div>
        </>
      )}
      {other && (
        <>
          <div>Keep <strong>{keeper.name}</strong> ({keeper.songs} songs{keeper.id === artist.id ? ', this artist' : ''}) and remove <strong>{loser.name}</strong> ({loser.songs} songs{loser.id === artist.id ? ', this artist' : ''}).</div>
          <div className="fact-proposal">
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setKeepThis((v) => !v)}>Swap</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setOther(null); setPreview(null); setError(''); setText(''); }}>Choose another</button>
          </div>
          <div aria-live="polite">
            {!preview && !error && <div className="band-meta">Reading both artists…</div>}
            {preview && (
              <ul className="band-meta">
                {previewLines(preview).map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
          </div>
          <div className="fact-proposal">
            <button className="btn btn-primary btn-sm" disabled={busy || !preview} onClick={doMerge}>Merge</button>
          </div>
        </>
      )}
    </section>
  );
}
export default ArtistMergePanel;
