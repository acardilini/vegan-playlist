import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import QueueRail from './QueueRail';

const DEFAULT_QUEUE = 'to-process';

function SongsArea() {
  const [params, setParams] = useSearchParams();
  const activeQueue = params.get('queue') || DEFAULT_QUEUE;
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
        <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
          <p className="admin-stub">Selected queue: {activeQueue} — list arrives in the next step.</p>
        </div>
      </div>
    </div>
  );
}
export default SongsArea;
