import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import ArtistDetailsPanel from './ArtistDetailsPanel';
import ArtistFactsPanel from './ArtistFactsPanel';
import EnrichmentPanel from './EnrichmentPanel';
import IdentitySection from './IdentitySection';
import MergeDialog from './MergeDialog';
import CatalogueReview from './CatalogueReview';
import useEnrichmentReview from './useEnrichmentReview';
import { AutoText } from './SavedField';
import {
  tabFromSearch, searchWithTab, mergeWithFromSearch, searchWithoutMergeWith, bannerItems,
} from '../../utils/workbenchView';

// The artist page: header, "Needs you" banner, Details | Catalogue tabs (the tab is in the URL), and the merge dialog.
// Slice 1 builds the shell and section 1; the panels under it are temporary until the Basics and Story slices replace them.
function WorkbenchBody({ artist, save, onIdentitySaved, goNext, go, idx, navState, back, onMerged }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [focus, setFocus] = useState({ open: null, n: 0 }); // identity row requested by the Catalogue panel
  const [refreshKey, setRefreshKey] = useState(0);          // bumps when identity changes -> Catalogue re-checks
  const [factsKey, setFactsKey] = useState(0);              // bumps after an enrichment accept -> Facts reloads
  const [mergeOpen, setMergeOpen] = useState(() => {
    const other = mergeWithFromSearch(location.search, artist.id);
    return other ? { other } : null;
  });
  const opener = useRef(null);                               // the element that opened the merge dialog gets focus back
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const tab = tabFromSearch(location.search);

  const identitySaved = useCallback(async () => {
    await onIdentitySaved();
    if (mounted.current) setRefreshKey((k) => k + 1);
  }, [onIdentitySaved]);
  const factsChanged = useCallback(() => { if (mounted.current) setFactsKey((k) => k + 1); }, []);
  const enr = useEnrichmentReview(artist, { onIdentitySaved: identitySaved, onChanged: factsChanged });
  const needIdentity = useCallback((source) => {
    setFocus((f) => ({ open: source, n: f.n + 1 }));
    navigate({ search: searchWithTab(location.search, 'details') }, { replace: true });
  }, [navigate, location.search]);

  const openMerge = (other) => { opener.current = document.activeElement; setMergeOpen({ other }); };
  const closeMerge = () => {
    setMergeOpen(null);
    if (location.search.includes('mergeWith')) navigate({ search: searchWithoutMergeWith(location.search) }, { replace: true });
    const el = opener.current;
    opener.current = null;
    if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
  };

  const items = bannerItems(enr.review);
  const onBanner = (item) => {
    if (item.kind === 'shared') { openMerge(item.otherId); return; }
    const row = document.getElementById('aw-row-musicbrainz');
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    const first = row.querySelector('button, a[href]');
    if (first) first.focus();
  };

  const [footerBusy, setFooterBusy] = useState(false);
  const markDone = async () => {
    setFooterBusy(true);
    const ok = await enr.finish(true);
    if (mounted.current) setFooterBusy(false);
    if (ok) goNext();
  };
  const finished = enr.review && enr.review.finished_at;

  const identity = { spotify: artist.spotify_id, bandcamp: artist.bandcamp_url, musicbrainz: artist.musicbrainz_id };
  const setTab = (key) => navigate({ search: searchWithTab(location.search, key) }, { replace: true });

  return (
    <div className="workbench">
      <div className="wb-topbar">
        <div className="aw-header">
          <Link to={back} className="btn btn-ghost btn-sm">&larr; Back to Artists</Link>
          <span className="aw-title"><AutoText inline label="Name" initial={artist.name} onSave={(v) => save({ name: v })} /></span>
          <span className="wb-artist">{artist.songs} songs · {artist.live_songs} live</span>
          {navState && idx >= 0 && (
            <span className="aw-nav">
              <button className="btn btn-secondary btn-sm" disabled={idx === 0} onClick={() => go(idx - 1)}>← Prev</button>
              <button className="btn btn-secondary btn-sm" disabled={idx >= navState.ids.length - 1} onClick={() => go(idx + 1)}>Next →</button>
            </span>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="aw-banner" role="alert">
          {items.map((item) => (
            <div key={item.key} className="aw-banner-row">
              <strong className="aw-banner-tag">Needs you</strong>
              <span className="aw-banner-text">{item.text}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => onBanner(item)}>{item.actionLabel}</button>
            </div>
          ))}
        </div>
      )}

      <div className="aw-tabs" role="tablist">
        {[['details', 'Details'], ['catalogue', 'Catalogue']].map(([key, label]) => (
          <button key={key} role="tab" id={`aw-tab-${key}`} aria-selected={tab === key} aria-controls="aw-tabpanel"
            className={`aw-tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      <div id="aw-tabpanel" role="tabpanel" aria-labelledby={`aw-tab-${tab}`}>
        {tab === 'details' && (
          <>
            <IdentitySection artist={artist} enr={enr} save={save} focus={focus} onIdentitySaved={identitySaved} onMerge={openMerge} />
            <div className="aw-todo">Basics and Story are being rebuilt; the panels below stay until then.</div>
            <div className="aw-stack">
              <ArtistDetailsPanel artist={artist} save={save} />
              {/* Keyed on the artist only (the body is), so a Skip survives an identity change; the hook re-reads when the stored ids change. */}
              <EnrichmentPanel artist={artist} enr={enr} onIdentitySaved={identitySaved} onChanged={factsChanged} />
              <ArtistFactsPanel key={artist.id} artist={artist} onNeedIdentity={needIdentity} refreshKey={factsKey} />
            </div>
            {enr.review && (
              <div className="aw-footer">
                {enr.error && enr.errorScope === 'footer' && <div className="admin-message error">{enr.error}</div>}
                {finished ? (
                  <>
                    <span className="adm-pill is-ok">Reviewed</span>
                    <button className="btn btn-ghost btn-sm" disabled={enr.busy} onClick={() => enr.finish(false)}>Reopen</button>
                    <button className="btn btn-primary btn-sm" onClick={goNext}>Next artist →</button>
                  </>
                ) : (
                  <button className="btn btn-primary" disabled={enr.busy || footerBusy} onClick={markDone}>Mark artist done · Next artist →</button>
                )}
              </div>
            )}
          </>
        )}
        {tab === 'catalogue' && (
          <>
            <CatalogueReview key={artist.id} artistId={artist.id} identity={identity}
              onNeedIdentity={needIdentity} refreshKey={refreshKey} onAdded={() => {}}
              reviewed={!!artist.discography_reviewed}
              onReviewedChange={(v) => save({ discography_reviewed: v })} />
            <section className="wb-panel">
              <h2>Catalogue review notes</h2>
              <AutoText label="Catalogue review notes" initial={artist.discography_review_notes} multiline rows={3}
                onSave={(v) => save({ discography_review_notes: v })} />
            </section>
          </>
        )}
      </div>

      {mergeOpen && <MergeDialog artist={artist} initialOther={mergeOpen.other} onClose={closeMerge} onMerged={onMerged} />}
    </div>
  );
}

function ArtistWorkbench() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [artist, setArtist] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [mergeKey, setMergeKey] = useState(0);              // bumps after a merge into this artist -> the page re-mounts (its review and notices are stale)
  const token = useRef(0);                                   // only the latest request's response wins
  const idRef = useRef(id); idRef.current = id;                // the artist currently on screen

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
  useEffect(() => { setArtist(null); setNotFound(false); reload(); }, [reload]);

  // A PUT response is applied only if no reload/navigation started since it was sent.
  const save = useCallback(async (patch) => {
    const my = token.current;
    try {
      const r = await adminFetch(`/api/admin/artists/${id}`, { method: 'PUT', body: patch });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        if (my === token.current) setArtist(d);
        else if (idRef.current === id) reload(); // superseded by a same-artist reload: refetch so controlled state is not stale; if the user moved to another artist, drop it
        return { ok: true };
      }
      return { ok: false, error: d.message || d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  }, [id, reload]);

  // A callback made for one artist is dropped once the curator has moved to another (a late response must not reload
  // the old artist over the new one).
  const onIdentitySaved = useCallback(async () => {
    if (idRef.current !== id) return;
    await reload();
  }, [reload, id]);

  if (notFound) {
    return (<div><Link to="/admin/artists" className="btn btn-ghost btn-sm">&larr; Back to Artists</Link><h1>Artist not found</h1></div>);
  }
  if (!artist) return <div className="queue-empty">Loading…</div>;

  const navState = location.state && Array.isArray(location.state.ids) ? location.state : null;
  const idx = navState ? navState.ids.indexOf(parseInt(id, 10)) : -1;
  const go = (t) => navigate(`/admin/artist/${navState.ids[t]}`, { state: { ...navState, index: t } });
  const back = navState && navState.from ? `/admin/artists?queue=${navState.from}` : '/admin/artists';
  const goNext = () => (navState && idx >= 0 && idx < navState.ids.length - 1 ? go(idx + 1) : navigate(back));
  // After a merge the loser is gone: go to the keeper. When this artist is the keeper the route does not change, so re-read
  // it and re-mount the page (a fresh review, catalogue and facts).
  const onMerged = (keeperId) => {
    navigate(`/admin/artist/${keeperId}`, { replace: true });
    if (keeperId === artist.id) { reload(); setMergeKey((k) => k + 1); }
  };

  return (
    <WorkbenchBody key={`${artist.id}:${mergeKey}`} artist={artist} save={save} onIdentitySaved={onIdentitySaved}
      goNext={goNext} go={go} idx={idx} navState={navState} back={back} onMerged={onMerged} />
  );
}
export default ArtistWorkbench;
