import { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://localhost:5000/api/admin';
const PW = import.meta.env.VITE_ADMIN_PASSWORD;
const auth = { 'X-Admin-Password': PW };
const authJson = { ...auth, 'Content-Type': 'application/json' };

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
      const r = await fetch(`${API_BASE}/staging?queue=${queue}${qs}`, { headers: auth });
      const data = await r.json();
      setRows(data.rows || []); setTotal(data.total || 0);
    } catch (e) { setMsg('Error loading queue'); setRows([]); } finally { setLoading(false); }
  }, [view, liveQ]);

  useEffect(() => { load(); }, [load]);

  async function act(url, body) {
    setMsg('');
    try {
      const r = await fetch(url, { method: 'POST', headers: authJson, body: body ? JSON.stringify(body) : undefined });
      const data = await r.json();
      if (!r.ok) { setMsg(data.error || 'Action failed'); return null; }
      setMsg(data.message || 'Done');
      await load();
      return data;
    } catch (e) { setMsg('Request failed'); return null; }
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
      const r = await fetch(`${API_BASE}/staging/candidates`, { method: 'POST', headers: authJson, body: JSON.stringify({ urls }) });
      const data = await r.json();
      if (!r.ok) { onDone(data.error || 'Import failed'); return; }
      setResult(data);
      onDone(`Imported ${data.added} new, skipped ${data.skippedExisting} existing.`);
    } catch (e) { onDone('Import failed'); } finally { setBusy(false); }
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
    </div>
  );
}
