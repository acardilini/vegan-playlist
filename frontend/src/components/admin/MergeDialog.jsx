import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '../../api/adminApi';
import { api } from './bandCheckApi';
import { defaultKeeper, previewLines } from '../../utils/mergeText';

const songsText = (n) => `${n} ${n === 1 ? 'song' : 'songs'}`;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function ArtistCard({ tone, title, a, isThis }) {
  return (
    <div className={`aw-card ${tone}`}>
      <div className="aw-card-title">{title}</div>
      <div><strong>{a.name}</strong>{isThis && <span className="band-meta"> (this artist)</span>}</div>
      <div className="band-meta">{songsText(a.songs)} · {a.live_songs} live</div>
      <div className="band-meta">id {a.id}</div>
    </div>
  );
}

// Fold a duplicate artist into the one that stays, in a dialog. The curator picks the other artist, sees which one is kept
// (Swap direction flips it) and a preview of exactly that direction, then confirms with a button that names what it deletes.
// The server re-checks the preview's hash, so a merge never runs on a screen that has gone stale. The opener restores focus
// in onClose.
function MergeDialog({ artist, initialOther, onClose, onMerged }) {
  const self = { id: artist.id, name: artist.name, songs: artist.songs, live_songs: artist.live_songs };
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
  const dialogRef = useRef(null);

  const choose = (o) => {
    setOther(o); setKeepThis(defaultKeeper(self, o) === 'a'); setPreview(null); setError('');
  };

  // The artist named in the URL (the banner's Review merge links here).
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

  const close = () => { if (!busy) onClose(); };

  // Focus into the dialog: the search box, or Swap once an artist is chosen.
  const stage = other ? 'chosen' : 'search';
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const target = stage === 'chosen' ? root.querySelector('[data-aw-first]') : root.querySelector('input');
    if (target) target.focus();
  }, [stage]);

  // Escape closes and Tab stays inside, unless a merge is running (then Escape does nothing).
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="aw-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="aw-dialog" role="dialog" aria-modal="true" aria-labelledby="aw-merge-title" ref={dialogRef} onKeyDown={onKeyDown}>
        <h2 id="aw-merge-title">Merge two artists</h2>
        {error && (
          <div className="admin-message error">
            {error}{other && <> <button className="btn btn-ghost btn-sm" onClick={() => setPreviewKey((k) => k + 1)}>Refresh preview</button></>}
          </div>
        )}

        {!other && (
          <>
            <input className="input" aria-label="Find the other artist" placeholder="Find the other artist by name" value={text} onChange={(e) => setText(e.target.value)} />
            {results && results.length === 0 && <div className="band-meta">No other artist found.</div>}
            {results && results.map((r) => (
              <div key={r.id} className="band-cand">
                <div className="band-cand-text"><strong>{r.name}</strong> <span className="band-meta">{songsText(r.songs)} · {r.live_songs} live</span></div>
                <button className="btn btn-secondary btn-sm" onClick={() => choose(r)}>Choose</button>
              </div>
            ))}
          </>
        )}

        {other && (
          <>
            <div className="aw-cards">
              <ArtistCard tone="is-keep" title="Stays" a={keeper} isThis={keeper.id === artist.id} />
              <ArtistCard tone="is-gone" title="Disappears" a={loser} isThis={loser.id === artist.id} />
            </div>
            <div className="adm-actions">
              <button className="btn btn-secondary btn-sm" data-aw-first disabled={busy} onClick={() => setKeepThis((v) => !v)}>Swap direction</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setOther(null); setPreview(null); setError(''); setText(''); }}>Choose another</button>
              <span className="band-meta">Default: the one with more songs stays</span>
            </div>
            <div aria-live="polite">
              {!preview && !error && <div className="band-meta">Reading both artists…</div>}
              {preview && (
                <ul className="aw-sum">
                  {previewLines(preview).map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              )}
            </div>
          </>
        )}

        <div className="aw-dialog-actions">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={close}>Cancel</button>
          {other && (
            <button className="btn btn-sm aw-danger" disabled={busy || !preview} onClick={doMerge}>
              {busy ? 'Merging…' : `Merge: delete ${loser.name}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
export default MergeDialog;
