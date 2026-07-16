import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { playlistService } from '../api/playlistService';

function coverUrl(images) {
  if (!images) return null;
  let arr = images;
  if (typeof images === 'string') { try { arr = JSON.parse(images); } catch { return null; } }
  return Array.isArray(arr) && arr[0] && arr[0].url ? arr[0].url : null;
}

function PlaylistsPage() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    playlistService.getPlaylists()
      .then((response) => setPlaylists(response.playlists))
      .catch((err) => {
        console.error('Error loading playlists:', err);
        setError('Failed to load playlists');
      })
      .finally(() => setLoading(false));
  }, []);

  const openPlaylist = (playlistId) => navigate(`/playlist/${playlistId}`);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Playlists</h1>
        <p>Curated collections of vegan-themed music</p>
      </div>

      {loading && <div className="loading-message">Loading playlists…</div>}
      {error && <div className="error-message">{error}</div>}

      {!loading && !error && playlists.length === 0 && (
        <div className="no-results">
          <h2>No playlists yet</h2>
          <p>Collections are on their way.</p>
        </div>
      )}

      {!loading && !error && playlists.length > 0 && (
        <div className="playlists-grid">
          {playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="playlist-card"
              role="button"
              tabIndex={0}
              aria-label={`Open playlist ${playlist.name}`}
              onClick={() => openPlaylist(playlist.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openPlaylist(playlist.id);
                }
              }}
            >
              {coverUrl(playlist.cover_images) ? (
                <img
                  className="playlist-card-cover"
                  src={coverUrl(playlist.cover_images)}
                  alt=""
                  aria-hidden="true"
                />
              ) : (
                <div className="artwork-placeholder" aria-hidden="true">
                  <span>playlist</span>
                </div>
              )}
              <h2 className="playlist-card-name">{playlist.name}</h2>
              <div className="playlist-card-meta">
                <span>{playlist.song_count} songs</span>
                <span>{playlist.creator}</span>
                <span>{new Date(playlist.created_at).toLocaleDateString()}</span>
              </div>
              {playlist.description && (
                <p className="playlist-card-desc">{playlist.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PlaylistsPage;
