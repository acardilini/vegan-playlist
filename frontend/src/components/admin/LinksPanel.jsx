import { useState } from 'react';
import { adminFetch } from '../../api/adminApi';
import { AutoText, SaveTag } from './SavedField';

function LinksPanel({ wb, savePanel, id, reload }) {
  const artistSite = (wb.artists || []).map((a) => a.website_url).find(Boolean);
  const [status, setStatus] = useState('idle');
  const [msg, setMsg] = useState('');

  const attachSpotify = async () => {
    setMsg('');
    setStatus('saving');
    try {
      const r = await adminFetch(`/api/admin/songs/${id}/attach-spotify`, { method: 'POST' });
      if (r.ok) { setStatus('saved'); reload(); } else {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || 'Attach failed');
        setStatus('error');
      }
    } catch { setMsg('Request failed'); setStatus('error'); }
  };

  return (
    <section className="wb-panel">
      <h2>Play sources &amp; links {!wb.spotify_id && <SaveTag status={status} />}</h2>
      <AutoText label="Spotify URL" initial={wb.spotify_url} placeholder="https://open.spotify.com/track/…"
        onSave={(v) => savePanel('links', { spotify_url: v })} />
      <AutoText label="Bandcamp / website URL" initial={wb.bandcamp_url} placeholder="https://…"
        onSave={(v) => savePanel('links', { bandcamp_url: v })} />
      <AutoText label="SoundCloud URL" initial={wb.soundcloud_url} placeholder="https://…"
        onSave={(v) => savePanel('links', { soundcloud_url: v })} />
      {artistSite && <p className="admin-stub">Artist website on file: {artistSite}</p>}
      {!wb.spotify_id && (
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={attachSpotify}>Attach Spotify by search</button>
          {msg && <div className="modal-result">{msg}</div>}
        </>
      )}
    </section>
  );
}
export default LinksPanel;
