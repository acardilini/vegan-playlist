import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { playlistService } from '../api/playlistService';

function formatDuration(durationMs) {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function PlaylistDetailPage() {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    playlistService.getPlaylist(playlistId)
      .then((response) => {
        setPlaylist(response.playlist);
        setSongs(response.songs);
      })
      .catch((err) => {
        console.error('Error loading playlist:', err);
        setError('Failed to load playlist');
      })
      .finally(() => setLoading(false));
  }, [playlistId]);

  const openSong = (songId) => navigate(`/song/${songId}`);

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-message">Loading playlist…</div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="page-container">
        <div className="no-results">
          <h3>{error || 'Playlist not found'}</h3>
          <button onClick={() => navigate('/playlists')} className="back-button">
            ← Back to playlists
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <button onClick={() => navigate('/playlists')} className="back-button">
        ← Back to playlists
      </button>

      <div className="page-header">
        <h1>{playlist.name}</h1>
        {playlist.description && <p>{playlist.description}</p>}
        <div className="playlist-detail-meta">
          <span>Created by {playlist.creator}</span>
          <span>{new Date(playlist.created_at).toLocaleDateString()}</span>
          <span>{songs.length} songs</span>
        </div>
      </div>

      <div className="section-header">
        <h2>Songs</h2>
      </div>
      {songs.length === 0 ? (
        <div className="no-results">
          <p>This playlist is empty.</p>
        </div>
      ) : (
        <div className="songs-list">
          {songs.map((song, index) => (
            <div
              key={song.id}
              className="song-item"
              role="button"
              tabIndex={0}
              aria-label={`Open song ${song.title}`}
              onClick={() => openSong(song.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openSong(song.id);
                }
              }}
            >
              <div className="song-index">{index + 1}</div>
              <div className="song-artwork">
                {song.album_images?.length ? (
                  <img src={song.album_images[2]?.url || song.album_images[0].url} alt="" />
                ) : (
                  <div className="artwork-placeholder" aria-hidden="true"><span>cover</span></div>
                )}
              </div>
              <div className="song-info">
                <div className="song-title">{song.title}</div>
                <div className="song-artist">
                  {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
                </div>
              </div>
              <div className="duration">{formatDuration(song.duration_ms)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PlaylistDetailPage;
