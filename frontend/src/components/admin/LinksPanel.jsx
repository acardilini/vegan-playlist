import { useEffect, useState } from 'react';
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
  const [pushMsg, setPushMsg] = useState('');
  const [offerAnyway, setOfferAnyway] = useState(false); // after a possible-duplicate refusal
  useEffect(() => { setPushMsg(''); setOfferAnyway(false); }, [id]);

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

  const live = wb.status === 'included' && wb.published;
  const canPush = live && !!wb.spotify_id;
  const pushToSpotify = async (allowDuplicates = false) => {
    setPushMsg('Adding…');
    setOfferAnyway(false);
    try {
      const r = await adminFetch('/api/admin/spotify/push', { method: 'POST', body: { songIds: [Number(id)], ...(allowDuplicates === true ? { allowDuplicates: true } : {}) } });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const dup = (d.notEligible || []).find(n => n.reason === 'possible_duplicate');
        if (d.added && d.added.length) setPushMsg('Added to the Spotify playlist.');
        else if (dup) {
          setPushMsg(`Not added: the playlist already has "${dup.match.title}" by ${dup.match.artists || 'the same artist'} (a different version).`);
          setOfferAnyway(true);
        }
        else setPushMsg('Already on the playlist.');
      }
      else if (r.status === 409 && d.error === 'BUSY') setPushMsg('A push is already running — wait a moment and retry.');
      else if (r.status === 409) setPushMsg('Connect Spotify first (Dashboard → Spotify playlist).');
      else setPushMsg(d.message || d.error || 'Push failed.');
    } catch { setPushMsg('Request failed.'); }
  };

  return (
    <section className="wb-panel">
      <h2>Play sources &amp; links {!wb.spotify_id && <SaveTag status={status} />}</h2>
      <AutoText label="Spotify URL" initial={wb.spotify_url} placeholder="https://open.spotify.com/track/…"
        onSave={(v) => savePanel('links', { spotify_url: v })} />
      <div className="wb-linkactions">
        <OpenLink url={wb.spotify_url} />
        {!wb.spotify_id && <button type="button" className="btn btn-secondary btn-sm" onClick={attachSpotify}>Attach Spotify by search</button>}
        <button type="button" className="btn btn-secondary btn-sm" disabled={!canPush} onClick={() => pushToSpotify()}
          title={canPush ? undefined : (live ? 'This song has no Spotify link' : 'Only live songs can be added to the playlist')}>
          Add to Spotify playlist
        </button>
      </div>
      <label className="wb-check" title="The Spotify track was removed or no longer plays. The song page hides its Spotify link and the playlist push skips it.">
        <input type="checkbox" checked={!!wb.spotify_dormant}
          onChange={(e) => savePanel('links', { spotify_dormant: e.target.checked })} /> Spotify link no longer plays (hide it on the song page)
      </label>
      {msg && <div className="modal-result">{msg}</div>}
      {pushMsg && <div className="modal-result">{pushMsg}</div>}
      {offerAnyway && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => pushToSpotify(true)}>Add anyway</button>
      )}

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
