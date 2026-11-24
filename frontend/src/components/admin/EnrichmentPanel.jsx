import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './bandCheckApi';
import { sourceLink } from '../../utils/factSources';
import { methodLabel, confidenceLabel, fieldLabel, stateLabel, spotifyArtistLink, albumLine } from '../../utils/enrichmentText';

const MEMBER_CHANGE = { new: 'new member', status: 'status change' };
const UNDECIDED = new Set(['pretrusted', 'needs-approval']);

function Warnings({ list }) {
  return list.map((w, i) => <div key={i} className="enr-warn">{w.text}</div>);
}

// A row's source as a link to check it: the server's link for the proposal, else the stored ids (admin only).
function RowSource({ source, link, confidence, artist }) {
  const href = link || sourceLink(source, artist);
  const conf = confidenceLabel(confidence);
  return (
    <span className="band-meta">
      {href ? <a href={href} target="_blank" rel="noopener noreferrer">{source}</a> : source}
      {conf && ` · ${conf}`}
    </span>
  );
}

// Accept (or the locked note) and Skip. Skip only hides the row in this view; nothing is stored.
function RowActions({ locked, busy, onAccept, onSkip }) {
  return (
    <>
      {locked
        ? <span className="band-meta">Approve the match first</span>
        : <button className="btn btn-primary btn-sm" disabled={busy} onClick={onAccept}>Accept</button>}
      <button className="btn btn-ghost btn-sm" onClick={onSkip}>Skip</button>
    </>
  );
}

// The analysis project's staged proposal for this artist: the MusicBrainz match step, then one row per proposed fact or
// member. The server re-reads every value; the client only names a decision, a field or a member. Skip stores nothing.
function EnrichmentPanel({ artist, onIdentitySaved, onChanged }) {
  const base = `/api/admin/artists/${artist.id}/enrichment`;
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(() => new Set());
  const [unsure, setUnsure] = useState(false);

  const mounted = useRef(true); // a response that lands after the panel is gone (curator moved on) is dropped
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(() => api(base)
    .then((r) => { if (mounted.current) setReview(r); })
    .catch((e) => { if (mounted.current) setError(e.message); }), [base]);
  useEffect(() => { load(); }, [load]);

  // After a success the panel shows the returned review; after a failure it re-reads, keeping the error line.
  const act = async (fn, { identity = false } = {}) => {
    setError(''); setBusy(true);
    try {
      const r = await fn();
      if (!mounted.current) return;
      setReview(r);
      if (onChanged) onChanged();
      if (identity && onIdentitySaved) await onIdentitySaved();
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message);
      load();
    } finally { if (mounted.current) setBusy(false); }
  };
  const decide = (decision) => act(() => api(`${base}/match`, { method: 'PUT', body: { decision } }), { identity: decision === 'approve' });
  const acceptField = (f) => act(() => api(`${base}/accept`, { method: 'POST', body: { field: f.field } }), { identity: f.field === 'bandcamp_url' });
  const acceptMember = (m) => act(() => api(`${base}/accept`, { method: 'POST', body: { member: m.name } }));
  const skip = (key) => setSkipped((s) => new Set(s).add(key));

  if (!review) return error ? <section className="wb-panel"><h2>Proposed enrichment</h2><div className="admin-message error">{error}</div></section> : null;
  if (!review.has_proposal) return null;

  const { match, warnings } = review;
  const fields = review.fields.filter((f) => !skipped.has(`field:${f.field}`));
  const members = review.members.filter((m) => !skipped.has(`member:${m.name}`));
  const warnFor = (field) => warnings.filter((w) => w.field === field);
  const pending = UNDECIDED.has(match.state);
  const nothing = !pending && fields.length === 0 && members.length === 0;
  if (nothing && review.finished_at) return null;

  const cat = match.catalogue;
  const spotify = spotifyArtistLink(artist.spotify_id);
  const bandcamp = sourceLink('Bandcamp', artist);
  const albums = albumLine(cat.albums);
  // The shared-id line below names and links the same artists the 'match' warning lists, so that warning is not repeated.
  const matchWarnings = match.shared_with.length ? [] : warnFor('match');
  const canUndo = match.state === 'rejected' || (match.state === 'approved' && match.stored_mbid !== match.proposed_mbid);
  const memberSource = (m) => (m.source === 'MusicBrainz' ? match.url : null);

  return (
    <section className="wb-panel">
      <h2>Proposed enrichment</h2>
      {error && <div className="admin-message error">{error}</div>}

      {match.state !== 'none' && (
        <div className="fact-proposals">
          <div><strong>{stateLabel(match.state)}</strong></div>
          <div className="band-meta">
            {methodLabel(match.method)}{match.confidence && ` · ${confidenceLabel(match.confidence)}`}
            {match.url && <>{' · '}<a href={match.url} target="_blank" rel="noopener noreferrer">Check on MusicBrainz</a></>}
          </div>
          <div className="band-meta">
            {cat.songs} songs · {cat.live_songs} live
            {spotify && <>{' · '}<a href={spotify} target="_blank" rel="noopener noreferrer">Spotify</a></>}
            {bandcamp && <>{' · '}<a href={bandcamp} target="_blank" rel="noopener noreferrer">Bandcamp</a></>}
          </div>
          {albums && <div className="band-meta enr-value">{albums}</div>}
          {match.shared_with.length > 0 && (
            <div className="enr-warn">
              Another artist has this id:{' '}
              {match.shared_with.map((s, i) => (
                <span key={s.id}>{i > 0 && ', '}<Link to={`/admin/artist/${s.id}`}>{s.name}</Link> ({s.songs} songs)</span>
              ))}
              ; merging comes in a later update
            </div>
          )}
          <Warnings list={matchWarnings} />
          {pending && !unsure && (
            <div className="fact-proposal">
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('approve')}>Approve match</button>
              {match.state === 'needs-approval' && (
                <>
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide('reject')}>Reject match</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setUnsure(true)}>Not sure</button>
                </>
              )}
            </div>
          )}
          {pending && unsure && (
            <div className="fact-proposal">
              <span className="band-meta">Left undecided</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setUnsure(false)}>Decide now</button>
            </div>
          )}
          {canUndo && (
            <div><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide('clear')}>Undo decision</button></div>
          )}
        </div>
      )}

      {nothing && <div className="band-meta">Nothing new to review</div>}

      {(fields.length > 0 || members.length > 0) && (
        <div className="fact-proposals">
          {fields.map((f) => (
            <div key={f.field}>
              <div className="enr-value">{fieldLabel(f.field)}: {f.current !== null && <><s>{String(f.current)}</s>{' → '}</>}<strong>{String(f.proposed)}</strong></div>
              <Warnings list={warnFor(f.field)} />
              <div className="fact-proposal">
                <RowSource source={f.source} link={f.link} confidence={f.confidence} artist={artist} />
                <RowActions locked={f.locked} busy={busy} onAccept={() => acceptField(f)} onSkip={() => skip(`field:${f.field}`)} />
              </div>
            </div>
          ))}
          {members.length > 0 && <Warnings list={warnFor('members')} />}
          {members.map((m) => (
            <div key={m.name}>
              <div className="enr-value">Member: <strong>{m.name}</strong> ({MEMBER_CHANGE[m.change]}, {m.is_current ? 'current' : 'former'})</div>
              <div className="fact-proposal">
                <RowSource source={m.source} link={memberSource(m)} artist={artist} />
                <RowActions locked={m.locked} busy={busy} onAccept={() => acceptMember(m)} onSkip={() => skip(`member:${m.name}`)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export default EnrichmentPanel;
