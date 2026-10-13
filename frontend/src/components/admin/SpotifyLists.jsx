import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

// The Songs > Spotify view: the sync card's counts as browsable lists (sub-project F).
// [list key (the ?list= param), tab label, field in the GET /api/admin/spotify/compare payload]
const SPOTIFY_LISTS = [
  ['push', 'To push', 'pushable'],
  ['pull', 'To pull', 'pullable'],
  ['duplicates', 'Possibly on the playlist', 'possibleDuplicates'],
  ['no-link', 'No Spotify link', 'noSpotifyId'],
  ['not-live', 'Not live', 'onPlaylistNotLive'],
];
const DEFAULT_LIST = 'push';
const trackUrl = (id) => `https://open.spotify.com/track/${id}`;

function statusLabel(row) {
  return row.status === 'included' && row.published ? 'live' : row.status;
}

function SpotifyLists() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawList = params.get('list');
  const list = SPOTIFY_LISTS.some(([k]) => k === rawList) ? rawList : DEFAULT_LIST;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback((fresh = false) => {
    setLoading(true);
    return adminFetch(`/api/admin/spotify/compare${fresh ? '?fresh=1' : ''}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('compare failed'))))
      .then(d => { setData(d); setError(''); })
      .catch(() => { setData(null); setError("Couldn't read the Spotify playlist"); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const field = SPOTIFY_LISTS.find(([k]) => k === list)[2];
  const rows = (data && data[field]) || [];
  const songIds = list === 'pull' ? [] : rows.map(r => r.id);

  const open = (row, index) => navigate(`/admin/song/${row.id}`, { state: { from: 'spotify', ids: songIds, index } });

  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar">
        <h2>Spotify</h2>
        <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => load(true)}>Refresh</button>
      </div>

      <div className="spotify-tabs">
        {SPOTIFY_LISTS.map(([key, label, f]) => (
          <button key={key} type="button" aria-pressed={list === key} className={`btn btn-sm ${list === key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setParams({ queue: 'spotify', list: key })}>
            {label} {data ? `(${(data[f] || []).length})` : ''}
          </button>
        ))}
      </div>

      {error ? (
        <div className="queue-empty">{error}</div>
      ) : !data ? (
        <div className="queue-empty">Reading the Spotify playlist…</div>
      ) : rows.length === 0 ? (
        <div className="queue-empty">Nothing here right now.</div>
      ) : list === 'pull' ? (
        rows.map(row => (
          <div key={row.spotify_id} className="song-row-wrap">
            <div className="song-row spotify-row spotify-static">
              <span className="song-meta stacked">
                <span className="song-title">{row.title}</span>
                <span className="song-artist">{row.artists || '—'}</span>
              </span>
            </div>
            <a className="btn btn-ghost btn-sm song-row-action" href={trackUrl(row.spotify_id)} target="_blank" rel="noreferrer">Open in Spotify ↗</a>
          </div>
        ))
      ) : (
        rows.map((row, i) => (
          <div key={row.id} className="song-row-wrap">
            <button type="button" className="song-row spotify-row" onClick={() => open(row, i)}>
              <span className="song-meta stacked">
                <span className="song-title">{row.title}</span>
                <span className="song-artist">{row.artists || '—'}</span>
                {row.match && (
                  <span className="song-artist">On the playlist as: {row.match.title} — {row.match.artists || '—'}</span>
                )}
              </span>
              {list === 'not-live' && <span className={`queue-status ${statusLabel(row)}`}>{statusLabel(row)}</span>}
            </button>
            {row.match && (
              <a className="btn btn-ghost btn-sm song-row-action" href={trackUrl(row.match.spotify_id)} target="_blank" rel="noreferrer">Open in Spotify ↗</a>
            )}
          </div>
        ))
      )}
    </div>
  );
}
export default SpotifyLists;
