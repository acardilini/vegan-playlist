import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import { badgeText, toneOf, pillTexts, TIER_OPTIONS, SORT_OPTIONS } from '../../utils/transcriptConfidence';

const PAGE_SIZE = 50;
const ORIGIN_LABELS = { spotify: 'From Spotify', submission: 'From submit form', bandcheck: 'From band check', crosscheck: 'From playlist cross-check' };

const QUEUE_LABELS = {
  'to-process': 'To be processed', 'needs-lyrics': 'Needs lyrics', 'needs-cover': 'Needs cover',
  'needs-album': 'Needs album', 'needs-released': 'Needs released', 'needs-language': 'Needs language', 'language-suggested': 'Language suggested', 'check-transcripts': 'Check transcripts', 'needs-genre': 'Needs genre', 'genre-from-artist': 'Genre from artist',
  'genre-from-audio': 'Genre from audio', 'genre-conflicts': 'Genre conflicts',
  'needs-video': 'Needs video', 'no-video': 'No video available', 'broken-video': 'Broken video', 'junk-lyrics': 'Junk lyrics', 'needs-sample-approval': 'Needs sample approval', 'to-transcribe': 'To transcribe', 'lyrics-on-hold': 'Lyrics on hold',
  'remind-later': 'Remind me later', 'to-finalise': 'To finalise',
  'live': 'Live', 'all': 'All songs', 'featured': 'Featured',
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
  const [pair, setPair] = useState('');     // genre-conflicts only: 'existingParent>audioParent', '' = all
  const [pairs, setPairs] = useState([]);
  const [sort, setSort] = useState('best');  // check-transcripts only: best-first by default
  const [tier, setTier] = useState('');      // check-transcripts only: '' = all tiers

  // Reset paging/search whenever the queue changes.
  useEffect(() => { setPage(0); setSearch(''); setPair(''); setSort('best'); setTier(''); }, [queue]);

  // The genre-conflicts queue is mostly neighbouring genres (hardcore vs metal...); a pair filter lets the
  // curator take one kind of disagreement at a time. Counts reload with the list so they track decisions.
  useEffect(() => {
    if (queue !== 'genre-conflicts') { setPairs([]); return; }
    adminFetch('/api/admin/curation/genre-conflict-pairs')
      .then(r => (r.ok ? r.json() : { pairs: [] }))
      .then(d => setPairs(d.pairs || []))
      .catch(() => setPairs([]));
  }, [queue, refreshKey]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ queue, q: search, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (queue === 'genre-conflicts' && pair) qs.set('pair', pair);
    if (queue === 'check-transcripts') { qs.set('sort', sort); if (tier) qs.set('tier', tier); }
    adminFetch(`/api/admin/curation/queue?${qs.toString()}`)
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(d => setRows(d.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [queue, search, page, pair, sort, tier]);

  const unfeature = useCallback(async (id) => {
    try {
      const r = await adminFetch(`/api/admin/songs/${id}/unfeature`, { method: 'POST' });
      if (r.ok) load(); else window.alert('Failed to unfeature');
    } catch { window.alert('Request failed'); }
  }, [load]);

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
        <input className="input input-pill" placeholder={queue === 'all' ? 'Search all songs…' : 'Search this queue…'}
          value={search} onChange={(e) => { setPage(0); setSearch(e.target.value); }}
          style={{ width: 220 }} />
        {queue === 'genre-conflicts' && pairs.length > 0 && (
          <select className="input" aria-label="Kind of disagreement" value={pair}
            onChange={(e) => { setPage(0); setPair(e.target.value); }}>
            <option value="">All disagreements ({pairs.reduce((n, p) => n + p.count, 0)})</option>
            {pairs.map((p) => (
              <option key={`${p.from}>${p.to}`} value={`${p.from}>${p.to}`}>{p.from} → {p.to} ({p.count})</option>
            ))}
          </select>
        )}
        {queue === 'check-transcripts' && (
          <>
            <select className="input" aria-label="Sort by confidence" value={sort}
              onChange={(e) => { setPage(0); setSort(e.target.value); }}>
              {SORT_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <select className="input" aria-label="Confidence tier" value={tier}
              onChange={(e) => { setPage(0); setTier(e.target.value); }}>
              {TIER_OPTIONS.map(([v, label]) => <option key={v || 'all'} value={v}>{label}</option>)}
            </select>
          </>
        )}
      </div>

      {loading && rows.length === 0 ? (
        <div className="queue-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="queue-empty">Nothing here right now.</div>
      ) : (
        rows.map(row => (
          <div key={row.id} className="song-row-wrap">
            <button className="song-row" onClick={() => navigate(`/admin/song/${row.id}`, {
              state: { from: queue, ids: rows.map((r) => r.id), index: rows.findIndex((r) => r.id === row.id) },
            })}>
              <span className={`cover ${row.has_art ? '' : 'placeholder'}`} style={coverStyle(row)} />
              <span className="song-meta">
                <span className="song-title">{row.title}</span>
                <span className="song-artist">{row.artists || '—'}</span>
              </span>
              {queue === 'check-transcripts' && row.transcript && (
                <span className="tr-tags">
                  <span className={`tr-badge tr-${toneOf(row.transcript.tier)}`}>{badgeText(row.transcript)}</span>
                  {pillTexts(row.transcript).map(t => <span key={t} className="tr-pill">{t}</span>)}
                </span>
              )}
              <span className={`queue-status ${statusClass(row)}`}>{statusLabel(row)}</span>
              {row.featured && <span className="featured-badge">Featured</span>}
              {ORIGIN_LABELS[row.origin] && <span className="origin-tag">{ORIGIN_LABELS[row.origin]}</span>}
              {row.genre && queue === 'genre-from-artist' && <span className="origin-tag" title={row.genre_source === 'artist' ? 'Genre comes from the artist' : 'Genre set on the song'}>{row.genre}{row.genre_source === 'artist' ? ' (artist)' : ''}</span>}
              {row.audio_subgenre && queue === 'genre-from-audio' && (
                <span className="origin-tag" title="Genre inferred from the audio">{row.audio_subgenre}{row.audio_confidence ? ` (${row.audio_confidence.toLowerCase()})` : ''}</span>
              )}
              {row.language_suggestion && queue === 'language-suggested' && (
                <span className="origin-tag" title="Language detected by the analysis">{row.language_suggestion.join(', ')}</span>
              )}
              {row.audio_subgenre && queue === 'genre-conflicts' && (
                <span className="origin-tag" title="Genre the site shows now → genre inferred from the audio">{row.genre} → {row.audio_subgenre}</span>
              )}
              <span className="miss-chips">
                {(row.missing || []).map(m => (
                  <span key={m} className="miss-chip warn">no {m}</span>
                ))}
              </span>
            </button>
            {queue === 'featured' && (
              <button className="btn btn-secondary btn-sm song-row-action"
                onClick={() => unfeature(row.id)}>Unfeature</button>
            )}
          </div>
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
