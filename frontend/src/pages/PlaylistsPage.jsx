import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { playlistService } from '../api/playlistService';

function CreatePlaylistModal({ onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creator, setCreator] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        creator: creator.trim() || 'Anonymous',
        is_public: isPublic
      });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Create New Playlist</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="playlist-name">Playlist Name *</label>
            <input
              id="playlist-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter playlist name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="playlist-description">Description</label>
            <textarea
              id="playlist-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your playlist (optional)"
              rows="3"
            />
          </div>

          <div className="form-group">
            <label htmlFor="playlist-creator">Creator Name</label>
            <input
              id="playlist-creator"
              type="text"
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              placeholder="Your name (optional)"
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Make playlist public
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="cancel-button">
              Cancel
            </button>
            <button type="submit" className="submit-button">
              Create Playlist
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PlaylistsPage() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Load playlists on component mount
  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const response = await playlistService.getPlaylists();
      setPlaylists(response.playlists);
    } catch (error) {
      console.error('Error loading playlists:', error);
      setError('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  };

  const handlePlaylistClick = (playlistId) => {
    navigate(`/playlist/${playlistId}`);
  };

  const handleCreatePlaylist = () => {
    setShowCreateModal(true);
  };

  const handleCreatePlaylistSubmit = async (playlistData) => {
    try {
      await playlistService.createPlaylist(playlistData);
      setShowCreateModal(false);
      loadPlaylists(); // Refresh the list
    } catch (error) {
      console.error('Error creating playlist:', error);
      alert('Failed to create playlist');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Playlists</h1>
        <p>Curated collections of vegan-themed music</p>
        <button className="create-button" onClick={handleCreatePlaylist}>
          Create New Playlist
        </button>
      </div>

      {loading && (
        <div className="loading">🎵 Loading playlists...</div>
      )}

      {error && (
        <div className="error-message">❌ {error}</div>
      )}

      {!loading && !error && playlists.length === 0 && (
        <div className="no-results">
          <h3>No playlists found</h3>
          <p>Be the first to create a playlist!</p>
        </div>
      )}

      {!loading && !error && playlists.length > 0 && (
        <div className="playlists-grid">
          {playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="playlist-card"
              onClick={() => handlePlaylistClick(playlist.id)}
            >
              <div className="playlist-image">
                <img
                  src="https://via.placeholder.com/200x200/1DB954/000000?text=♪"
                  alt={playlist.name}
                />
                <div className="playlist-overlay">
                  <div className="play-button">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
              </div>
              <div className="playlist-info">
                <h3>{playlist.name}</h3>
                <p className="playlist-song-count">{playlist.song_count} songs</p>
                <p className="playlist-description">{playlist.description || 'No description'}</p>
                <p className="playlist-creator">Created by {playlist.creator}</p>
                <p className="playlist-date">
                  {new Date(playlist.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreatePlaylistModal
          onSubmit={handleCreatePlaylistSubmit}
          onCancel={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

export default PlaylistsPage;
