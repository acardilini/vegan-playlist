import { useState, useEffect } from 'react';
import { playlistService } from '../api/playlistService';

function AddToPlaylistModal({ song, onClose, onSuccess }) {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const response = await playlistService.getPlaylists(1, 100); // Get more playlists
      setPlaylists(response.playlists);
    } catch (error) {
      console.error('Error loading playlists:', error);
      setError('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPlaylist) return;

    try {
      setSubmitting(true);
      await playlistService.addSongToPlaylist(selectedPlaylist, song.id);
      onSuccess(`Added "${song.title}" to playlist!`);
      onClose();
    } catch (error) {
      console.error('Error adding song to playlist:', error);
      setError(error.message.includes('already exists')
        ? 'Song is already in this playlist'
        : 'Failed to add song to playlist'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Add to Playlist</h2>
        <div className="song-preview">
          <img
            src={song.album_images?.[2]?.url || "https://via.placeholder.com/64x64/1DB954/000000?text=♪"}
            alt={song.title}
            className="song-preview-image"
          />
          <div className="song-preview-info">
            <div className="song-preview-title">{song.title}</div>
            <div className="song-preview-artist">
              {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
            </div>
          </div>
        </div>

        {loading && <div className="loading">Loading playlists...</div>}

        {error && <div className="error-message">❌ {error}</div>}

        {!loading && !error && (
          <>
            {playlists.length === 0 ? (
              <div className="no-playlists">
                <p>You don't have any playlists yet.</p>
                <button
                  onClick={() => {
                    onClose();
                    // You could add navigation to create playlist here
                  }}
                  className="create-playlist-link"
                >
                  Create your first playlist
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="playlist-select">Select Playlist:</label>
                  <select
                    id="playlist-select"
                    value={selectedPlaylist}
                    onChange={(e) => setSelectedPlaylist(e.target.value)}
                    required
                  >
                    <option value="">Choose a playlist...</option>
                    {playlists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name} ({playlist.song_count} songs)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="modal-actions">
                  <button type="button" onClick={onClose} className="cancel-button">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={!selectedPlaylist || submitting}
                  >
                    {submitting ? 'Adding...' : 'Add to Playlist'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default AddToPlaylistModal;
