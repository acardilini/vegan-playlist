import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

// Band check (sub-project H): pick a band, confirm where it lives on Spotify / Bandcamp / MusicBrainz once,
// then review the merged catalogue and add the ticked songs as pending. Nothing is added without a click.
const SOURCE_LABEL = { spotify: 'Spotify', bandcamp: 'Bandcamp', musicbrainz: 'MusicBrainz' };
const PAGE = 50;

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

function BandList({ onPick }) {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api(`/api/admin/band-check/bands?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`)
        .then(d => { if (live) { setData(d); setError(''); } })
        .catch(e => { if (live) { setData(prev => prev || { rows: [], total: 0 }); setError(e.message); } });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, offset]);
  return (
    <div>
      <input className="admin-input" aria-label="Search bands" placeholder="Search bands by name" value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
      {error && <div className="admin-message error">{error}</div>}
      {data === null ? <div className="queue-empty">Loading…</div> : data.rows.length === 0 ? <div className="queue-empty">No bands match.</div> : data.rows.map(b => (
        <div key={b.id} className="inbox-row band-row">
          <div>
            <strong>{b.name}</strong>
            <div className="band-meta">{b.songs} songs · {b.live_songs} live
              {' '}{Object.keys(SOURCE_LABEL).map(s => <span key={s} className={`band-dot ${b.identity[s] ? 'on' : ''}`} title={`${SOURCE_LABEL[s]}${b.identity[s] ? '' : ' - not identified'}`}>{SOURCE_LABEL[s][0]}</span>)}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => onPick(b.id)}>Check</button>
        </div>
      ))}
      {data && data.total > PAGE && (
        <div className="band-pager">
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <button className="btn" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}
    </div>
  );
}

