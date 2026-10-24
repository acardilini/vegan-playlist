import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, SOURCES, SOURCE_LABEL } from './bandCheckApi';

// Band check (sub-project H): pick a band, confirm where it lives on Spotify / Bandcamp / MusicBrainz once,
// then review the merged catalogue and add the ticked songs as pending. Nothing is added without a click.
const PAGE = 50;
// The search text is local state (committed to the URL as bq after a pause) so a router transition can never
// reset the input between keystrokes; offset (bp) lives in the URL so Back from a band restores the page.
function BandList({ q, offset, onQuery, onOffset, onPick }) {
  const [text, setText] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // committed = the last value this list wrote to (or read from) the URL; a different q is an outside change to adopt
  const committed = useRef(q);
  useEffect(() => {
    if (q !== committed.current) { committed.current = q; setText(q); }
  }, [q]);
  useEffect(() => {
    if (text === committed.current) return undefined;
    const t = setTimeout(() => { committed.current = text; onQuery(text); }, 250);
    return () => clearTimeout(t);
  }, [text, onQuery]);

  useEffect(() => {
    let live = true;
    api(`/api/admin/band-check/bands?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`)
      .then(d => { if (live) { setData(d); setError(''); } })
      .catch(e => { if (live) { setData(prev => prev || { rows: [], total: 0 }); setError(e.message); } });
    return () => { live = false; };
  }, [q, offset]);

  // a stale ?bp= past the end of the results would strand the curator on an empty page
  useEffect(() => { if (data && data.rows.length === 0 && offset > 0) onOffset(0); }, [data, offset, onOffset]);

  return (
    <div>
      <input className="input input-pill band-search" aria-label="Search bands" placeholder="Search bands by name" value={text} onChange={e => setText(e.target.value)} />
      {error && <div className="admin-message error">{error}</div>}
      {data === null || (data.rows.length === 0 && offset > 0) ? <div className="queue-empty">Loading…</div> : data.rows.length === 0 ?<div className="queue-empty">No bands match.</div> : data.rows.map(b => (
        <div key={b.id} className="inbox-row band-row">
          <div>
            <strong>{b.name}</strong>
            <div className="band-meta">{b.songs} songs · {b.live_songs} live
              {' '}{SOURCES.map(s => {
                const label = `${SOURCE_LABEL[s]}${b.identity[s] ? '' : ' - not identified'}`;
                return <span key={s} role="img" aria-label={label} className={`band-dot ${b.identity[s] ? 'on' : ''}`} title={label}>{SOURCE_LABEL[s][0]}</span>;
              })}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => onPick(b.id, text)}>Check</button>
        </div>
      ))}
      {data && data.total > PAGE && (
        <div className="band-pager">
          <button className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <button className="btn btn-secondary btn-sm" disabled={offset + PAGE >= data.total} onClick={() => onOffset(offset + PAGE)}>Next</button>
        </div>
      )}
    </div>
  );
}

function BandCheck() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const fromList = useRef(false); // true once a band was opened from the list in this session
  const artist = parseInt(params.get('artist'), 10);
  const q = params.get('bq') || '';
  const offset = Math.max(0, parseInt(params.get('bp'), 10) || 0);
  // keep bq/bp across band <-> list so Back restores the search and page; typing/paging replaces history entries
  const update = (fn, opts) => setParams(prev => { const n = new URLSearchParams(prev); fn(n); return n; }, opts);
  const setQuery = (v) => update(n => { if (v) n.set('bq', v); else n.delete('bq'); n.delete('bp'); }, { replace: true });
  const setOffset = (v) => update(n => { if (v > 0) n.set('bp', String(v)); else n.delete('bp'); }, { replace: true });
  // the typed text (possibly not yet committed) is written in the same update, so Back restores exactly what was typed
  // If the text is not committed yet, the list entry is replaced first so Back (which lands on it) restores the typed text.
  const pick = (id, text) => {
    fromList.current = true;
    const list = new URLSearchParams(params);
    const changed = text !== q;
    if (changed) { if (text) list.set('bq', text); else list.delete('bq'); list.delete('bp'); }
    list.set('queue', 'band-check'); list.delete('artist');
    const band = new URLSearchParams(list);
    band.set('artist', String(id));
    if (changed) navigate({ search: `?${list}` }, { replace: true });
    navigate({ search: `?${band}` });
  };
  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      {Number.isSafeInteger(artist) && artist > 0
        ? <p>Moved to Admin &gt; Artists.</p>
        : <><div className="queue-toolbar"><h2>Band check</h2></div><BandList q={q} offset={offset} onQuery={setQuery} onOffset={setOffset} onPick={pick} /></>}
    </div>
  );
}
export default BandCheck;
