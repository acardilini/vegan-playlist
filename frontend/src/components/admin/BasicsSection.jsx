import { useEffect, useRef, useState } from 'react';
import { api } from './bandCheckApi';
import useArtistFacts from './useArtistFacts';
import MembersTable from './MembersTable';
import MusicBrainzFill from './MusicBrainzFill';
import { AutoText } from './SavedField';
import { sourceLink } from '../../utils/factSources';
import { confidenceLabel, fieldLabel, acceptedSummary } from '../../utils/enrichmentText';
import { factRows, memberRows, canAcceptAll, basicsStatus } from '../../utils/basicsModel';

// A name for a row Accept all left alone: 'match', 'member:<name>' or a field key. A row locked because the match was
// rejected says so (it stays locked whatever the curator does here).
function skipLabel(s, matchState) {
  const name = s.field === 'match' ? 'Match' : s.field.startsWith('member:') ? s.field.slice('member:'.length) : fieldLabel(s.field);
  return s.reason === 'locked' && matchState === 'rejected' ? `${name} (locked, match rejected)` : name;
}

function SourceText({ source, link, artist }) {
  const href = link || sourceLink(source, artist);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{source}</a> : source;
}

// Section 2 of the artist page: the facts table (stored value, its source, the analysis's proposal with Accept / Skip, any
// warning), Genres, the members table and the live MusicBrainz fill. Skip only hides a proposal in this view; nothing is
// stored. Accept all shown is FILL-ONLY (it never replaces a stored value and never touches a member's vegan mark or role).
// `enr` = useEnrichmentReview; `refreshKey` re-reads the facts after an accept saved something.
function BasicsSection({ artist, enr, save, refreshKey, onIdentitySaved, onChanged, onNeedIdentity }) {
  const fx = useArtistFacts(artist, refreshKey);
  const [skipped, setSkipped] = useState(() => new Set());
  const [needCheck, setNeedCheck] = useState([]); // labels of the rows the last Accept all left alone
  const [accepted, setAccepted] = useState([]); // labels of what the last Accept all applied
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const { review, busy, act, acceptField, finishCall } = enr;
  const skip = (key) => setSkipped((s) => new Set(s).add(key));
  const accept = (fn) => { setNeedCheck([]); setAccepted([]); return fn(); };

  // Accept every row the server will accept (it only fills empty values). The curator stays on the artist and sees what was
  // accepted; when nothing was left over the artist is also marked reviewed.
  const acceptAll = async () => {
    setNeedCheck([]); setAccepted([]);
    await act(async () => {
      const res = await api(`${enr.base}/accept-all`, { method: 'POST', body: {} });
      if (!mounted.current) return res.review;
      setAccepted(acceptedSummary(res.applied));
      if (onChanged) onChanged(); // the facts below must show what was just saved
      const identity = res.applied.some((a) => a === 'match' || a === 'bandcamp_url');
      // Section 1 and the Catalogue re-read the identity now, so they are right even if finishing below fails.
      if (identity && onIdentitySaved) await onIdentitySaved();
      if (!mounted.current) return res.review;
      if (res.skipped.length === 0) return finishCall(true);
      setNeedCheck(res.skipped.map((s) => skipLabel(s, res.review.match.state)));
      return res.review;
    });
  };

  const rows = factRows(fx.facts, review, skipped);
  const members = memberRows(fx.facts, review, skipped);
  const status = basicsStatus(fx.facts, review, skipped);
  const memberWarnings = review && review.has_proposal ? (review.warnings || []).filter((w) => w.field === 'members') : [];
  // The review row behind a proposal, which is what the server-side accept names.
  const reviewField = (key) => (review.fields || []).find((f) => f.field === key);

  return (
    <section className="aw-section" aria-labelledby="aw-sec-basics">
      <div className="aw-section-head">
        <span id="aw-sec-basics">2 · Basics</span>
        <span className={`adm-pill is-${status.tone}`}>{status.label}</span>
      </div>
      <div className="aw-section-body aw-basics">
        {enr.error && enr.errorScope === 'rows' && <div className="admin-message error">{enr.error}</div>}
        {fx.error && <div className="admin-message error">{fx.error}</div>}
        {!fx.facts ? <div className="queue-empty">Loading…</div> : (
          <>
            <ul className="adm-list">
              {rows.map((r) => (
                <li key={r.key}>
                  <div className="adm-row adm-wrap">
                    <span className="adm-col-label">{r.label}</span>
                    {r.readOnly
                      ? <span className="adm-col-name">{r.value || '—'}</span>
                      : <AutoText inline label={r.label} initial={r.value} onSave={(v) => fx.saveFact(r.key, v)} />}
                    {r.source && <span className="aw-fsrc band-meta"><SourceText source={r.source} artist={artist} /></span>}
                  </div>
                  {r.warnings.map((w, i) => <div key={i} className="adm-sub enr-warn">{w}</div>)}
                  {r.proposal && (
                    <div className="adm-sub">
                      Proposed: <strong>{String(r.proposal.proposed)}</strong>{' · '}
                      <SourceText source={r.proposal.source} link={r.proposal.link} artist={artist} />
                      {r.proposal.confidence && ` · ${confidenceLabel(r.proposal.confidence)}`}{' '}
                      {r.proposal.locked
                        ? <span className="band-meta">Approve the match first</span>
                        : <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => accept(() => acceptField(reviewField(r.key)))}>Accept</button>}{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => skip(`field:${r.key}`)}>Skip</button>
                    </div>
                  )}
                </li>
              ))}
              <li className="adm-row adm-wrap">
                <span className="adm-col-label">Genres</span>
                <AutoText inline label="Genres (comma-separated)" placeholder="comma-separated" initial={(artist.genres || []).join(', ')}
                  onSave={(v) => save({ genres: v.split(',').map((g) => g.trim()).filter(Boolean) })} />
              </li>
            </ul>

            <h3 className="aw-sub-head">Members</h3>
            {memberWarnings.map((w, i) => <div key={i} className="enr-warn">{w.text}</div>)}
            <MembersTable artist={artist} rows={members} fx={fx} enr={enr} onSkip={skip} />
            <MusicBrainzFill artist={artist} fx={fx} onNeedIdentity={onNeedIdentity} />

            {accepted.length > 0 && <div className="band-meta" role="status">Just accepted: {accepted.join(', ')}</div>}
            {needCheck.length > 0 && (
              <div className="enr-warn">{needCheck.length === 1 ? '1 row needs' : `${needCheck.length} rows need`} your check: {needCheck.join(', ')}</div>
            )}
            {canAcceptAll(review, skipped) && (
              <div className="adm-actions">
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={acceptAll}>Accept all shown</button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
export default BasicsSection;
