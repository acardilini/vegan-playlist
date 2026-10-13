import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '../../api/adminApi';

const RETURN_MSG = {
  connected: 'Spotify connected.',
  denied: 'Spotify sign-in was cancelled.',
  failed: 'Spotify sign-in failed — try again.',
};

function takeReturnMessage() {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('spotify');
  if (!key) return '';
  params.delete('spotify');
  const qs = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  return RETURN_MSG[key] || '';
}

function SpotifySyncCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState(takeReturnMessage);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => (
    adminFetch('/api/admin/spotify/compare')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('compare failed'))))
      .then(d => { setData(d); setError(''); })
      .catch(() => { setData(null); setError("Couldn't read the Spotify playlist"); })
  ), []);

  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await adminFetch('/api/spotify-auth/start', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.url) { window.location.href = d.url; return; }
      setMsg('Could not start Spotify sign-in.');
    } catch { setMsg('Could not start Spotify sign-in.'); }
    setBusy(false);
  };

  const pull = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await adminFetch('/api/admin/sync-spotify-playlist', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setMsg(`Added ${d.summary?.addedAsPending ?? 0} to To be processed.`);
      else setMsg(d.error || 'Pull failed.');
    } catch { setMsg('Pull failed.'); }
    await load();
    setBusy(false);
  };

  const push = async () => {
    const songIds = (data?.pushable || []).map(s => s.id);
    setBusy(true);
    setMsg('');
    try {
      const r = await adminFetch('/api/admin/spotify/push', { method: 'POST', body: { songIds } });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg(`Added ${(d.added || []).length}, already there ${d.alreadyThere ?? 0}.`);
      } else if (r.status === 409 && d.error === 'BUSY') {
        setMsg('A push is already running — wait a moment and reload.');
      } else if (r.status === 409) {
        setMsg('Connect Spotify first.');
      } else if (r.status === 502 && d.message) {
        setMsg(`${d.message} Added so far: ${(d.added || []).length}`);
      } else {
        setMsg('Push failed.');
      }
    } catch { setMsg('Push failed.'); }
    setConfirming(false);
    await load();
    setBusy(false);
  };

  if (error) return <p className="queue-empty">{error}</p>;
  if (!data) return <p className="dash-health">·</p>;

  const { pullable = [], pushable = [], noSpotifyId = [], onPlaylistNotLive = [] } = data;

  return (
    <div className="spotify-sync">
      {msg && <div className="modal-result">{msg}</div>}

      <p className="dash-health">
        {data.connected
          ? 'Spotify connected'
          : <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={connect}>Connect Spotify</button>}
      </p>

      <p className="dash-health">
        {pullable.length} on the playlist, not on the site{' '}
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || pullable.length === 0} onClick={pull}>
          Pull {pullable.length} as pending
        </button>
      </p>

      <p className="dash-health">
        {pushable.length} live songs not on the playlist{' '}
        <button type="button" className="btn btn-secondary btn-sm"
          disabled={busy || pushable.length === 0 || !data.connected} onClick={() => setConfirming(true)}>
          Push {pushable.length} to Spotify
        </button>
      </p>

      {confirming && (
        <div>
          <ul style={{ maxHeight: '14rem', overflowY: 'auto' }}>
            {pushable.map(s => <li key={s.id}>{s.title} — {s.artists}</li>)}
          </ul>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || pushable.length === 0} onClick={push}>Confirm push</button>{' '}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}

      {noSpotifyId.length > 0 && (
        <p className="dash-health">{noSpotifyId.length} live songs have no Spotify link (can&rsquo;t be pushed)</p>
      )}
      {onPlaylistNotLive.length > 0 && (
        <p className="dash-health">{onPlaylistNotLive.length} on the playlist but not live</p>
      )}
    </div>
  );
}
export default SpotifySyncCard;