function IdentifyPanel({ artistId, name, identity, onSaved }) {
  const [source, setSource] = useState('spotify');
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
    setQuery(''); setPaste(''); search(source, '');
    return () => invalidate(); // tab change or unmount: drop any in-flight result
  }, [source, search, invalidate]);

  const shown = cands && cands.source === source ? cands.list : null;

  const save = async (value, src) => {
    if (src === 'spotify' && identity.spotify && identity.spotify !== value && !window.confirm("Replace this band's Spotify match? The old one is not kept.")) return;
    setBusy(true); setError('');
    try { await api(`/api/admin/band-check/bands/${artistId}/identity`, { method: 'PUT', body: { source: src, value } }); await onSaved(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="band-identify">
      <div className="band-tabs">
        {Object.keys(SOURCE_LABEL).map(s => (
          <button key={s} className={`btn ${source === s ? 'btn-primary' : ''}`} aria-pressed={source === s} onClick={() => { setCands(null); setSource(s); }}>
            {SOURCE_LABEL[s]}{identity[s] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <p className="band-meta">Pick the right {SOURCE_LABEL[source]} match for {name}. It is saved, so you only do this once.</p>
      {source !== 'bandcamp' && (
        <form onSubmit={e => { e.preventDefault(); search(source, query); }}>
          <input className="admin-input" aria-label={`Search ${SOURCE_LABEL[source]}`} placeholder={`Search ${SOURCE_LABEL[source]} (default: ${name})`} value={query} onChange={e => setQuery(e.target.value)} />
        </form>
      )}
      {error && <div className="admin-message error">{error}</div>}
      {shown === null ? <div className="queue-empty">Searching…</div> : shown.length === 0 ? <div className="queue-empty">No candidates{source === 'bandcamp' ? ' found - paste the band’s Bandcamp address below' : ''}.</div> : shown.map(c => (
        <div key={c.value} className="inbox-row">
          <div><strong>{c.label}</strong><div className="band-meta">{c.detail}{c.url && <> · <a href={c.url} target="_blank" rel="noreferrer">open</a></>}</div></div>
          <button className="btn btn-primary" disabled={busy || identity[source] === c.value} onClick={() => save(c.value, cands.source)}>{identity[source] === c.value ? 'Chosen' : 'Choose'}</button>
        </div>
      ))}
      {source === 'bandcamp' && (
        <form className="band-paste" onSubmit={e => { e.preventDefault(); save(paste.trim(), source); }}>
          <input className="admin-input" aria-label="Bandcamp address" placeholder="https://bandname.bandcamp.com" value={paste} onChange={e => setPaste(e.target.value)} />
          <button className="btn" disabled={busy || !paste.trim()}>Use this address</button>
        </form>
      )}
      {source !== 'spotify' && identity[source] && <button className="btn" disabled={busy} onClick={() => save(null, source)}>Clear {SOURCE_LABEL[source]}</button>}
    </div>
  );
}

function Review({ artistId, onBack, onAdded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [showIdentify, setShowIdentify] = useState(false);
  const [result, setResult] = useState('');
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (fresh) => {
    const my = ++seq.current;
    setError(''); setData(d => (fresh ? d : null));
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}${fresh ? '?fresh=1' : ''}`);
      if (my === seq.current) { setData(d); setPicked(new Set()); if (!fresh) setShowIdentify(false); } // a fresh reload leaves the Identify panel as it is
    } catch (e) {
      if (my !== seq.current) return;
      setError(e.message);
      // NO_IDENTITY (409) carries the band: open the Identify step instead of leaving the view empty
      if (e.artist) { setShowIdentify(true); setData({ artist: e.artist, sources: {}, releases: [], counts: null }); }
      else setData(prev => prev || { artist: { id: artistId, name: '', identity: { spotify: null, bandcamp: null, musicbrainz: null } }, sources: {}, releases: [], counts: null });
    }
  }, [artistId]);
  useEffect(() => { load(false); }, [load]);

  if (data === null) return <div className="queue-empty">Reading the sources…</div>;
  const newSongs = data.releases.flatMap(r => r.songs).filter(s => s.state === 'new');
  const toggle = (key) => setPicked(p => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const selectAll = (songs) => setPicked(p => { const n = new Set(p); songs.filter(s => s.state === 'new').forEach(s => n.add(s.key)); return n; });

  const add = async () => {
    setAdding(true); setResult('');
    try {
      const d = await api(`/api/admin/band-check/bands/${artistId}/add`, { method: 'POST', body: { keys: [...picked] } });
      setResult(`Added ${d.added}${d.skippedExisting ? `, ${d.skippedExisting} already held` : ''}${d.notFound ? `, ${d.notFound} no longer listed` : ''}.`);
      onAdded?.();
      await load(true);
    } catch (e) { setError(e.message); } finally { setAdding(false); }
  };

  return (
    <div>
      <div className="queue-toolbar">
        <button className="btn" onClick={onBack}>← All bands</button>
        <h2>{data.artist.name || 'Band check'}</h2>
        <button className="btn" onClick={() => setShowIdentify(s => !s)}>Identify sources</button>
        <button className="btn" onClick={() => load(true)}>Refresh</button>
      </div>
      {error && <div className="admin-message error">{error}</div>}
      {result && <div className="admin-message success">{result} <Link to="/admin/songs?queue=to-process">Open To be processed</Link></div>}
      <div className="band-meta">
        {Object.entries(data.sources).map(([s, st]) => {
          const partial = st.truncated ? (s === 'bandcamp' ? ' (partial: first 40 releases)' : s === 'musicbrainz' ? ' (partial: first 1,000 recordings)' : '') : '';
          const otherSongs = Object.entries(data.sources).some(([o, os]) => o !== s && os.status === 'ok' && os.songs > 0);
          const suspect = st.status === 'ok' && st.songs > 0 && st.overlap === 0 && (otherSongs || data.artist.songs > 0);
          return (
            <span key={s}>
              <span className={`band-chip ${st.status}`}>{SOURCE_LABEL[s]}: {st.status === 'ok' ? `read${partial}` : (st.message || 'could not be read this time')}</span>
              {suspect && <span className="band-chip warn">{SOURCE_LABEL[s]} shares no songs with the other sources or the catalogue - check it is the right band</span>}
            </span>
          );
        })}
        {data.counts && <span> · {data.counts.new} new · {data.counts.in_catalogue} held · {data.counts.rejected} rejected · {data.counts.single_source} on one source only</span>}
      </div>
      {showIdentify && <IdentifyPanel artistId={artistId} name={data.artist.name} identity={data.artist.identity} onSaved={() => load(true)} />}
      {newSongs.length > 0 && <button className="btn" onClick={() => selectAll(newSongs)}>Select all new ({newSongs.length})</button>}
      {data.releases.map((rel, i) => (
        <section key={`${rel.source}:${rel.name}:${rel.release_date}:${i}`} className="band-release">
          <h3>{rel.name} <span className="band-meta">{rel.album_type || ''} {rel.release_date ? `· ${rel.release_date.slice(0, 4)}` : ''}</span>
            {rel.songs.some(s => s.state === 'new') && <button className="btn btn-small" onClick={() => selectAll(rel.songs)}>Select new</button>}
          </h3>
          {rel.songs.map(s => (
            <div key={s.key} className={`inbox-row ${s.state === 'in_catalogue' ? 'band-held' : ''}`}>
              <label>
                {s.state === 'new' && <input type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />}{' '}
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
      <div className="band-footer">
        <button className="btn btn-primary" disabled={picked.size === 0 || adding} onClick={add}>
          {adding ? 'Adding…' : `Add ${picked.size} to To be processed`}
        </button>
      </div>
    </div>
  );
}

function BandCheck({ onAdded }) {
  const [params, setParams] = useSearchParams();
  const artist = parseInt(params.get('artist'), 10);
  const pick = (id) => setParams({ queue: 'band-check', artist: String(id) });
  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      {Number.isSafeInteger(artist) && artist > 0
        ? <Review key={artist} artistId={artist} onBack={() => setParams({ queue: 'band-check' })} onAdded={onAdded} />
        : <><div className="queue-toolbar"><h2>Band check</h2></div><BandList onPick={pick} /></>}
    </div>
  );
}
export default BandCheck;
