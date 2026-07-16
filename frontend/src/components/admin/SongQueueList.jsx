import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

const PAGE_SIZE = 50;

const QUEUE_LABELS = {
  'to-process': 'To be processed', 'needs-lyrics': 'Needs lyrics', 'needs-cover': 'Needs cover',
  'needs-video': 'Needs video', 'awaiting-community': 'Awaiting community',
  'remind-later': 'Remind me later', 'to-finalise': 'To finalise', 'live': 'Live',
};

function coverStyle(row) {
  // A1 rows carry has_art but not the image URL; show a placeholder unless art exists.
  return row.has_art ? {} : {};
}

function statusClass(row) {
  if (row.status === 'included' && row.published) return 'live';
  return row.status; // 'pending' | 'included' | 'rejected'
}
function statusLabel(row) {
  if (row.status === 'included' && row.published) return 'live';
  return row.status;
}

function SongQueueList({ queue, refreshKey }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  // Reset paging/search whenever the queue changes.
  useEffect(() => { setPage(0); setSearch(''); }, [queue]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ queue, q: search, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    adminFetch(`/api/admin/curation/queue?${qs.toString()}`)
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(d => setRows(d.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [queue, search, page]);

  // Debounce search; immediate on queue/page change.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  const hasNext = rows.length === PAGE_SIZE;

  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar">
        <h2>{QUEUE_LABELS[queue] || queue}</h2>
        <input className="input input-pill" placeholder="Search this queue…"
          value={search} onChange={(e) => { setPage(0); setSearch(e.target.value); }}
          style={{ width: 220 }} />
      </div>

      {loading && rows.length === 0 ? (
        <div className="queue-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="queue-empty">Nothing here right now.</div>
      ) : (
        rows.map(row => (
          <button key={row.id} className="song-row" onClick={() => navigate(`/admin/song/${row.id}`, {
            state: { from: queue, ids: rows.map((r) => r.id), index: rows.findIndex((r) => r.id === row.id) },
          })}>
            <span className={`cover ${row.has_art ? '' : 'placeholder'}`} style={coverStyle(row)} />
            <span className="song-meta">
              <span className="song-title">{row.title}</span>
              <span className="song-artist">{row.artists || '—'}</span>
            </span>
            <span className={`queue-status ${statusClass(row)}`}>{statusLabel(row)}</span>
            <span className="miss-chips">
              {(row.missing || []).map(m => (
                <span key={m} className="miss-chip warn">no {m}</span>
              ))}
            </span>
          </button>
        ))
      )}

      <div className="queue-pager">
        <button className="btn btn-secondary btn-sm" disabled={page === 0}
          onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</button>
        <span className="admin-stub">Page {page + 1}</span>
        <button className="btn btn-secondary btn-sm" disabled={!hasNext}
          onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>
    </div>
  );
}
export default SongQueueList;
