import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import CrosscheckRow from './CrosscheckRow';

const MAX_APPLY = 100;

// Songs > Playlist cross-check: paste a Spotify playlist link, choose Import / Reject per track, apply once.
function PlaylistCrosscheck() {
  const [params, setParams] = useSearchParams();
  const [url, setUrl] = useState(params.get('url') || '');
  const [data, setData] = useState(null);
  const [choices, setChoices] = useState({});
  const [lyrics, setLyrics] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const compare = async (link, { keepResult = false } = {}) => {
    setBusy(true); setError(''); if (!keepResult) setResult(null);
    try {
      const r = await adminFetch(`/api/admin/playlist-crosscheck?url=${encodeURIComponent(link)}${keepResult ? '&fresh=1' : ''}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setData(null); setError(body.message || "Couldn't compare that playlist"); return; }
      setData(body); setChoices({}); setLyrics({});
      setParams({ queue: 'crosscheck', url: link });
    } catch { setData(null); setError("Couldn't compare that playlist"); }
    finally { setBusy(false); }
  };

  const chosenIds = (kind) => Object.keys(choices).filter((id) => choices[id] === kind);
  const total = chosenIds('import').length + chosenIds('reject').length;

  const bulk = (kind) => {
    const next = { ...choices };
    for (const t of data.tracks) if (t.state === 'new') next[t.spotify_id] = kind;
    setChoices(next);
  };

  const apply = async () => {
    setBusy(true); setError('');
    const ids = [...chosenIds('import'), ...chosenIds('reject')];
    // the playlist that was compared, not whatever is typed in the box now
    const body = { url: data.playlist.id, importIds: chosenIds('import'), rejectIds: chosenIds('reject'),
      lyrics: Object.fromEntries(ids.filter((id) => (lyrics[id] || '').trim()).map((id) => [id, lyrics[id]])) };
    try {
      const r = await adminFetch('/api/admin/playlist-crosscheck/apply', { method: 'POST', body });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) { setError(out.message || "Couldn't apply your choices"); setBusy(false); return; }
      setResult(out);
      await compare(data.playlist.id, { keepResult: true });
    } catch { setError("Couldn't apply your choices"); setBusy(false); }
  };

  const c = data && data.counts;
  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar"><h2>Playlist cross-check</h2></div>
      <form className="crosscheck-form" onSubmit={(e) => { e.preventDefault(); compare(url.trim()); }}>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Spotify playlist link" aria-label="Spotify playlist link" />
        <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>Compare</button>
      </form>

      {error && <div className="queue-empty">{error}</div>}
      {result && (
        <div className="crosscheck-result">
          Imported {result.imported} · Rejected {result.rejected} · Lyrics saved {result.lyricsSaved}
          {result.skipped.length > 0 && <> · Skipped {result.skipped.length} ({result.skipped.map((s) => s.reason.replace('_', ' ')).join(', ')})</>}
          {result.lyricsFailed.length > 0 && <> · Lyrics failed for {result.lyricsFailed.length}</>}
        </div>
      )}

      {data && (
        <>
          <div className="crosscheck-summary">
            <span><strong>{data.playlist.name}</strong> — {c.new} new · {c.duplicate} possible duplicates · {c.have} already have
              {data.ignored > 0 && ` · ${data.ignored} ignored (no Spotify id)`}</span>
            <span className="crosscheck-bulk">
              <button type="button" className="btn btn-ghost btn-sm" disabled={!c.new} onClick={() => bulk('import')}>Import all new</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!c.new} onClick={() => bulk('reject')}>Reject all new</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || total === 0 || total > MAX_APPLY} onClick={apply}>Apply ({total})</button>
            </span>
          </div>
          {total > MAX_APPLY && <div className="queue-empty">{MAX_APPLY} at a time</div>}
          {data.tracks.length === 0 && <div className="queue-empty">That playlist has no tracks.</div>}
          {data.tracks.map((row) => (
            <CrosscheckRow key={row.spotify_id} row={row}
              choice={choices[row.spotify_id] || null}
              onChoose={(v) => setChoices((p) => { const n = { ...p }; if (v) n[row.spotify_id] = v; else delete n[row.spotify_id]; return n; })}
              lyrics={lyrics[row.spotify_id] || ''}
              onLyrics={(v) => setLyrics((p) => ({ ...p, [row.spotify_id]: v }))} />
          ))}
        </>
      )}
    </div>
  );
}
export default PlaylistCrosscheck;
