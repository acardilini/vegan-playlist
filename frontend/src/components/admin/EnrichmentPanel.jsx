import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './bandCheckApi';
import { sourceLink } from '../../utils/factSources';
import { methodLabel, confidenceLabel, fieldLabel, stateLabel, spotifyArtistLink, albumLine, acceptedSummary } from '../../utils/enrichmentText';

const MEMBER_CHANGE = { new: 'new member', status: 'status change' };
const UNDECIDED = new Set(['pretrusted', 'needs-approval']);
const isEmpty = (v) => v === null || v === undefined || v === '';

// A name for a skipped entry of Accept all: 'match', 'member:<name>' or a field key. A row locked because the match was
// rejected says so (it stays locked whatever the curator does here).
function skipLabel(s, matchState) {
  const name = s.field === 'match' ? 'Match' : s.field.startsWith('member:') ? s.field.slice('member:'.length) : fieldLabel(s.field);
  return s.reason === 'locked' && matchState === 'rejected' ? `${name} (locked, match rejected)` : name;
}

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
function EnrichmentPanel({ artist, onIdentitySaved, onChanged, onDone }) {
  const base = `/api/admin/artists/${artist.id}/enrichment`;
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(() => new Set());
  const [unsure, setUnsure] = useState(false);
  const [needCheck, setNeedCheck] = useState([]); // labels of the rows the last Accept all left alone
  const [accepted, setAccepted] = useState([]); // labels of what the last Accept all applied

  const mounted = useRef(true); // a response that lands after the panel is gone (curator moved on) is dropped
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const seq = useRef(0); // only the newest review wins: a re-read and an action's own response can cross

  const load = useCallback(() => {
    const my = ++seq.current;
    return api(base)
      .then((r) => { if (mounted.current && my === seq.current) setReview(r); })
      .catch((e) => { if (mounted.current && my === seq.current) setError(e.message); });
  }, [base]);
  // The workbench keys this panel on the artist id only, so Skip survives an identity change; the match state follows
  // the stored ids, so a change of them (under Links, or by this panel's own Approve match / Bandcamp accept) re-reads.
  useEffect(() => { load(); }, [load, artist.musicbrainz_id, artist.bandcamp_url]);

  // After a success the panel shows the returned review; after a failure it re-reads, keeping the error line.
  const act = async (fn, { identity = false } = {}) => {
    setError(''); setNeedCheck([]); setAccepted([]); setBusy(true);
    try {
      const r = await fn();
      if (!mounted.current) return false;
      seq.current += 1; // a re-read already in flight is older than this response
      setReview(r);
      if (onChanged) onChanged();
      if (identity && onIdentitySaved) await onIdentitySaved();
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      setError(e.message);
      load();
      return false;
    } finally { if (mounted.current) setBusy(false); }
  };
  // Tells the Artists queue rail to refetch its counts (it is not mounted while the workbench is open; this covers it being so).
  const announce = () => window.dispatchEvent(new Event('enrichment-changed'));
  const finishCall = async (finished) => { const r = await api(`${base}/finish`, { method: 'PUT', body: { finished } }); announce(); return r; };
  // Done / Reopen: finish then (on Done) move to the next artist.
  const finish = async (finished) => {
    if ((await act(() => finishCall(finished))) && finished && mounted.current && onDone) onDone();
  };
  // Accept every row the server will accept (it only fills empty values). The curator always stays on the artist and sees
  // what was accepted; when nothing was left over the artist is also marked reviewed, and "Next artist" moves on.
  const acceptAll = async () => {
    await act(async () => {
      const res = await api(`${base}/accept-all`, { method: 'POST', body: {} });
      if (!mounted.current) return res.review;
      setAccepted(acceptedSummary(res.applied));
      if (onChanged) onChanged(); // the Facts panel must show what was just saved
      const identity = res.applied.some((a) => a === 'match' || a === 'bandcamp_url');
      // Links and Catalogue re-read the identity now, so they are right even if finishing below fails. The panel is
      // keyed on the artist id, so this re-read does not remount it.
      if (identity && onIdentitySaved) await onIdentitySaved();
      if (!mounted.current) return res.review;
      if (res.skipped.length === 0) {
        return finishCall(true);
      }
      setNeedCheck(res.skipped.map((s) => skipLabel(s, res.review.match.state)));
      return res.review;
    });
  };
  const decide = (decision) => act(() => api(`${base}/match`, { method: 'PUT', body: { decision } }), { identity: decision === 'approve' });
  const acceptField = (f) => act(() => api(`${base}/accept`, { method: 'POST', body: { field: f.field } }), { identity: f.field === 'bandcamp_url' });
  const acceptMember = (m) => act(() => api(`${base}/accept`, { method: 'POST', body: { member: m.name } }));
  const skip = (key) => setSkipped((s) => new Set(s).add(key));

  if (!review) return error ? <section className="wb-panel"><h2>Proposed enrichment</h2><div className="admin-message error">{error}</div></section> : null;
  if (!review.has_proposal) return null;
  const acceptedLine = accepted.length > 0 && <div className="band-meta" role="status">Just accepted: {accepted.join(', ')}</div>;
  if (review.finished_at) {
    return (
      <section className="wb-panel">
        <h2>Proposed enrichment</h2>
        {error && <div className="admin-message error">{error}</div>}
        <div className="fact-proposal">
          <strong>Reviewed</strong>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => finish(false)}>Reopen</button>
        </div>
        {acceptedLine}
        {onDone && <div className="fact-proposal"><button className="btn btn-primary btn-sm" disabled={busy} onClick={onDone}>Next artist →</button></div>}
      </section>
    );
  }

  const { match, warnings } = review;
  const fields = review.fields.filter((f) => !skipped.has(`field:${f.field}`));
  const members = review.members.filter((m) => !skipped.has(`member:${m.name}`));
  const warnFor = (field) => warnings.filter((w) => w.field === field);
  const pending = UNDECIDED.has(match.state);
  const nothing = !pending && fields.length === 0 && members.length === 0;
  // Accept all needs something the server would take. It only fills: an unlocked row with no warning of its own whose
  // stored value is empty (the Bandcamp url only once the match is approved, which Accept all does for an exact match),
  // or a new member. The server takes no row list and would also apply a row hidden with Skip, so once any row is
  // skipped it is not offered.
  const matchTrusted = match.state === 'approved' || match.state === 'pretrusted';
  const canAcceptAll = skipped.size === 0 && (
    fields.some((f) => !f.locked && warnFor(f.field).length === 0 && isEmpty(f.current) && (f.field !== 'bandcamp_url' || matchTrusted))
    || members.some((m) => !m.locked && m.change === 'new' && warnFor('members').length === 0));

  const cat = match.catalogue;
  const spotify = spotifyArtistLink(artist.spotify_id);
  const bandcamp = sourceLink('Bandcamp', artist);
  const albums = albumLine(cat.albums);
  // The shared-id line below names and links the same artists the 'match' warning lists, so that warning is not repeated.
  const matchWarnings = match.shared_with.length ? [] : warnFor('match');
  // Only a rejection can be undone here: an approval is the stored id, which is changed or cleared under Links.
  const canUndo = match.state === 'rejected';
  const otherStored = match.stored_mbid && match.proposed_mbid && match.stored_mbid !== match.proposed_mbid;
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
          {otherStored && <div className="enr-warn">Saved id {match.stored_mbid} differs from the proposed one - change or clear it under Links</div>}
          {match.shared_with.length > 0 && (
            <div className="enr-warn">
              Another artist has this id:{' '}
              {match.shared_with.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}<Link to={`/admin/artist/${s.id}`}>{s.name}</Link> ({s.songs} songs){' '}
                  <Link to={`/admin/artist/${artist.id}?mergeWith=${s.id}`}>Merge...</Link>
                </span>
              ))}
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

      {acceptedLine}
      {needCheck.length > 0 && (
        <div className="enr-warn">{needCheck.length === 1 ? '1 row needs' : `${needCheck.length} rows need`} your check: {needCheck.join(', ')}</div>
      )}
      <div className="fact-proposal">
        {canAcceptAll && <button className="btn btn-primary btn-sm" disabled={busy} onClick={acceptAll}>Accept all shown</button>}
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => finish(true)}>Done with this artist</button>
      </div>
    </section>
  );
}
export default EnrichmentPanel;
