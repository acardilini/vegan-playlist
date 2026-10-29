import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import QueueRail from './QueueRail';
import SongQueueList from './SongQueueList';
import AddSongPanel from './AddSongPanel';
import InboxList from './InboxList';
import SpotifyLists from './SpotifyLists';
import JunkLyricsList from './JunkLyricsList';

const DEFAULT_QUEUE = 'to-process';
// Only these queues are selectable — Needs analysis is rail-disabled (reserved for
// sub-project B). Guard against a stale/typo'd ?queue= landing on a queue that can't
// render. 'inbox' renders InboxList, and 'spotify' SpotifyLists; the rest render SongQueueList.
const SELECTABLE_QUEUES = [
  'inbox', 'to-process', 'needs-lyrics', 'needs-cover', 'needs-album', 'needs-released', 'needs-language', 'needs-genre', 'genre-from-artist', 'needs-video', 'no-video', 'junk-lyrics',
  'to-transcribe', 'lyrics-on-hold', 'remind-later', 'to-finalise', 'live', 'all', 'featured', 'spotify',
];

function SongsArea() {
  const [params, setParams] = useSearchParams();
  const rawQueue = params.get('queue');
  const activeQueue = SELECTABLE_QUEUES.includes(rawQueue) ? rawQueue : DEFAULT_QUEUE;
  const [counts, setCounts] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
      <div className="queue-toolbar">
        <h1>Songs</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add a song</button>
      </div>
      <div className="songs-layout">
        <QueueRail counts={counts} activeQueue={activeQueue} onSelect={selectQueue} />
        {activeQueue === 'inbox'
          ? <InboxList refreshKey={refreshKey} onChanged={() => { loadCounts(); setRefreshKey(k => k + 1); }} />
          : activeQueue === 'spotify'
            ? <SpotifyLists />
            : activeQueue === 'junk-lyrics'
              ? <JunkLyricsList refreshKey={refreshKey} onChanged={() => { loadCounts(); setRefreshKey(k => k + 1); }} />
              : <SongQueueList queue={activeQueue} refreshKey={refreshKey} />}
      </div>
      {showAdd && (
        <AddSongPanel
          onClose={() => setShowAdd(false)}
          onAdded={() => { loadCounts(); setRefreshKey(k => k + 1); }}
        />
      )}
    </div>
  );
}
export default SongsArea;
