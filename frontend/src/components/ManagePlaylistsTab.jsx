import { useState, useEffect } from 'react';
import { adminFetch } from '../api/adminApi';

// Admin Manage Playlists tab. Uses the public /api/playlists API — the old
// admin-only playlist endpoints were dead code, deleted in Session 2.2.
function ManagePlaylistsTab() {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const response = await adminFetch('/api/playlists');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setPlaylists(data.playlists || []);
    } catch (error) {
      console.error('Error loading playlists:', error);
      setMessage('Error loading playlists: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlaylist = async (playlistId, playlistName) => {
    if (!confirm(`Are you sure you want to delete the playlist "${playlistName}"? This will remove all songs from the playlist and cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await adminFetch(`/api/playlists/${playlistId}`, { method: 'DELETE' });
      const result = await response.json();

      if (response.ok) {
        setMessage(`Playlist "${playlistName}" deleted successfully`);
        loadPlaylists();
        setTimeout(() => setMessage(''), 5000);
      } else {
        setMessage(`Error: ${result.error}`);
        setTimeout(() => setMessage(''), 5000);
      }
    } catch (error) {
      console.error('Error deleting playlist:', error);
      setMessage('Error deleting playlist');
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-manage-section">
      <div className="admin-manage-header">
        <h2>Manage Playlists</h2>
        <p>Delete playlists created by users</p>
      </div>

      {message && (
        <div className={`admin-message ${message.includes('Error') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      {loading ? (
        <div className="admin-loading">Loading playlists...</div>
      ) : (
        <div className="admin-playlists-list">
          {playlists.map(playlist => (
            <div key={playlist.id} className="admin-playlist-card">
              <div className="admin-playlist-header">
                <h3>{playlist.name}</h3>
                <span className="playlist-song-count">{playlist.song_count} songs</span>
              </div>
              {playlist.description && (
                <p><strong>Description:</strong> {playlist.description}</p>
              )}
              <p><strong>Creator:</strong> {playlist.creator}</p>
              <p><strong>Created:</strong> {new Date(playlist.created_at).toLocaleDateString()}</p>
              <p><strong>Visibility:</strong> {playlist.is_public ? 'Public' : 'Private'}</p>

              <div className="admin-playlist-actions">
                <button
                  className="admin-delete-btn"
                  onClick={() => handleDeletePlaylist(playlist.id, playlist.name)}
                  disabled={loading}
                >
                  Delete Playlist
                </button>
              </div>
            </div>
          ))}
          {playlists.length === 0 && (
            <div className="admin-no-results">
              No playlists found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ManagePlaylistsTab;
