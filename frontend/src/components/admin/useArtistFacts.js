import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './bandCheckApi';
import { FACT_FIELDS } from '../../utils/basicsModel';

const YEAR_KEYS = new Set(FACT_FIELDS.filter((f) => f.year).map((f) => f.key));

// The artist's stored facts and members (one reader and one writer on the server: artistFacts). Every write goes through
// the existing /facts routes and replaces what is shown; the server stamps the source of a fact the curator types. A
// response that lands after the curator has moved to another artist, or after a newer read, is dropped. `refreshKey`
// re-reads (an enrichment accept saved something).
export default function useArtistFacts(artist, refreshKey = 0) {
  const base = `/api/admin/artists/${artist.id}/facts`;
  const [facts, setFacts] = useState(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const my = ++seq.current;
    return api(base)
      .then((d) => { if (mounted.current && my === seq.current) { setFacts(d); setError(''); } })
      .catch((e) => { if (mounted.current && my === seq.current) setError(e.message); });
  }, [base]);
  useEffect(() => { reload(); }, [reload, refreshKey]);

  // A fact typed by the curator: empty clears it, a year with digits is a number, anything else is text (the server judges it).
  const saveFact = useCallback(async (key, text) => {
    const t = String(text ?? '').trim();
    const value = t === '' ? null : YEAR_KEYS.has(key) && /^\d+$/.test(t) ? Number(t) : t;
    try {
      const d = await api(base, { method: 'PUT', body: { [key]: value } });
      if (mounted.current) { seq.current += 1; setFacts(d); setError(''); }
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }, [base]);

  // Member writes re-read the list afterwards, so what is shown is always what is stored.
  const mutate = useCallback(async (fn) => {
    try { await fn(); await reload(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }, [reload]);
  const addMember = useCallback((body) => mutate(() => api(`${base}/members`, { method: 'POST', body })), [mutate, base]);
  const updateMember = useCallback((id, patch) => mutate(() => api(`${base}/members/${id}`, { method: 'PUT', body: patch })), [mutate, base]);
  const removeMember = useCallback((id) => mutate(() => api(`${base}/members/${id}`, { method: 'DELETE' })), [mutate, base]);

  return { base, facts, error, setError, reload, saveFact, addMember, updateMember, removeMember };
}
