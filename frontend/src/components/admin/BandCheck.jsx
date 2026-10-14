import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

// Band check (sub-project H): pick a band, confirm where it lives on Spotify / Bandcamp / MusicBrainz once,
// then review the merged catalogue and add the ticked songs as pending. Nothing is added without a click.
const SOURCE_LABEL = { spotify: 'Spotify', bandcamp: 'Bandcamp', musicbrainz: 'MusicBrainz' };
const SOURCES = Object.keys(SOURCE_LABEL);
const PAGE = 50;
const PARTIAL = { bandcamp: 'first 40 releases', musicbrainz: 'first 1,000 recordings' };

async function api(path, opts) {
  const r = await adminFetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.message || d.error || 'Request failed');
    err.artist = d.artist; // present on NO_IDENTITY: lets the view open the Identify step with the band's name
    throw err;
  }
  return d;
}

function stateChip(match) {
  if (match.status === 'rejected') return 'rejected';
  if (match.status === 'pending') return 'pending';
  return match.published ? 'live' : 'not live';
}

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
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Done</button>
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

function Review({ artistId, onBack, onAdded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [identify, setIdentify] = useState(null); // null = hidden, else { open: source|null, n } (n re-keys the panel)
  const [result, setResult] = useState('');
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);
  const identifyN = useRef(0);
  const identifyBtn = useRef(null);
  const resultRef = useRef(null);
  const focusResult = useRef(false);

  const openIdentify = useCallback((src) => setIdentify({ open: src, n: ++identifyN.current }), []);

  const load = useCallback(async (fresh) => {
    const my = ++seq.current;
    setError(''); setData(d => (fresh ? d : null));
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}${fresh ? '?fresh=1' : ''}`);
      if (my === seq.current) {
        setData(d);
        if (fresh) { // keep ticks that are still new songs; drop ones that vanished or are now held
          const stillNew = new Set(d.releases.flatMap(r => r.songs).filter(s => s.state === 'new').map(s => s.key));
          setPicked(p => new Set([...p].filter(k => stillNew.has(k))));
        } else { setPicked(new Set()); setIdentify(null); } // a fresh reload leaves the Identify panel as it is
      }
    } catch (e) {
      if (my !== seq.current) return;
      // NO_IDENTITY (409) carries the band: open the Identify step (the card says it all, so no error box)
      if (e.artist) {
        setData({ artist: e.artist, sources: {}, releases: [], counts: null });
        openIdentify(SOURCES.find(s => !(e.artist.identity || {})[s]) || null);
      } else {
        setError(e.message);
        setData(prev => prev || { artist: { id: artistId, name: '', identity: { spotify: null, bandcamp: null, musicbrainz: null } }, sources: {}, releases: [], counts: null });
      }
    }
  }, [artistId, openIdentify]);
  useEffect(() => { load(false); }, [load]);
  // after a successful add the focused Add button unmounts: move focus to the footer message
  useEffect(() => {
    if (result && focusResult.current) { focusResult.current = false; resultRef.current?.focus(); }
  }, [result]);

  const toolbar = (
    <div className="queue-toolbar band-toolbar">
      <button className="btn btn-secondary btn-sm" onClick={onBack}>← All bands</button>
      <h2>{(data && data.artist.name) || 'Band check'}</h2>
      {data && <button ref={identifyBtn} className="btn btn-secondary btn-sm" aria-expanded={!!identify} onClick={() => (identify ? setIdentify(null) : openIdentify(null))}>{identify ? 'Hide sources' : 'Identify sources'}</button>}
      {data && <button className="btn btn-secondary btn-sm" onClick={() => { setResult(''); load(true); }}>Refresh</button>}
    </div>
  );

  if (data === null) return <div>{toolbar}<div className="queue-empty">Reading the sources…</div></div>;
  const newSongs = data.releases.flatMap(r => r.songs).filter(s => s.state === 'new');
  const toggle = (key) => { setResult(''); setPicked(p => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; }); };
  const selectAll = (songs) => { setResult(''); setPicked(p => { const n = new Set(p); songs.filter(s => s.state === 'new').forEach(s => n.add(s.key)); return n; }); };

  const add = async () => {
    setAdding(true); setResult('');
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}/add`, { method: 'POST', body: { keys: [...picked] } });
      setResult(`Added ${d.added}${d.skippedExisting ? `, ${d.skippedExisting} already held` : ''}${d.notFound ? `, ${d.notFound} no longer listed` : ''}.`);
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

  return (
    <div>
      {toolbar}
      {error && <div className="admin-message error">{error}</div>}
      {identify && (
        <IdentifyPanel
          key={identify.n}
          artistId={artistId}
          name={data.artist.name}
          identity={data.artist.identity}
          initialOpen={identify.open}
          onSaved={() => load(true)}
          onDone={() => { setIdentify(null); identifyBtn.current?.focus(); }}
        />
      )}
      {(data.counts || newSongs.length > 0) && (
        <div className="band-counts">
          {data.counts && (
            <div className="band-counts-list band-meta">
              <span>{data.counts.new} new</span><span>{data.counts.in_catalogue} held</span><span>{data.counts.rejected} rejected</span><span>{data.counts.single_source} on one source only</span>
            </div>
          )}
          {newSongs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => selectAll(newSongs)}>Select all new ({newSongs.length})</button>}
        </div>
      )}
      {notes.map(n => (n.source
        ? <button key={n.key} className={`band-note ${n.kind} band-note-btn`} onClick={() => openIdentify(n.source)}>{n.text}</button>
        : <div key={n.key} className={`band-note ${n.kind}`}>{n.text}</div>))}
      {data.releases.map((rel, i) => (
        <section key={`${rel.source}:${rel.name}:${rel.release_date}:${i}`} className="band-release">
          <div className="band-release-head">
            <div><h3>{rel.name}</h3> <span className="band-meta">{rel.album_type || ''} {rel.release_date ? `· ${rel.release_date.slice(0, 4)}` : ''}</span></div>
            {rel.songs.some(s => s.state === 'new') && <button className="btn btn-ghost btn-sm" onClick={() => selectAll(rel.songs)}>Select new</button>}
          </div>
          {rel.songs.map(s => (
            <div key={s.key} className={`inbox-row ${s.state === 'in_catalogue' ? 'band-held' : ''}`}>
              <label>
                {s.state === 'new'
                  ? <input className="band-check" type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />
                  : <span className="band-check" aria-hidden="true" />}
                <strong>{s.title}</strong>
                {s.also_on.length > 0 && <span className="band-meta"> · also on {s.also_on.join(', ')}</span>}
              </label>
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
      {(picked.size > 0 || result) && (
        <div className="band-footer">
          {result && <div ref={resultRef} tabIndex={-1} role="status" className="admin-message success">{result} <Link to="/admin/songs?queue=to-process">Open To be processed</Link></div>}
          {picked.size > 0 && (
            <button className="btn btn-primary" disabled={adding} onClick={add}>
              {adding ? 'Adding…' : `Add ${picked.size} to To be processed`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BandCheck({ onAdded }) {
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
  // "All bands" is Back when the band was opened from the list; a deep link has nothing to go back to, so it pushes
  const back = () => {
    if (fromList.current) { fromList.current = false; navigate(-1); return; }
    update(n => { n.set('queue', 'band-check'); n.delete('artist'); });
  };
  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      {Number.isSafeInteger(artist) && artist > 0
        ? <Review key={artist} artistId={artist} onBack={back} onAdded={onAdded} />
        : <><div className="queue-toolbar"><h2>Band check</h2></div><BandList q={q} offset={offset} onQuery={setQuery} onOffset={setOffset} onPick={pick} /></>}
    </div>
  );
}
export default BandCheck;
