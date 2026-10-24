import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import ArtistDetailsPanel from './ArtistDetailsPanel';
import ArtistLinksPanel from './ArtistLinksPanel';
import CatalogueReview from './CatalogueReview';
import { AutoText } from './SavedField';

function ArtistWorkbench() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [artist, setArtist] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [focus, setFocus] = useState({ open: null, n: 0 }); // Links panel row requested by the Catalogue panel
  const [refreshKey, setRefreshKey] = useState(0);          // bumps when identity changes -> Catalogue re-checks
  const token = useRef(0);                                   // only the latest request's response wins

  const reload = useCallback(() => {
    const my = ++token.current;
    return adminFetch(`/api/admin/artists/${id}`)
      .then(async (r) => {
        if (r.status === 404) { if (my === token.current) setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d) => { if (d && my === token.current) { setArtist(d); setNotFound(false); } })
      .catch(() => {});
  }, [id]);
  useEffect(() => { setArtist(null); setNotFound(false); setFocus({ open: null, n: 0 }); setRefreshKey(0); reload(); }, [reload]);

  // A PUT response is applied only if no reload/navigation started since it was sent.
  const save = useCallback(async (patch) => {
    const my = token.current;
    try {
      const r = await adminFetch(`/api/admin/artists/${id}`, { method: 'PUT', body: patch });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        if (my === token.current) setArtist(d);
        else reload(); // a reload/navigation began after this PUT was sent; refetch so controlled state is not stale
        return { ok: true };
      }
      return { ok: false, error: d.message || d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  }, [id, reload]);

  const onIdentitySaved = useCallback(async () => { await reload(); setRefreshKey((k) => k + 1); }, [reload]);
  const needIdentity = useCallback((source) => setFocus((f) => ({ open: source, n: f.n + 1 })), []);

  if (notFound) {
    return (<div><Link to="/admin/artists" className="btn btn-ghost btn-sm">&larr; Back to Artists</Link><h1>Artist not found</h1></div>);
  }
  if (!artist) return <div className="queue-empty">Loading…</div>;

  const navState = location.state && Array.isArray(location.state.ids) ? location.state : null;
  const idx = navState ? navState.ids.indexOf(parseInt(id, 10)) : -1;
  const go = (t) => navigate(`/admin/artist/${navState.ids[t]}`, { state: { ...navState, index: t } });
  const back = navState && navState.from ? `/admin/artists?queue=${navState.from}` : '/admin/artists';

  return (
    <div className="workbench">
      <div className="wb-topbar">
        <Link to={back} className="btn btn-ghost btn-sm">&larr; Back to Artists</Link>
        <h1 className="wb-title">{artist.name}</h1>
        <div className="wb-artist">{artist.songs} songs · {artist.live_songs} live</div>
        {navState && idx >= 0 && (
          <div>
            <button className="btn btn-secondary btn-sm" disabled={idx === 0} onClick={() => go(idx - 1)}>← Prev</button>
            {' '}
            <button className="btn btn-secondary btn-sm" disabled={idx >= navState.ids.length - 1} onClick={() => go(idx + 1)}>Next →</button>
          </div>
        )}
      </div>
      <div className="wb-grid">
        <div className="wb-col wb-col-main">
          <CatalogueReview key={artist.id} artistId={artist.id}
            identity={{ spotify: artist.spotify_id, bandcamp: artist.bandcamp_url, musicbrainz: artist.musicbrainz_id }}
            onNeedIdentity={needIdentity} refreshKey={refreshKey} onAdded={() => {}}
            reviewed={!!artist.discography_reviewed}
            onReviewedChange={(v) => save({ discography_reviewed: v })} />
        </div>
        <div className="wb-col wb-col-side">
          <ArtistDetailsPanel artist={artist} save={save} />
          <ArtistLinksPanel artist={artist} save={save} focus={focus} onIdentitySaved={onIdentitySaved} />
          <section className="wb-panel">
            <h2>Notes</h2>
            <AutoText label="Catalogue review notes" initial={artist.discography_review_notes} multiline rows={3}
              onSave={(v) => save({ discography_review_notes: v })} />
          </section>
        </div>
      </div>
    </div>
  );
}
export default ArtistWorkbench;
