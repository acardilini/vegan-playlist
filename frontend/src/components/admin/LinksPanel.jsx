import { useEffect, useState } from 'react';
import { adminFetch } from '../../api/adminApi';
import { AutoText, SaveTag } from './SavedField';
import PlatformLinksSection from './PlatformLinksSection';

// The "Open" cell of a link row: always present (keeps the columns aligned), a link only when a URL is set.
function OpenLink({ url }) {
  return url
    ? <a className="adm-col-open" href={url} target="_blank" rel="noreferrer">Open &#8599;</a>
    : <span className="adm-col-open" aria-hidden="true" />;
}

function LinksPanel({ wb, savePanel, id, reload }) {
  const artist = (wb.artists || []).map((a) => a.name).join(' ');
  const bandcampSearch = `https://bandcamp.com/search?q=${encodeURIComponent(`${wb.title || ''} ${artist}`.trim())}`;
  const [status, setStatus] = useState('idle');
  const [msg, setMsg] = useState('');
  const [pushMsg, setPushMsg] = useState('');
  const [offerAnyway, setOfferAnyway] = useState(false); // after a possible-duplicate refusal
  useEffect(() => { setPushMsg(''); setOfferAnyway(false); }, [id]);

  // Is the song already on the Spotify playlist? null = unknown/not checked (the button then shows, as before; a push is idempotent).
  const [onPlaylist, setOnPlaylist] = useState(null);
  const checkable = wb.status === 'included' && wb.published && !!wb.spotify_id && !wb.spotify_dormant;
  useEffect(() => {
    setOnPlaylist(null);
    if (!checkable) return undefined;
    let current = true;
    adminFetch(`/api/admin/spotify/on-playlist/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (current && d && typeof d.onPlaylist === 'boolean') setOnPlaylist(d.onPlaylist); })
      .catch(() => {});
    return () => { current = false; };
  }, [id, checkable, wb.spotify_id]);

  // The band's website is an artist field (artists.website_url), saved through the artist update.
  const saveWebsite = async (artistId, v) => {
    try {
      const r = await adminFetch(`/api/admin/artists/${artistId}`, { method: 'PUT', body: { website_url: v } });
      if (r.ok) { reload(); return { ok: true }; }
      const d = await r.json().catch(() => ({}));
      return { ok: false, error: d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  };

  const attachSpotify = async () => {
    setMsg('');
    setStatus('saving');
    try {
      const r = await adminFetch(`/api/admin/songs/${id}/attach-spotify`, { method: 'POST' });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.matched === false) { setMsg('No confident match found on Spotify'); setStatus('error'); }
        else { setStatus('saved'); reload(); }
      } else {
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
        if (d.added && d.added.length) { setPushMsg('Added to the Spotify playlist.'); setOnPlaylist(true); }
        else if (dup) {
          setPushMsg(`Not added: the playlist already has "${dup.match.title}" by ${dup.match.artists || 'the same artist'} (a different version).`);
          setOfferAnyway(true);
        }
        else { setPushMsg('Already on the playlist.'); setOnPlaylist(true); }
      }
      else if (r.status === 409 && d.error === 'BUSY') setPushMsg('A push is already running — wait a moment and retry.');
      else if (r.status === 409) setPushMsg('Connect Spotify first (Dashboard → Spotify playlist).');
      else setPushMsg(d.message || d.error || 'Push failed.');
    } catch { setPushMsg('Request failed.'); }
  };

  return (
    <section className="wb-panel">
      <h2>Play sources &amp; links {!wb.spotify_id && <SaveTag status={status} />}</h2>
      <ul className="adm-list">
        <li className="adm-head" aria-hidden="true">
          <span className="adm-col-label">Site</span>
          <span className="adm-col-field">Link</span>
          <span className="adm-col-open" />
        </li>
        <li className="adm-row">
          <span className="adm-col-label">Spotify</span>
          <AutoText inline label="Spotify URL" initial={wb.spotify_url} placeholder="https://open.spotify.com/track/…"
            onSave={(v) => savePanel('links', { spotify_url: v })} />
          <OpenLink url={wb.spotify_url} />
        </li>
        <li className="adm-row">
          <span className="adm-col-label">Bandcamp</span>
          <AutoText inline label="Bandcamp URL" initial={wb.bandcamp_url} placeholder="https://…"
            onSave={(v) => savePanel('links', { bandcamp_url: v })} />
          <OpenLink url={wb.bandcamp_url} />
        </li>
        <li className="adm-row">
          <span className="adm-col-label">SoundCloud</span>
          <AutoText inline label="SoundCloud URL" initial={wb.soundcloud_url} placeholder="https://…"
            onSave={(v) => savePanel('links', { soundcloud_url: v })} />
          <OpenLink url={wb.soundcloud_url} />
        </li>
        {(wb.artists || []).map((a) => (
          <li className="adm-row" key={a.id}>
            <span className="adm-col-label" title={`${a.name}'s own website (shown on their artist page)`}>
              {(wb.artists || []).length > 1 ? a.name : 'Band website'}
            </span>
            <AutoText inline label={`${a.name} website`} initial={a.website_url} placeholder="https://… (the band's own site)"
              onSave={(v) => saveWebsite(a.id, v)} />
            <OpenLink url={a.website_url} />
          </li>
        ))}
      </ul>

      <div className="adm-actions">
        {!wb.spotify_id && <button type="button" className="btn btn-secondary btn-sm" onClick={attachSpotify}>Attach Spotify by search</button>}
        {onPlaylist === true
          ? <span className="band-muted">On the Spotify playlist</span>
          : (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!canPush} onClick={() => pushToSpotify()}
              title={canPush ? undefined : (live ? 'This song has no Spotify link' : 'Only live songs can be added to the playlist')}>
              Add to Spotify playlist
            </button>
          )}
        {!wb.bandcamp_url && (
          <a className="btn btn-ghost btn-sm" href={bandcampSearch} target="_blank" rel="noreferrer">Search Bandcamp &#8599;</a>
        )}
        <label className="wb-check" title="The Spotify track was removed or no longer plays. The song page hides its Spotify link and the playlist push skips it.">
          <input type="checkbox" checked={!!wb.spotify_dormant}
            onChange={(e) => savePanel('links', { spotify_dormant: e.target.checked })} /> Spotify link no longer plays
        </label>
      </div>
      {msg && <div className="modal-result">{msg}</div>}
      {pushMsg && <div className="modal-result">{pushMsg}</div>}
      {offerAnyway && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => pushToSpotify(true)}>Add anyway</button>
      )}

      <PlatformLinksSection id={id} />

    </section>
  );
}
export default LinksPanel;
