import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { playlistService } from '../api/playlistService';

function PlaylistDetailPage() {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadPlaylist();
  }, [playlistId]);

  const loadPlaylist = async () => {
    try {
      setLoading(true);
      const response = await playlistService.getPlaylist(playlistId);
      setPlaylist(response.playlist);
      setSongs(response.songs);
    } catch (error) {
      console.error('Error loading playlist:', error);
      setError('Failed to load playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleSongClick = (songId) => {
    navigate(`/song/${songId}`);
  };

  const handleRemoveSong = async (songId, songTitle) => {
    if (!confirm(`Remove "${songTitle}" from this playlist?`)) return;

    try {
      await playlistService.removeSongFromPlaylist(playlistId, songId);
      setMessage(`Removed "${songTitle}" from playlist`);
      setTimeout(() => setMessage(''), 3000);
      loadPlaylist(); // Refresh the playlist
    } catch (error) {
      console.error('Error removing song:', error);
      setMessage('Failed to remove song from playlist');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">🎵 Loading playlist...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="error-message">❌ {error}</div>
        <button onClick={() => navigate('/playlists')} className="back-button">
          Back to Playlists
        </button>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="page-container">
        <div className="no-results">
          <h3>Playlist not found</h3>
          <button onClick={() => navigate('/playlists')} className="back-button">
            Back to Playlists
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="playlist-header">
        <button onClick={() => navigate('/playlists')} className="back-button">
          ← Back to Playlists
        </button>

        <div className="playlist-info-header">
          <div className="playlist-image-large">
            <img
              src="https://via.placeholder.com/300x300/1DB954/000000?text=♪"
              alt={playlist.name}
            />
          </div>

          <div className="playlist-details">
            <h1>{playlist.name}</h1>
            <p className="playlist-description">{playlist.description || 'No description'}</p>
            {message && (
              <div className="success-message">✅ {message}</div>
            )}
            <div className="playlist-meta">
              <span className="playlist-creator">Created by {playlist.creator}</span>
              <span className="playlist-date">
                {new Date(playlist.created_at).toLocaleDateString()}
              </span>
              <span className="playlist-song-count">{songs.length} songs</span>
            </div>
          </div>
        </div>
      </div>

      <div className="playlist-songs">
        <h2>Songs</h2>
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
                onClick={() => handleSongClick(song.id)}
              >
                <div className="song-position">{index + 1}</div>
                <div className="song-artwork">
                  <img
                    src={song.album_images?.[2]?.url || "https://via.placeholder.com/64x64/1DB954/000000?text=♪"}
                    alt={song.title}
                  />
                </div>
                <div className="song-info">
                  <div className="song-title">{song.title}</div>
                  <div className="song-artist">
                    {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
                  </div>
                  {song.album_name && (
                    <div className="song-album">{song.album_name}</div>
                  )}
                </div>
                <div className="song-duration">{formatDuration(song.duration_ms)}</div>
                <button
                  className="remove-song-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveSong(song.id, song.title);
                  }}
                  title="Remove from playlist"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PlaylistDetailPage;
