import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import { methodLabel } from '../../utils/enrichmentText';

const PAGE_SIZE = 50;

function ArtistQueueList({ queue, label, q, page, onQuery, onPage }) {
  const navigate = useNavigate();
  const isEnrichment = queue.startsWith('enr-'); // enrichment queues come from their own endpoint and rows carry `enrichment`, not identity flags
  const [text, setText] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // The input is local state committed to the URL after a pause, so a router transition cannot reset it mid-typing.
  // committed = the last value this list wrote to (or read from) the URL; a different q is an outside change to adopt
  const committed = useRef(q);
  useEffect(() => {
    if (q !== committed.current) { committed.current = q; setText(q); }
  }, [q]);
  useEffect(() => { committed.current = q; setText(q); }, [queue]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (text === committed.current) return undefined;
    const t = setTimeout(() => { committed.current = text; onQuery(text); }, 250);
    return () => clearTimeout(t);
  }, [text, onQuery]);

  const load = useCallback(() => {
    let live = true;
    const qs = new URLSearchParams({ queue, q, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    adminFetch(`${isEnrichment ? '/api/admin/enrichment/queue' : '/api/admin/artists'}?${qs}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || 'Could not load artists'); return d; })
      .then((d) => { if (live) { setData({ ...d, enr: isEnrichment }); setError(''); } })
      .catch((e) => { if (live) { setData((prev) => (prev && prev.enr === isEnrichment ? prev : { rows: [], total: 0, enr: isEnrichment })); setError(e.message); } });
    return () => { live = false; };
  }, [queue, q, page, isEnrichment]);
  useEffect(() => load(), [load]);

  // data from the other kind of queue (artist rows vs enrichment rows) is treated as not loaded yet, so a row is never rendered with the wrong shape
  const fresh = data && data.enr === isEnrichment ? data : null;
  const rows = fresh ? fresh.rows : [];
  // a stale ?page= past the end would strand the curator on an empty page
  useEffect(() => { if (fresh && fresh.rows.length === 0 && page > 0) onPage(0); }, [fresh, page, onPage]);
  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar">
        <h2>{label}</h2>
        <input className="input input-pill" aria-label="Search artists" placeholder="Search artists by name"
          value={text} onChange={(e) => setText(e.target.value)} style={{ width: 220 }} />
      </div>
      {error && <div className="admin-message error">{error}</div>}
      {fresh === null ? <div className="queue-empty">Loading…</div>
        : rows.length === 0 ? <div className="queue-empty">Nothing here right now.</div>
        : rows.map((r) => (
          <div key={r.id} className="song-row-wrap">
            <button className="song-row" onClick={() => navigate(`/admin/artist/${r.id}`, {
              state: { from: queue, ids: rows.map((x) => x.id), index: rows.findIndex((x) => x.id === r.id) },
            })}>
              <span className="song-meta">
                <span className="song-title">{r.name}</span>
                <span className="song-artist">{r.songs} songs · {r.live_songs} live</span>
              </span>
              <span className="miss-chips">
                {isEnrichment ? (
                  <>
                    {r.enrichment && r.enrichment.method && <span className="miss-chip">{methodLabel(r.enrichment.method)}</span>}
                    {r.enrichment && r.enrichment.shared && <span className="miss-chip warn">shared id</span>}
                  </>
                ) : (
                  <>
                    {!(r.identity.spotify || r.identity.bandcamp || r.identity.musicbrainz) && <span className="miss-chip warn">no identity</span>}
                    {!r.reviewed && <span className="miss-chip warn">not checked</span>}
                    {!r.has_bio && <span className="miss-chip warn">no bio</span>}
                    {!r.has_notes && !r.none_needed && <span className="miss-chip warn">no advocacy notes</span>}
                  </>
                )}
              </span>
            </button>
          </div>
        ))}
      {fresh && fresh.total > PAGE_SIZE && (
        <div className="queue-pager">
          <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}>← Prev</button>
          <span className="admin-stub">{Math.min(page * PAGE_SIZE + 1, fresh.total)}–{Math.min((page + 1) * PAGE_SIZE, fresh.total)} of {fresh.total}</span>
          <button className="btn btn-secondary btn-sm" disabled={(page + 1) * PAGE_SIZE >= fresh.total} onClick={() => onPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
export default ArtistQueueList;
