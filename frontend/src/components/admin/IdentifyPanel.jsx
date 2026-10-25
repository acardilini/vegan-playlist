import { useEffect, useState, useCallback, useRef } from 'react';
import { api, SOURCES, SOURCE_LABEL } from './bandCheckApi';

function openLink(src, value) {
  if (src === 'spotify') return `https://open.spotify.com/artist/${value}`;
  if (src === 'musicbrainz') return `https://musicbrainz.org/artist/${value}`;
  return value; // bandcamp: the stored origin
}

function hostOf(value) {
  try { return new URL(value).hostname; } catch { return value; }
}

// One card, three compact rows, one expanded at a time; candidates are fetched only for the expanded row.
// initialOpen is the row to expand on mount (null = all collapsed).
function IdentifyPanel({ artistId, name, identity, initialOpen, onSaved, onDone }) {
  const [open, setOpen] = useState(initialOpen);
  const [cands, setCands] = useState(null);
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const seq = useRef(0);
  const invalidate = useCallback(() => { seq.current++; }, []);

  // cands = { source, list }: remembers which source the list was fetched for; only the latest request is applied
  const search = useCallback(async (src, q) => {
    const my = ++seq.current;
    setCands(null); setError('');
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}/candidates?source=${src}&q=${encodeURIComponent(q || '')}`);
      if (my === seq.current) setCands({ source: src, list: d.candidates });
    } catch (e) { if (my === seq.current) { setCands({ source: src, list: [] }); setError(e.message); } }
  }, [artistId]);
  useEffect(() => {
    setQuery(''); setPaste('');
    if (open) search(open, ''); else setCands(null);
    return () => invalidate(); // row change or unmount: drop any in-flight result
  }, [open, search, invalidate]);

  const shown = open && cands && cands.source === open ? cands.list : null;

  const save = async (value, src) => {
    if (src === 'spotify' && identity.spotify && identity.spotify !== value && !window.confirm("Replace this band's Spotify match? The old one is not kept.")) return;
    setBusy(true); setError('');
    try { await api(`/api/admin/band-check/bands/${artistId}/identity`, { method: 'PUT', body: { source: src, value } }); await onSaved(); setOpen(null); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="band-identify">
      <div className="band-identify-head">
        <strong>Identify sources</strong>
        {onDone && <button className="btn btn-ghost btn-sm" onClick={onDone}>Done</button>}
      </div>
      {error && <div className="admin-message error">{error}</div>}
      {SOURCES.map(s => {
        const saved = identity[s];
        const isOpen = open === s;
        return (
          <div key={s} className="band-source">
            <div className="band-source-row">
              <span className="band-source-name">{SOURCE_LABEL[s]}</span>
              <span className="band-source-status">
                {saved
                  ? (s === 'bandcamp'
                    ? <span className="band-saved"><span>✓</span><a className="band-host" href={openLink(s, saved)} target="_blank" rel="noreferrer">{hostOf(saved)} ↗</a></span>
                    : <>✓ saved · <a href={openLink(s, saved)} target="_blank" rel="noreferrer">open ↗</a></>)
                  : <span className="band-muted">not set</span>}
              </span>
              <span className="band-source-actions">
                {saved && s !== 'spotify' && <button className="band-link-btn" disabled={busy} onClick={() => save(null, s)}>Clear</button>}
                <button className="btn btn-ghost btn-sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s)}>{isOpen ? 'Close' : saved ? 'Change' : 'Find'}</button>
              </span>
            </div>
            {isOpen && (
              <div className="band-source-body">
                {s !== 'bandcamp' && (
                  <form onSubmit={e => { e.preventDefault(); search(s, query); }}>
                    <input className="input" aria-label={`Search ${SOURCE_LABEL[s]}`} placeholder={`Search ${SOURCE_LABEL[s]} (default: ${name})`} value={query} onChange={e => setQuery(e.target.value)} />
                  </form>
                )}
                {shown === null ? <div className="band-muted">Searching…</div>
                  : shown.length === 0 && s !== 'bandcamp' ? <div className="band-muted">No matches.</div>
                  : shown.map(c => (
                    <div key={c.value} className="band-cand">
                      <div className="band-cand-text"><strong>{c.label}</strong> <span className="band-muted">{c.detail}</span>{c.url && <> <a href={c.url} target="_blank" rel="noreferrer">open</a></>}</div>
                      <button className="btn btn-secondary btn-sm" disabled={busy || saved === c.value} onClick={() => save(c.value, cands.source)}>{saved === c.value ? 'Chosen' : 'Choose'}</button>
                    </div>
                  ))}
                {s === 'bandcamp' && (
                  <form className="band-paste" onSubmit={e => { e.preventDefault(); save(paste.trim(), s); }}>
                    <span className="band-muted">{shown !== null && shown.length === 0 ? 'No page found automatically. Paste its address:' : 'Or paste an address:'}</span>
                    <input className="input" aria-label="Bandcamp address" placeholder="https://name.bandcamp.com" value={paste} onChange={e => setPaste(e.target.value)} />
                    <button className="btn btn-ghost btn-sm" disabled={busy || !paste.trim()}>Use</button>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default IdentifyPanel;
