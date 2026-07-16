import { useState } from 'react';
import { adminFetch } from '../../api/adminApi';
import { AutoText, SaveTag } from './SavedField';

function OpenLink({ url }) {
  if (!url) return null;
  return <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">Open ↗</a>;
}

function LinksPanel({ wb, savePanel, id, reload }) {
  const artist = (wb.artists || []).map((a) => a.name).join(' ');
  const artistSite = (wb.artists || []).map((a) => a.website_url).find(Boolean);
  const bandcampSearch = `https://bandcamp.com/search?q=${encodeURIComponent(`${wb.title || ''} ${artist}`.trim())}`;
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
      <div className="wb-linkactions">
        <OpenLink url={wb.spotify_url} />
        {!wb.spotify_id && <button type="button" className="btn btn-secondary btn-sm" onClick={attachSpotify}>Attach Spotify by search</button>}
      </div>
      {msg && <div className="modal-result">{msg}</div>}

      <AutoText label="Bandcamp / website URL" initial={wb.bandcamp_url} placeholder="https://…"
        onSave={(v) => savePanel('links', { bandcamp_url: v })} />
      <div className="wb-linkactions">
        <OpenLink url={wb.bandcamp_url} />
        <a className="btn btn-secondary btn-sm" href={bandcampSearch} target="_blank" rel="noreferrer">Search Bandcamp</a>
      </div>

      <AutoText label="SoundCloud URL" initial={wb.soundcloud_url} placeholder="https://…"
        onSave={(v) => savePanel('links', { soundcloud_url: v })} />
      <div className="wb-linkactions">
        <OpenLink url={wb.soundcloud_url} />
      </div>

      {artistSite && <p className="admin-stub">Artist website on file: {artistSite}</p>}
    </section>
  );
}
export default LinksPanel;
