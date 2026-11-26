import { useEffect, useRef, useState, useCallback } from 'react';
import { adminFetch } from '../../api/adminApi';

const NAMES = new Map([['apple_music', 'Apple Music'], ['deezer', 'Deezer'], ['tidal', 'Tidal']]);

// The song's links on other platforms, inside the workbench Links panel (an admin list: docs/ADMIN_UI.md). A confirmed link
// is on the song page. A proposed one (Apple Music, found by title + artist) shows what the platform called the track on a
// line beneath, so the curator can tell a different version at a glance (the song's own title is in the top bar), then
// Confirm or Reject. A rejected one is hidden (the run never proposes it again).
function PlatformLinksSection({ id }) {
  const [links, setLinks] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const idRef = useRef(id); // the song on screen now; a slow answer for a song the curator has already left is dropped
  idRef.current = id;

  const load = useCallback(() => {
    const asked = id;
    const keep = (fn) => (v) => { if (idRef.current === asked) fn(v); };
    return adminFetch(`/api/admin/platform-links/song/${asked}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('read failed'))))
      .then(keep(d => setLinks(d.links || [])))
      .catch(keep(() => setLinks([])));
  }, [id]);
  useEffect(() => { setLinks(null); setError(''); setBusy(''); load(); }, [load]);

  const review = async (platform, action) => {
    setBusy(platform); setError('');
    try {
      const r = await adminFetch(`/api/admin/platform-links/song/${id}/${platform}`, { method: 'PUT', body: { action } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); if (idRef.current === id) setError(d.message || 'Could not save that.'); }
      await load();
    } catch { if (idRef.current === id) setError('Request failed.'); }
    if (idRef.current === id) setBusy('');
  };

  const shown = (links || []).filter(l => l.status !== 'rejected' && NAMES.has(l.platform));
  if (!shown.length) return null;
  return (
    <div className="wb-platform-links">
      {error && <div className="admin-message error">{error}</div>}
      <ul className="adm-list">
        <li className="adm-head" aria-hidden="true">
          <span className="adm-col-label">Platform</span>
          <span className="adm-col-field">Link</span>
          <span className="adm-col-open" />
        </li>
        {shown.map(l => {
          const proposed = l.status === 'proposed';
          return (
            <li key={l.platform} className="adm-row adm-wrap">
              <span className="adm-col-label">{NAMES.get(l.platform)}</span>
              <span className="adm-col-field band-muted">{proposed ? 'To check' : 'On the song page'}</span>
              <a className="adm-col-open" href={l.url} target="_blank" rel="noreferrer">Open &#8599;</a>
              {proposed && (
                <>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy === l.platform} onClick={() => review(l.platform, 'confirm')}>Confirm</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy === l.platform} onClick={() => review(l.platform, 'reject')}>Reject</button>
                  <span className="adm-sub band-muted">Found &ldquo;{l.match_title}&rdquo; by {l.match_artist}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
export default PlatformLinksSection;
