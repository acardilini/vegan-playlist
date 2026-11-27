import { useEffect, useRef, useState } from 'react';
import { api } from './bandCheckApi';
import { sourceLink } from '../../utils/factSources';
import { confidenceLabel, fieldLabel, acceptedSummary } from '../../utils/enrichmentText';

const MEMBER_CHANGE = { new: 'new member', status: 'status change' };
const isEmpty = (v) => v === null || v === undefined || v === '';
const MATCH_TRUSTED = new Set(['approved', 'pretrusted']);

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

// TEMPORARY (until the Basics section replaces it): one row per proposed fact or member from the analysis project's staged
// proposal, and "Accept all shown". The match step lives in section 1 (MatchStep); Mark done is the page footer. `enr` is the
// shared useEnrichmentReview result. Skip stores nothing.
function EnrichmentPanel({ artist, enr, onIdentitySaved, onChanged }) {
  const { review, error, busy, act, acceptField, acceptMember, finishCall } = enr;
  const [skipped, setSkipped] = useState(() => new Set());
  const [needCheck, setNeedCheck] = useState([]); // labels of the rows the last Accept all left alone
  const [accepted, setAccepted] = useState([]); // labels of what the last Accept all applied
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const skip = (key) => setSkipped((s) => new Set(s).add(key));
  const accept = (fn) => { setNeedCheck([]); setAccepted([]); return fn(); };

  // Accept every row the server will accept (it only fills empty values). The curator always stays on the artist and sees
  // what was accepted; when nothing was left over the artist is also marked reviewed.
  const acceptAll = async () => {
    setNeedCheck([]); setAccepted([]);
    await act(async () => {
      const res = await api(`${enr.base}/accept-all`, { method: 'POST', body: {} });
      if (!mounted.current) return res.review;
      setAccepted(acceptedSummary(res.applied));
      if (onChanged) onChanged(); // the Facts panel must show what was just saved
      const identity = res.applied.some((a) => a === 'match' || a === 'bandcamp_url');
      // Links and Catalogue re-read the identity now, so they are right even if finishing below fails.
      if (identity && onIdentitySaved) await onIdentitySaved();
      if (!mounted.current) return res.review;
      if (res.skipped.length === 0) return finishCall(true);
      setNeedCheck(res.skipped.map((s) => skipLabel(s, res.review.match.state)));
      return res.review;
    });
  };

  if (!review) return error && enr.errorScope === 'rows' ? <section className="wb-panel"><h2>Proposed enrichment</h2><div className="admin-message error">{error}</div></section> : null;
  if (!review.has_proposal) return null;

  const { match, warnings } = review;
  const fields = review.fields.filter((f) => !skipped.has(`field:${f.field}`));
  const members = review.members.filter((m) => !skipped.has(`member:${m.name}`));
  const warnFor = (field) => warnings.filter((w) => w.field === field);
  const nothing = fields.length === 0 && members.length === 0;
  // Accept all needs something the server would take. It only fills: an unlocked row with no warning of its own whose
  // stored value is empty (the Bandcamp url only once the match is approved, which Accept all does for an exact match),
  // or a new member. The server takes no row list and would also apply a row hidden with Skip, so once any row is
  // skipped it is not offered.
  const canAcceptAll = skipped.size === 0 && (
    fields.some((f) => !f.locked && warnFor(f.field).length === 0 && isEmpty(f.current) && (f.field !== 'bandcamp_url' || MATCH_TRUSTED.has(match.state)))
    || members.some((m) => !m.locked && m.change === 'new' && warnFor('members').length === 0));
  const memberSource = (m) => (m.source === 'MusicBrainz' ? match.url : null);

  return (
    <section className="wb-panel">
      <h2>Proposed enrichment</h2>
      {error && enr.errorScope === 'rows' && <div className="admin-message error">{error}</div>}
      {nothing && <div className="band-meta">Nothing new to review</div>}

      {(fields.length > 0 || members.length > 0) && (
        <div className="fact-proposals">
          {fields.map((f) => (
            <div key={f.field}>
              <div className="enr-value">{fieldLabel(f.field)}: {f.current !== null && <><s>{String(f.current)}</s>{' → '}</>}<strong>{String(f.proposed)}</strong></div>
              <Warnings list={warnFor(f.field)} />
              <div className="fact-proposal">
                <RowSource source={f.source} link={f.link} confidence={f.confidence} artist={artist} />
                <RowActions locked={f.locked} busy={busy} onAccept={() => accept(() => acceptField(f))} onSkip={() => skip(`field:${f.field}`)} />
              </div>
            </div>
          ))}
          {members.length > 0 && <Warnings list={warnFor('members')} />}
          {members.map((m) => (
            <div key={m.name}>
              <div className="enr-value">Member: <strong>{m.name}</strong> ({MEMBER_CHANGE[m.change]}, {m.is_current ? 'current' : 'former'})</div>
              <div className="fact-proposal">
                <RowSource source={m.source} link={memberSource(m)} artist={artist} />
                <RowActions locked={m.locked} busy={busy} onAccept={() => accept(() => acceptMember(m))} onSkip={() => skip(`member:${m.name}`)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {accepted.length > 0 && <div className="band-meta" role="status">Just accepted: {accepted.join(', ')}</div>}
      {needCheck.length > 0 && (
        <div className="enr-warn">{needCheck.length === 1 ? '1 row needs' : `${needCheck.length} rows need`} your check: {needCheck.join(', ')}</div>
      )}
      {canAcceptAll && (
        <div className="fact-proposal">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={acceptAll}>Accept all shown</button>
        </div>
      )}
    </section>
  );
}
export default EnrichmentPanel;
