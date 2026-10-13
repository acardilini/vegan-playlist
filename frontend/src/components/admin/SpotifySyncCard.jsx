import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
  window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  return RETURN_MSG[key] || '';
}

function SpotifySyncCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState(takeReturnMessage);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  // fresh=true skips the server's 60s playlist cache (the Refresh button)
  const load = useCallback((fresh = false) => (
    adminFetch(`/api/admin/spotify/compare${fresh === true ? '?fresh=1' : ''}`)
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
      const r = await adminFetch('/api/admin/sync-spotify-playlist', { method: 'POST', body: {} }); // empty JSON body required: the route destructures req.body, which is undefined without one
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
        setNeedsReconnect(false);
        const skipped = (d.notEligible || []).length;
        setMsg(`Added ${(d.added || []).length}, already there ${d.alreadyThere ?? 0}${skipped ? `, skipped ${skipped} (see the Spotify lists)` : ''}.`);
      } else if (r.status === 409 && d.error === 'BUSY') {
        setMsg('A push is already running — wait a moment and reload.');
      } else if (r.status === 409) {
        if (d.error === 'NOT_CONNECTED' || d.error === 'REAUTH') setNeedsReconnect(true);
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

  const { pullable = [], pushable = [], possibleDuplicates = [], noSpotifyId = [], onPlaylistNotLive = [] } = data;
  const listLink = (list) => `/admin/songs?queue=spotify&list=${list}`;

  return (
    <div className="spotify-sync">
      {msg && <div className="modal-result">{msg}</div>}

      <p className="dash-health">
        {data.connected && !needsReconnect && 'Spotify connected '}
        {(!data.connected || needsReconnect) && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={connect}>
            {data.connected ? 'Reconnect Spotify' : 'Connect Spotify'}
          </button>
        )}{' '}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => load(true)}>Refresh</button>
      </p>

      <p className="dash-health">
        <Link to={listLink('pull')}>{pullable.length} on the playlist, not on the site</Link>{' '}
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || pullable.length === 0} onClick={pull}>
          Pull {pullable.length} as pending
        </button>
      </p>

      <p className="dash-health">
        <Link to={listLink('push')}>{pushable.length} live songs not on the playlist</Link>{' '}
        <button type="button" className="btn btn-secondary btn-sm"
          disabled={busy || pushable.length === 0 || !data.connected} onClick={() => setConfirming(true)}>
          Push {pushable.length} to Spotify
        </button>
      </p>

      {possibleDuplicates.length > 0 && (
        <p className="dash-health"><Link to={listLink('duplicates')}>{possibleDuplicates.length} live songs look like they&rsquo;re already on the playlist (a different version)</Link></p>
      )}

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
        <p className="dash-health"><Link to={listLink('no-link')}>{noSpotifyId.length} live songs have no Spotify link</Link> (can&rsquo;t be pushed)</p>
      )}
      {onPlaylistNotLive.length > 0 && (
        <p className="dash-health"><Link to={listLink('not-live')}>{onPlaylistNotLive.length} on the playlist but not live</Link></p>
      )}
    </div>
  );
}
export default SpotifySyncCard;
