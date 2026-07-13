import { useState } from 'react';
import { adminFetch } from '../../api/adminApi';

function AddSongPanel({ onClose, onAdded }) {
  const [mode, setMode] = useState('quick'); // 'quick' | 'spotify'
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const quickAdd = async () => {
    if (!title.trim() || !artist.trim()) { setResult('Title and artist are required.'); return; }
    setBusy(true); setResult('');
    try {
      const r = await adminFetch('/api/admin/curation/quick-capture', {
        method: 'POST', body: { title: title.trim(), artist: artist.trim() },
      });
      const d = await r.json();
      if (r.ok && d.success) {
        setResult(`Added "${title.trim()}" to To be processed.`);
        setTitle(''); setArtist(''); onAdded();
      } else setResult(`Error: ${d.error || 'could not add song'}`);
    } catch { setResult('Error: request failed'); }
    finally { setBusy(false); }
  };

  const importSpotify = async () => {
    const list = urls.split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (list.length === 0) { setResult('Paste at least one Spotify URL.'); return; }
    setBusy(true); setResult('');
    try {
      const r = await adminFetch('/api/admin/staging/candidates', { method: 'POST', body: { urls: list } });
      const d = await r.json();
      if (r.ok && d.success) {
        setResult(`Imported ${d.added} as pending · ${d.skippedExisting} already present · ${(d.invalid || []).length} invalid.`);
        setUrls(''); onAdded();
      } else setResult(`Error: ${d.error || 'could not import'}`);
    } catch { setResult('Error: request failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Add a song</h2>
        <div className="modal-tabs">
          <button className={`btn btn-sm ${mode === 'quick' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('quick')}>Quick add</button>
          <button className={`btn btn-sm ${mode === 'spotify' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('spotify')}>From Spotify</button>
        </div>

        {mode === 'quick' ? (
          <>
            <div className="modal-field">
              <label htmlFor="add-title">Title</label>
              <input id="add-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="modal-field">
              <label htmlFor="add-artist">Artist</label>
              <input id="add-artist" className="input" value={artist} onChange={(e) => setArtist(e.target.value)} style={{ width: '100%' }} />
            </div>
          </>
        ) : (
          <div className="modal-field">
            <label htmlFor="add-urls">Spotify track or playlist URLs (space/newline separated)</label>
            <textarea id="add-urls" className="input" rows={4} value={urls} onChange={(e) => setUrls(e.target.value)}
              placeholder="https://open.spotify.com/track/…" style={{ width: '100%' }} />
          </div>
        )}

        {result && <div className="modal-result">{result}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={busy}
            onClick={mode === 'quick' ? quickAdd : importSpotify}>
            {busy ? 'Adding…' : (mode === 'quick' ? 'Add song' : 'Import')}
          </button>
        </div>
      </div>
    </div>
  );
}
export default AddSongPanel;
