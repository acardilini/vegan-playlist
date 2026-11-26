import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '../../api/adminApi';

const NAMES = new Map([['apple_music', 'Apple Music'], ['deezer', 'Deezer'], ['tidal', 'Tidal']]);

// The song's links on other platforms, inside the workbench Links panel. A confirmed link is on the song page. A proposed
// one (Apple Music, found by title + artist) shows what Apple called it beside our song so the curator can tell a
// different version at a glance, then Confirm or Reject. A rejected one is hidden (the run never proposes it again).
function PlatformLinksSection({ id, title, artists }) {
  const [links, setLinks] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => (
    adminFetch(`/api/admin/platform-links/song/${id}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('read failed'))))
      .then(d => setLinks(d.links || []))
      .catch(() => setLinks([]))
  ), [id]);
  useEffect(() => { setLinks(null); setError(''); load(); }, [load]);

  const review = async (platform, action) => {
    setBusy(platform); setError('');
    try {
      const r = await adminFetch(`/api/admin/platform-links/song/${id}/${platform}`, { method: 'PUT', body: { action } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.message || 'Could not save that.'); }
      await load();
    } catch { setError('Request failed.'); }
    setBusy('');
  };

  const shown = (links || []).filter(l => l.status !== 'rejected' && NAMES.has(l.platform));
  if (!shown.length) return null;
  return (
    <div className="wb-platform-links">
      <div className="wb-genre-options-title">Other platforms</div>
      {error && <div className="admin-message error">{error}</div>}
      {shown.map(l => (
        <div key={l.platform} className="wb-platform-row">
          <strong>{NAMES.get(l.platform)}</strong>{' '}
          {l.status === 'confirmed'
            ? <span className="band-muted">on the song page</span>
            : (
              <span>
                <span className="band-muted">found &ldquo;{l.match_title}&rdquo; by {l.match_artist}; ours is &ldquo;{title}&rdquo; by {artists}</span>
              </span>
            )}
          <div className="wb-linkactions">
            <a className="btn btn-ghost btn-sm" href={l.url} target="_blank" rel="noreferrer">Open ↗</a>
            {l.status === 'proposed' && (
              <>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === l.platform} onClick={() => review(l.platform, 'confirm')}>Confirm</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy === l.platform} onClick={() => review(l.platform, 'reject')}>Reject</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export default PlatformLinksSection;
