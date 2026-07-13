import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import QueueRail from './QueueRail';
import SongQueueList from './SongQueueList';

const DEFAULT_QUEUE = 'to-process';
// Only these queues are selectable in the list — Inbox and Needs analysis are
// rail-disabled (reserved for sub-projects C/B) and A1's list endpoint 400s on
// 'inbox'. Guard against a stale/typo'd ?queue= landing on one of them.
const SELECTABLE_QUEUES = [
  'to-process', 'needs-lyrics', 'needs-cover', 'needs-video',
  'awaiting-community', 'remind-later', 'to-finalise', 'live',
];

function SongsArea() {
  const [params, setParams] = useSearchParams();
  const rawQueue = params.get('queue');
  const activeQueue = SELECTABLE_QUEUES.includes(rawQueue) ? rawQueue : DEFAULT_QUEUE;
  const [counts, setCounts] = useState(null);

  const loadCounts = useCallback(() => {
    adminFetch('/api/admin/curation/counts')
      .then(r => r.ok ? r.json() : null)
      .then(setCounts)
      .catch(() => setCounts(null));
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const selectQueue = (key) => setParams({ queue: key });

  return (
    <div>
      <h1>Songs</h1>
      <div className="songs-layout">
        <QueueRail counts={counts} activeQueue={activeQueue} onSelect={selectQueue} />
        <SongQueueList queue={activeQueue} />
      </div>
    </div>
  );
}
export default SongsArea;
