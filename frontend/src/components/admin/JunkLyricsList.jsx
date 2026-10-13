import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

const KIND_LABELS = { error: 'Error message', youtube_description: 'YouTube description' };

// Songs whose stored "lyrics" look like a scraper error or a YouTube description. Not junk = keep the text and stop
// flagging it; Clear lyrics = blank the text, so the song falls into Needs lyrics. A flagged song's analysis is hidden
// publicly until the flag clears.
function JunkLyricsList({ refreshKey, onChanged }) {
  const [rows, setRows] = useState(null);   // null = loading
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => {
    adminFetch('/api/admin/junk-lyrics')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      .then(d => { setRows(d.rows || []); })
      .catch(() => { setRows([]); setMsg('Could not load the list.'); });
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const scan = async () => {
    setScanning(true); setMsg('');
    try {
      const r = await adminFetch('/api/admin/junk-lyrics/scan', { method: 'POST', body: {} });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Scan failed');
      setMsg(`Scanned ${d.scanned} lyrics: ${d.flagged} newly flagged, ${d.cleared} cleared.`);
      onChanged();
    } catch (e) { setMsg(e.message); } finally { setScanning(false); }
  };

  const act = async (row, kind) => {
    setBusyId(row.id); setMsg('');
    try {
      const r = kind === 'dismiss'
        ? await adminFetch(`/api/admin/workbench/${row.id}/junk-dismiss`, { method: 'POST', body: {} })
        : await adminFetch(`/api/admin/workbench/${row.id}/lyrics`, { method: 'PUT', body: { lyrics: '' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      onChanged();
    } catch (e) { setMsg(e.message); load(); } finally { setBusyId(null); }
  };

  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar">
        <h2>Junk lyrics</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan for junk lyrics'}
        </button>
      </div>
      <p className="admin-stub">Stored lyrics that look like an error message or a YouTube description. While a song is listed here its analysis is hidden on the public site.</p>
      {msg && <div className="modal-result">{msg}</div>}
      {rows === null ? <div className="queue-empty">Loading…</div>
        : rows.length === 0 ? <div className="queue-empty">Nothing flagged. Run a scan to check every song.</div>
        : rows.map(row => (
          <div key={row.id} className="song-row-wrap junk-row">
            <div className="song-row">
              <span className="song-meta">
                <span className="song-title"><Link to={`/admin/song/${row.id}`}>{row.title}</Link></span>
                <span className="song-artist">{row.artists || '—'}</span>
                <span className="junk-snippet">{row.snippet}</span>
              </span>
              <span className="origin-tag">{KIND_LABELS[row.junk_kind] || row.junk_kind}</span>
              {row.has_analysis && <span className="miss-chip warn">analysis hidden</span>}
            </div>
            <button type="button" className="btn btn-secondary btn-sm song-row-action" disabled={busyId === row.id}
              onClick={() => act(row, 'dismiss')}>Not junk</button>
            <button type="button" className="btn btn-secondary btn-sm song-row-action" disabled={busyId === row.id}
              onClick={() => { if (window.confirm(`Clear the stored lyrics for "${row.title}"?`)) act(row, 'clear'); }}>Clear lyrics</button>
          </div>
        ))}
    </div>
  );
}
export default JunkLyricsList;
