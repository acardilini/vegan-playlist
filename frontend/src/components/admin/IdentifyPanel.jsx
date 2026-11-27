import { useEffect, useState, useCallback, useRef } from 'react';
import { api, SOURCES, SOURCE_LABEL } from './bandCheckApi';
import { parseMusicBrainzId } from '../../utils/musicbrainzId';
import { methodLabel, confidenceLabel } from '../../utils/enrichmentText';

function openLink(src, value) {
  if (src === 'spotify') return `https://open.spotify.com/artist/${value}`;
  if (src === 'musicbrainz') return `https://musicbrainz.org/artist/${value}`;
  return value; // bandcamp: the stored origin
}

function hostOf(value) {
  try { return new URL(value).hostname; } catch { return value; }
}

// Three table rows (Spotify, MusicBrainz, Bandcamp), one expanded at a time; candidates are fetched only for the expanded row.
// initialOpen is the row to expand on mount (null = all collapsed). renderAfterRow(source) adds content under a row.
function IdentifyPanel({ artistId, name, identity, initialOpen, onSaved, renderAfterRow }) {
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

  // The analysis project's proposed MusicBrainz id, offered first when the MusicBrainz row is open. Errors are ignored (no proposal).
  const [proposal, setProposal] = useState(null);
  const propSeq = useRef(0);
  useEffect(() => {
    const my = ++propSeq.current;
    setProposal(null);
    if (open !== 'musicbrainz') return;
    // a later open/close bumps propSeq above, so a stale response is dropped
    api(`/api/admin/artists/${artistId}/enrichment`)
      .then((r) => { if (my === propSeq.current && r && r.has_proposal && r.match && r.match.proposed_mbid) setProposal(r.match); })
      .catch(() => {});
  }, [open, artistId]);

  const shown = open && cands && cands.source === open ? cands.list : null;
  const proposedId = open === 'musicbrainz' && proposal && proposal.proposed_mbid !== identity.musicbrainz ? proposal : null;

  const saveMusicBrainzPaste = () => {
    const id = parseMusicBrainzId(paste);
    if (!id) { setError('That is not a MusicBrainz artist link or id'); return; }
    save(id, 'musicbrainz');
  };
  const clear = (s) => {
    if (window.confirm(`Clear the saved ${SOURCE_LABEL[s]} link?`)) save(null, s);
  };

  const save = async (value, src) => {
    if (src === 'spotify' && identity.spotify && identity.spotify !== value && !window.confirm("Replace this band's Spotify match? The old one is not kept.")) return;
    setBusy(true); setError('');
    try { await api(`/api/admin/band-check/bands/${artistId}/identity`, { method: 'PUT', body: { source: src, value } }); await onSaved(); setOpen(null); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="aw-identify">
      {error && <div className="admin-message error">{error}</div>}
      <ul className="adm-list">
        {SOURCES.map(s => {
          const saved = identity[s];
          const isOpen = open === s;
          return (
            <li key={s} id={`aw-row-${s}`} className="aw-source">
              <div className="adm-row adm-wrap">
                <span className="adm-col-label">{SOURCE_LABEL[s]}</span>
                <span className="adm-col-name">
                  {saved
                    ? <a href={openLink(s, saved)} target="_blank" rel="noreferrer">{s === 'bandcamp' ? hostOf(saved) : saved}</a>
                    : <span className="band-muted">not set</span>}
                </span>
                <span className={`adm-pill ${saved ? 'is-ok' : 'is-todo'}`}>{saved ? 'saved' : 'not set'}</span>
                <span className="aw-source-actions">
                  {saved && <a className="btn btn-ghost btn-sm" href={openLink(s, saved)} target="_blank" rel="noreferrer">Open ↗</a>}
                  {saved && s !== 'spotify' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => clear(s)}>Clear</button>}
                  <button className="btn btn-ghost btn-sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s)}>{isOpen ? 'Close' : saved ? 'Change' : 'Find'}</button>
                </span>
                {isOpen && (
                  <div className="aw-source-body">
                    {s !== 'bandcamp' && (
                      <form onSubmit={e => { e.preventDefault(); search(s, query); }}>
                        <input className="input" aria-label={`Search ${SOURCE_LABEL[s]}`} placeholder={`Search ${SOURCE_LABEL[s]} (default: ${name})`} value={query} onChange={e => setQuery(e.target.value)} />
                      </form>
                    )}
                    {proposedId && (
                      <div className="band-cand">
                        <div className="band-cand-text">
                          <strong>Proposed by the enrichment</strong>{' '}
                          <span className="band-muted">{methodLabel(proposedId.method)}{proposedId.confidence && ` · ${confidenceLabel(proposedId.confidence)}`}</span>
                          {proposedId.url && <> <a href={proposedId.url} target="_blank" rel="noreferrer">open</a></>}
                        </div>
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(proposedId.proposed_mbid, 'musicbrainz')}>Choose</button>
                      </div>
                    )}
                    {shown === null ? <div className="band-muted">Searching…</div>
                      : shown.length === 0 && s !== 'bandcamp' ? <div className="band-muted">No matches.</div>
                      : shown.map(c => (
                        <div key={c.value} className="band-cand">
                          <div className="band-cand-text"><strong>{c.label}</strong> <span className="band-muted">{c.detail}</span>{c.url && <> <a href={c.url} target="_blank" rel="noreferrer">open</a></>}</div>
                          <button className="btn btn-secondary btn-sm" disabled={busy || saved === c.value} onClick={() => save(c.value, cands.source)}>{saved === c.value ? 'Chosen' : 'Choose'}</button>
                        </div>
                      ))}
                    {s === 'musicbrainz' && (
                      <form className="band-paste" onSubmit={e => { e.preventDefault(); saveMusicBrainzPaste(); }}>
                        <span className="band-muted">Or paste a MusicBrainz link or id:</span>
                        <input className="input" aria-label="MusicBrainz link or id" placeholder="https://musicbrainz.org/artist/…" value={paste} onChange={e => setPaste(e.target.value)} />
                        <button className="btn btn-ghost btn-sm" disabled={busy || !parseMusicBrainzId(paste)}>Use</button>
                      </form>
                    )}
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
              {renderAfterRow && renderAfterRow(s)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default IdentifyPanel;
