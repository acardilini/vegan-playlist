import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '../api/adminApi';

const API_BASE = '/api/admin';

const SUBVIEWS = [
  ['to-process', 'To process'],
  ['to-finalise', 'To finalise'],
  ['live', 'Live'],
  ['add', 'Add candidates'],
];
const QUEUE_PARAM = { 'to-process': 'pending', 'to-finalise': 'to-finalise', 'live': 'live' };

export default function StagingQueue() {
  const [view, setView] = useState('to-process');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [liveQ, setLiveQ] = useState('');

  const load = useCallback(async () => {
    if (view === 'add') return;
    const queue = QUEUE_PARAM[view];
    if (queue === 'live' && !liveQ.trim()) { setRows([]); setTotal(0); return; }
    setLoading(true);
    try {
      const qs = queue === 'live' ? `&q=${encodeURIComponent(liveQ.trim())}` : '';
      const r = await adminFetch(`${API_BASE}/staging?queue=${queue}${qs}`);
      const data = await r.json();
      setRows(data.rows || []); setTotal(data.total || 0);
    } catch { setMsg('Error loading queue'); setRows([]); } finally { setLoading(false); }
  }, [view, liveQ]);

  useEffect(() => { load(); }, [load]);

  async function act(url, body) {
    setMsg('');
    try {
      const r = await adminFetch(url, { method: 'POST', body });
      const data = await r.json();
      if (!r.ok) { setMsg(data.error || 'Action failed'); return null; }
      setMsg(data.message || 'Done');
      await load();
      return data;
    } catch { setMsg('Request failed'); return null; }
  }

  const include = (id, publish) => act(`${API_BASE}/songs/${id}/include`, { publish: !!publish });
  const reject = (id) => act(`${API_BASE}/songs/${id}/reject`);
  const publish = (id) => act(`${API_BASE}/songs/${id}/publish`);
  const unpublish = (id) => act(`${API_BASE}/songs/${id}/unpublish`);
  const attach = (id) => act(`${API_BASE}/songs/${id}/attach-spotify`);
  const addLink = (id) => {
    const url = window.prompt('Bandcamp or SoundCloud URL:');
    if (!url) return;
    const key = /soundcloud/i.test(url) ? 'soundcloud_url' : 'bandcamp_url';
    return act(`${API_BASE}/songs/${id}/play-link`, { [key]: url });
  };

  const badge = (ok, label) => (
    <span style={{ marginRight: 8, color: ok ? '#1a7f37' : '#b00', fontSize: 12 }}>{ok ? '✓' : '✗'} {label}</span>
  );

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {SUBVIEWS.map(([k, label]) => (
          <button key={k} onClick={() => { setView(k); setMsg(''); }}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
              background: view === k ? '#007bff' : '#fff', color: view === k ? '#fff' : '#333', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>
      {msg && <div style={{ marginBottom: 10, padding: 8, background: '#f0f6ff', border: '1px solid #cfe0ff', borderRadius: 6 }}>{msg}</div>}

      {view === 'add' ? (
        <AddCandidates onDone={setMsg} />
      ) : (
        <>
          {view === 'live' && (
            <input value={liveQ} onChange={e => setLiveQ(e.target.value)} placeholder="Search published songs to unpublish…"
              style={{ padding: 8, width: 320, marginBottom: 12 }} />
          )}
          <div style={{ marginBottom: 8, color: '#555' }}>{loading ? 'Loading…' : `${total} song(s)`}</div>
          {rows.map(row => (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 10px', borderBottom: '1px solid #eee', gap: 10 }}>
              <div>
                <strong>{row.title}</strong> <span style={{ color: '#666' }}>— {row.artists}</span>
                <div style={{ marginTop: 4 }}>
                  {badge(row.has_play_link, row.play_link_kinds.join('/') || 'play link')}
                  {badge(row.has_art, 'artwork')}
                  {view === 'to-finalise' && row.missing && row.missing.length > 0 &&
                    <span style={{ color: '#b00', fontSize: 12 }}>⚠ missing: {row.missing.join(', ')}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {view !== 'live' && <button onClick={() => attach(row.id)}>Attach Spotify</button>}
                {view !== 'live' && <button onClick={() => addLink(row.id)}>Add play link</button>}
                {view === 'to-process' && <>
                  <button onClick={() => include(row.id, false)}>Include</button>
                  {row.has_play_link && row.has_art &&
                    <button onClick={() => include(row.id, true)} style={{ background: '#1a7f37', color: '#fff' }}>Include &amp; Publish</button>}
                  <button onClick={() => reject(row.id)} style={{ color: '#b00' }}>Reject</button>
                </>}
                {view === 'to-finalise' && <button onClick={() => publish(row.id)} style={{ background: '#1a7f37', color: '#fff' }}>Publish</button>}
                {view === 'live' && <button onClick={() => unpublish(row.id)}>Unpublish</button>}
              </div>
            </div>
          ))}
          {!loading && rows.length === 0 && view !== 'live' && <div style={{ color: '#888' }}>Queue empty 🎉</div>}
        </>
      )}
    </div>
  );
}

function AddCandidates({ onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit() {
    const urls = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (urls.length === 0) return;
    setBusy(true); setResult(null);
    try {
      const r = await adminFetch(`${API_BASE}/staging/candidates`, { method: 'POST', body: { urls } });
      const data = await r.json();
      if (!r.ok) { onDone(data.error || 'Import failed'); return; }
      setResult(data);
      onDone(`Imported ${data.added} new, skipped ${data.skippedExisting} existing.`);
    } catch { onDone('Import failed'); } finally { setBusy(false); }
  }

  return (
    <div>
      <p style={{ color: '#555' }}>Paste Spotify <strong>track</strong> or <strong>playlist</strong> URLs, one per line. New songs are imported as <em>pending</em>.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={8} style={{ width: '100%', fontFamily: 'monospace' }}
        placeholder="https://open.spotify.com/track/…" />
      <div style={{ marginTop: 8 }}>
        <button onClick={submit} disabled={busy}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
      {result && <pre style={{ marginTop: 10 }}>{JSON.stringify(result, null, 2)}</pre>}

      <SyncPanel />
    </div>
  );
}

// Import-only sync + read-only mismatch report against the default Spotify
// playlist ("Animal Lib & Vegan Songs"). Same backend as the URL intake above
// (utils/playlistSync.js) — moved here from Duplicate Manager per the 2026-07-08
// admin audit so all song intake lives in the Staging tab.
function SyncPanel() {
  const [busy, setBusy] = useState('');
  const [sync, setSync] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  async function runSync() {
    if (!confirm('Import-only sync: any playlist tracks missing from the catalogue are added as pending. Nothing is ever changed or removed. Continue?')) return;
    setBusy('sync'); setError(''); setSync(null);
    try {
      const r = await adminFetch(`${API_BASE}/sync-spotify-playlist`, { method: 'POST', body: {} });
      const data = await r.json();
      if (!r.ok || !data.success) { setError(data.error || 'Sync failed'); return; }
      setSync(data);
    } catch { setError('Sync failed'); } finally { setBusy(''); }
  }

  async function runReport() {
    setBusy('report'); setError(''); setReport(null);
    try {
      const r = await adminFetch(`${API_BASE}/spotify-playlist-mismatch`);
      const data = await r.json();
      if (!r.ok || !data.success) { setError(data.error || 'Report failed'); return; }
      setReport(data);
    } catch { setError('Report failed'); } finally { setBusy(''); }
  }

  const songLine = (s, i) => (
    <li key={s.spotify_id || s.id || i}>
      <strong>{s.title}</strong> — {s.artists}
    </li>
  );

  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #ddd' }}>
      <h3 style={{ margin: '0 0 4px' }}>Spotify playlist sync</h3>
      <p style={{ color: '#555', marginTop: 0 }}>
        Runs against the curated playlist (Animal Lib &amp; Vegan Songs). <strong>Import-only:</strong> new
        playlist tracks land in <em>To process</em> as pending; the mismatch report is read-only.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={runSync} disabled={!!busy}>
          {busy === 'sync' ? 'Syncing…' : 'Sync from playlist'}
        </button>
        <button onClick={runReport} disabled={!!busy}>
          {busy === 'report' ? 'Checking…' : 'Check playlist mismatch'}
        </button>
      </div>
      {error && <div style={{ marginTop: 10, color: '#b00' }}>{error}</div>}

      {sync && (
        <div style={{ marginTop: 12, padding: 10, background: '#f0f6ff', border: '1px solid #cfe0ff', borderRadius: 6 }}>
          <div>{sync.message}</div>
          <div style={{ marginTop: 6, fontSize: 13, color: '#555' }}>
            Playlist tracks: {sync.summary.playlistTracks} · Added as pending: {sync.summary.addedAsPending} ·
            Included not on playlist: {sync.summary.includedNotOnPlaylist}
          </div>
          {sync.addedSongs && sync.addedSongs.length > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 600 }}>Added (first {sync.addedSongs.length}):</div>
              <ul style={{ margin: '4px 0 0 18px' }}>{sync.addedSongs.map(songLine)}</ul>
            </>
          )}
        </div>
      )}

      {report && (
        <div style={{ marginTop: 12, padding: 10, background: '#fffdf0', border: '1px solid #eee0a0', borderRadius: 6 }}>
          <div>{report.message}</div>
          {report.mismatchSongs.length > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 600 }}>
                Included songs not on the Spotify playlist ({report.mismatchSongs.length}) — add to Spotify by hand if desired:
              </div>
              <ul style={{ margin: '4px 0 0 18px', maxHeight: 260, overflowY: 'auto' }}>
                {report.mismatchSongs.map(songLine)}
              </ul>
            </>
          )}
          {report.playlistTracksNotInCatalogue.length > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 600 }}>
                Playlist tracks not in the catalogue ({report.playlistTracksNotInCatalogue.length}) — run the sync to add as pending:
              </div>
              <ul style={{ margin: '4px 0 0 18px', maxHeight: 260, overflowY: 'auto' }}>
                {report.playlistTracksNotInCatalogue.map(songLine)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
