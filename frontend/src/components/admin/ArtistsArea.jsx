import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import QueueRail from './QueueRail';
import ArtistQueueList from './ArtistQueueList';

const DEFAULT_QUEUE = 'needs-check';
const GROUPS = [
  ['Needs work', [['needs-identity', 'Needs identity'], ['needs-check', 'Needs catalogue check'], ['needs-bio', 'Needs bio'], ['needs-notes', 'Needs advocacy notes']]],
  ['Enrichment', [['enr-review', 'To review'], ['enr-match', 'Match to approve'], ['enr-dupes', 'Possible duplicates'], ['enr-done', 'Done']]],
  ['Finished', [['done', 'Done']]],
  ['Everything', [['all', 'All artists']]],
];
const LABELS = Object.fromEntries(GROUPS.flatMap(([, items]) => items.map(([k, l]) => [k, l])));
const PLACEHOLDER_COUNTS = Object.fromEntries(Object.keys(LABELS).map((k) => [k, '·']));

function ArtistsArea() {
  const [params, setParams] = useSearchParams();
  const rawQueue = params.get('queue');
  // a stale or typo'd ?queue= falls back rather than rendering a list that cannot load
  const queue = rawQueue !== null && Object.hasOwn(LABELS, rawQueue) ? rawQueue : DEFAULT_QUEUE;
  const q = params.get('q') || '';
  const page = Math.max(0, parseInt(params.get('page'), 10) || 0);
  // Two independent count fetches merged into one map: each overrides only its own keys, so one failing leaves the
  // other's counts showing (the failed one keeps its "·" placeholder).
  const [artistCounts, setArtistCounts] = useState(null);
  const [enrCounts, setEnrCounts] = useState(null);
  const counts = { ...PLACEHOLDER_COUNTS, ...artistCounts, ...enrCounts };

  const loadCounts = useCallback(() => {
    const load = (url, set) => adminFetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => set(d ? Object.fromEntries(d.queues.map((x) => [x.key, x.count])) : null))
      .catch(() => set(null));
    load('/api/admin/artists/queues', setArtistCounts);
    load('/api/admin/enrichment/queues', setEnrCounts);
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  // The workbench panel announces a finished/reopened artist; the Enrichment counts follow it.
  useEffect(() => {
    window.addEventListener('enrichment-changed', loadCounts);
    return () => window.removeEventListener('enrichment-changed', loadCounts);
  }, [loadCounts]);

  const select = (key) => setParams({ queue: key });
  const setQuery = useCallback((v) => setParams((prev) => {
    const n = new URLSearchParams(prev); if (v) n.set('q', v); else n.delete('q'); n.delete('page'); return n;
  }, { replace: true }), [setParams]);
  const setPage = (p) => setParams((prev) => { const n = new URLSearchParams(prev); if (p > 0) n.set('page', String(p)); else n.delete('page'); return n; }, { replace: true });

  return (
    <div>
      <div className="queue-toolbar"><h1>Artists</h1></div>
      <div className="songs-layout">
        <QueueRail counts={counts} activeQueue={queue} onSelect={select} groups={GROUPS} />
        <ArtistQueueList queue={queue} label={LABELS[queue]} q={q} page={page} onQuery={setQuery} onPage={setPage} />
      </div>
    </div>
  );
}
export default ArtistsArea;
