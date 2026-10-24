import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import QueueRail from './QueueRail';
import ArtistQueueList from './ArtistQueueList';

const DEFAULT_QUEUE = 'needs-check';
const GROUPS = [
  ['Needs work', [['needs-identity', 'Needs identity'], ['needs-check', 'Needs catalogue check'], ['needs-bio', 'Needs bio'], ['needs-notes', 'Needs advocacy notes']]],
  ['Finished', [['done', 'Done']]],
  ['Everything', [['all', 'All artists']]],
];
const LABELS = Object.fromEntries(GROUPS.flatMap(([, items]) => items.map(([k, l]) => [k, l])));

function ArtistsArea() {
  const [params, setParams] = useSearchParams();
  const rawQueue = params.get('queue');
  // a stale or typo'd ?queue= falls back rather than rendering a list that cannot load
  const queue = rawQueue !== null && Object.hasOwn(LABELS, rawQueue) ? rawQueue : DEFAULT_QUEUE;
  const q = params.get('q') || '';
  const page = Math.max(0, parseInt(params.get('page'), 10) || 0);
  const [counts, setCounts] = useState(null);

  const loadCounts = useCallback(() => {
    adminFetch('/api/admin/artists/queues')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCounts(d ? Object.fromEntries(d.queues.map((x) => [x.key, x.count])) : null))
      .catch(() => setCounts(null));
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

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
