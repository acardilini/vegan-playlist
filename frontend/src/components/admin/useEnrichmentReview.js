import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './bandCheckApi';

// The analysis project's staged proposal for one artist, read through the enrichment review. The server re-reads every
// value; the client only names a decision, a field or a member. Shared by the banner, section 1 (the match step), the
// rows panel and the Done footer, so there is ONE copy of the review on the page.
//
// `act(fn, { identity, scope })` runs one action: on success the page shows the returned review and `onChanged` fires
// (and `onIdentitySaved` when the action changed an identity); on failure the error is kept (scope 'match' or 'rows' says
// which part of the page shows it) and the review is re-read.
export default function useEnrichmentReview(artist, { onIdentitySaved, onChanged } = {}) {
  const base = `/api/admin/artists/${artist.id}/enrichment`;
  const [review, setReview] = useState(null);
  const [error, setErrorText] = useState('');
  const [errorScope, setErrorScope] = useState('rows');
  const [busy, setBusy] = useState(false);

  const mounted = useRef(true); // a response that lands after the page is gone (curator moved on) is dropped
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const seq = useRef(0); // only the newest review wins: a re-read and an action's own response can cross
  const cb = useRef({ onIdentitySaved, onChanged });
  cb.current = { onIdentitySaved, onChanged };

  const setError = useCallback((message, scope = 'rows') => { setErrorText(message); setErrorScope(scope); }, []);

  const load = useCallback(() => {
    const my = ++seq.current;
    return api(base)
      .then((r) => { if (mounted.current && my === seq.current) setReview(r); })
      .catch((e) => { if (mounted.current && my === seq.current) setError(e.message); });
  }, [base, setError]);
  // The match state follows the stored ids, so a change of them (under Links, or by an approve / Bandcamp accept) re-reads.
  useEffect(() => { load(); }, [load, artist.musicbrainz_id, artist.bandcamp_url]);

  const act = useCallback(async (fn, { identity = false, scope = 'rows' } = {}) => {
    setError(''); setBusy(true);
    try {
      const r = await fn();
      if (!mounted.current) return false;
      seq.current += 1; // a re-read already in flight is older than this response
      setReview(r);
      if (cb.current.onChanged) cb.current.onChanged();
      if (identity && cb.current.onIdentitySaved) await cb.current.onIdentitySaved();
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      setError(e.message, scope);
      load();
      return false;
    } finally { if (mounted.current) setBusy(false); }
  }, [load, setError]);

  const decide = useCallback((decision) => act(
    () => api(`${base}/match`, { method: 'PUT', body: { decision } }), { identity: decision === 'approve', scope: 'match' }), [act, base]);
  const acceptField = useCallback((f) => act(
    () => api(`${base}/accept`, { method: 'POST', body: { field: f.field } }), { identity: f.field === 'bandcamp_url' }), [act, base]);
  const acceptMember = useCallback((m) => act(
    () => api(`${base}/accept`, { method: 'POST', body: { member: m.name } })), [act, base]);
  // Tells the Artists queue rail to refetch its counts (it is not mounted while the workbench is open; this covers it being so).
  const finishCall = useCallback(async (finished) => {
    const r = await api(`${base}/finish`, { method: 'PUT', body: { finished } });
    window.dispatchEvent(new Event('enrichment-changed'));
    return r;
  }, [base]);
  const finish = useCallback((finished) => act(() => finishCall(finished), { scope: 'footer' }), [act, finishCall]);

  return { base, review, error, errorScope, setError, busy, load, act, decide, acceptField, acceptMember, finishCall, finish };
}
