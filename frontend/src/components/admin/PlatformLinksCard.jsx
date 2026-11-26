import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

const POLL_MS = 2000;

// Dashboard card for the platform-links run (Deezer by ISRC, Apple Music by search). Click-only: Find links starts a
// paced server-side run (it is slow on purpose: Apple allows about 20 searches a minute), this card polls it, and the
// links Apple proposes wait in the Check links rail for the curator to confirm.
function PlatformLinksCard() {
  const [counts, setCounts] = useState(null);
  const [run, setRun] = useState(null);      // { state, total, done, found, skipped } while or after a run started here
  const [msg, setMsg] = useState('');
  const timer = useRef(null);

  const loadCounts = useCallback(() => (
    adminFetch('/api/admin/platform-links/counts')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('counts failed'))))
      .then(setCounts)
      .catch(() => setCounts(null))
  ), []);
  useEffect(() => { loadCounts(); return () => clearInterval(timer.current); }, [loadCounts]);

  const poll = useCallback((runId) => {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const r = await adminFetch(`/api/admin/platform-links/runs/${runId}`);
        if (!r.ok) throw new Error('poll failed');
        const d = await r.json();
        setRun(d);
        if (d.state !== 'running') { clearInterval(timer.current); loadCounts(); }
      } catch { clearInterval(timer.current); setMsg('Lost track of the run. It may still be going on the server.'); }
    }, POLL_MS);
  }, [loadCounts]);

  const start = async () => {
    setMsg('');
    try {
      const r = await adminFetch('/api/admin/platform-links/run', { method: 'POST', body: {} });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) return setMsg('A run is already going on the server.');
      if (!r.ok || !d.runId) return setMsg(d.message || 'Could not start the run.');
      setRun({ state: 'running', total: 0, done: 0, found: { deezer: 0, apple_proposed: 0 }, skipped: 0 });
      poll(d.runId);
    } catch { setMsg('Could not start the run.'); }
  };

  const running = run && run.state === 'running';
  const c = counts && counts.confirmed;
  return (
    <div className="platform-links-card">
      {msg && <div className="modal-result">{msg}</div>}
      <p className="dash-health">
        {c ? `On the song page now: Deezer ${c.deezer} · Apple Music ${c.apple_music} · Tidal ${c.tidal}` : '·'}
      </p>
      <p className="dash-health">
        {counts && counts.proposed > 0
          ? <Link to="/admin/songs?queue=check-links">{counts.proposed} Apple Music links to check</Link>
          : 'No links waiting for you.'}{' '}
        <button type="button" className="btn btn-secondary btn-sm" disabled={running} onClick={start}>
          {running ? 'Looking…' : 'Find links'}
        </button>
      </p>
      {run && (
        <p className="dash-health">
          {running
            ? `Looked at ${run.done} of ${run.total || '…'} songs. Found ${run.found.deezer} on Deezer, ${run.found.apple_proposed} on Apple Music to check.`
            : run.state === 'done'
              ? `Done. ${run.found.deezer} new on Deezer, ${run.found.apple_proposed} on Apple Music to check${run.skipped ? `, ${run.skipped} songs skipped` : ''}.`
              : 'The run failed. Try again.'}
        </p>
      )}
      {!running && !run && <p className="admin-stub">Finding links is slow on purpose (Apple allows about 20 searches a minute), so leave the server running.</p>}
    </div>
  );
}
export default PlatformLinksCard;
