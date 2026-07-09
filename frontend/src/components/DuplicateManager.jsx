import { useState, useEffect } from 'react';
import { adminFetch } from '../api/adminApi';

// Pure data-quality tab (2026-07-08 admin audit): duplicate detection + Spotify
// validation. Song intake (sync) lives in the Staging tab; the old "Removed from
// Playlist" view was dropped — nothing writes removed_from_playlist since the 1.2
// import-only sync rebuild, so it could never show data again.
function DuplicateManager() {
  const [activeTab, setActiveTab] = useState('duplicates');
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [suspiciousSongs, setSuspiciousSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({});

  useEffect(() => {
    if (activeTab === 'duplicates') {
      loadDuplicates();
    } else if (activeTab === 'spotify-validation') {
      loadSpotifyValidation();
    }
  }, [activeTab]);

  const loadDuplicates = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminFetch('/api/admin/duplicate-songs');
      const data = await response.json();

      if (data.success) {
        setDuplicateGroups(data.duplicateGroups);
        setSummary(data.summary);
      } else {
        setError(data.error || 'Failed to load duplicates');
      }
    } catch (err) {
      setError('Failed to connect to server');
      console.error('Error loading duplicates:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSpotifyValidation = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminFetch('/api/admin/spotify-validation');
      const data = await response.json();

      if (data.success) {
        setSuspiciousSongs(data.suspiciousSongs);
        setSummary(data.summary);
      } else {
        setError(data.error || 'Failed to load Spotify validation');
      }
    } catch (err) {
      setError('Failed to connect to server');
      console.error('Error loading Spotify validation:', err);
    } finally {
      setLoading(false);
    }
  };

  const removeSong = async (songId, reason = 'duplicate') => {
    if (!confirm('Are you sure you want to permanently remove this song? This action cannot be undone.')) {
      return;
    }

    setLoading(true);

    try {
      const response = await adminFetch(`/api/admin/songs/${songId}`, {
        method: 'DELETE',
        body: { reason }
      });
      const data = await response.json();

      if (data.success) {
        setMessage(data.message);

        // Refresh the current view
        if (activeTab === 'duplicates') {
          loadDuplicates();
        } else if (activeTab === 'spotify-validation') {
          loadSpotifyValidation();
        }

        setTimeout(() => setMessage(''), 5000);
      } else {
        setError(data.error || 'Failed to remove song');
        setTimeout(() => setError(''), 5000);
      }
    } catch (err) {
      setError('Failed to remove song');
      console.error('Error removing song:', err);
      setTimeout(() => setError(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (ms) => {
    if (!ms) return 'Unknown';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const renderDuplicatesTab = () => (
    <div className="duplicates-tab">
      <div className="tab-header">
        <h3>🔍 Duplicate Song Detection</h3>
        <button
          onClick={loadDuplicates}
          disabled={loading}
          className="refresh-btn"
        >
          {loading ? '🔄 Scanning...' : '🔄 Refresh Scan'}
        </button>
      </div>

      {summary.totalSongs && (
        <div className="summary-stats">
          <div className="stat">
            <span className="label">Total Songs:</span>
            <span className="value">{summary.totalSongs}</span>
          </div>
          <div className="stat">
            <span className="label">Duplicate Groups Found:</span>
            <span className="value">{summary.duplicateGroups}</span>
          </div>
          <div className="stat">
            <span className="label">Songs in Duplicates:</span>
            <span className="value">{summary.songsInDuplicates}</span>
          </div>
        </div>
      )}

      {duplicateGroups.length === 0 && !loading && (
        <div className="no-results">
          <p>🎉 No duplicate songs found! Your database looks clean.</p>
        </div>
      )}

      {duplicateGroups.map((group) => (
        <div key={group.groupId} className="duplicate-group">
          <div className="group-header">
            <h4>
              Duplicate Group #{group.groupId}
              <span className={`confidence ${group.confidence}`}>
                {group.confidence} confidence
              </span>
            </h4>
            <p className="recommendation">{group.recommendedAction}</p>
          </div>

          <div className="songs-list">
            {group.songs.map((song, index) => (
              <div key={song.id} className={`song-item ${index === 0 ? 'recommended-keep' : 'candidate-remove'}`}>
                <div className="song-info">
                  <div className="title-artist">
                    <strong>{song.title}</strong>
                    <span className="artist">by {song.artists}</span>
                  </div>
                  <div className="song-details">
                    <span className="album">{song.album_name}</span>
                    <span className="duration">{formatDuration(song.duration_ms)}</span>
                    <span className="popularity">Pop: {song.popularity || 0}</span>
                    <span className="source">{song.data_source}</span>
                    <span className="date">Added: {new Date(song.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="actions">
                  {index === 0 ? (
                    <span className="keep-label">✅ Recommended to Keep</span>
                  ) : (
                    <button
                      onClick={() => removeSong(song.id, 'duplicate')}
                      className="remove-btn"
                      disabled={loading}
                    >
                      🗑️ Remove Duplicate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderSpotifyValidationTab = () => (
    <div className="spotify-validation-tab">
      <div className="tab-header">
        <h3>⚠️ Spotify Song Validation</h3>
        <button
          onClick={loadSpotifyValidation}
          disabled={loading}
          className="refresh-btn"
        >
          {loading ? '🔄 Checking...' : '🔄 Check Again'}
        </button>
      </div>

      <div className="validation-info">
        <p>This tool identifies Spotify songs that may have been removed or have issues:</p>
        <ul>
          <li><strong>Zero popularity:</strong> May indicate removed or very obscure tracks</li>
          <li><strong>No preview URL:</strong> Spotify preview may be unavailable</li>
          <li><strong>Limited markets:</strong> Song may not be available in many countries</li>
        </ul>
      </div>

      {summary.totalChecked && (
        <div className="summary-stats">
          <div className="stat">
            <span className="label">Songs Checked:</span>
            <span className="value">{summary.totalChecked}</span>
          </div>
          <div className="stat">
            <span className="label">Zero Popularity:</span>
            <span className="value">{summary.zeroPopularity}</span>
          </div>
          <div className="stat">
            <span className="label">No Preview:</span>
            <span className="value">{summary.noPreview}</span>
          </div>
          <div className="stat">
            <span className="label">Limited Markets:</span>
            <span className="value">{summary.limitedMarkets}</span>
          </div>
        </div>
      )}

      {suspiciousSongs.length === 0 && !loading && (
        <div className="no-results">
          <p>✅ All Spotify songs appear to be healthy!</p>
        </div>
      )}

      {suspiciousSongs.map((song) => (
        <div key={song.id} className="suspicious-song">
          <div className="song-info">
            <div className="title-artist">
              <strong>{song.title}</strong>
              <span className="artist">by {song.artists}</span>
            </div>
            <div className="song-details">
              <span className="album">{song.album_name}</span>
              <span className="popularity">Popularity: {song.popularity}</span>
              <span className="markets">
                Markets: {song.marketCount || (song.available_markets ? song.available_markets.length : 0)}
              </span>
              <a
                href={song.spotify_url}
                target="_blank"
                rel="noopener noreferrer"
                className="spotify-link"
              >
                🎵 Check on Spotify
              </a>
            </div>
            <div className="issues">
              <strong>Issues:</strong>
              {song.issues.map((issue, index) => (
                <span key={index} className="issue-tag">{issue}</span>
              ))}
            </div>
          </div>

          <div className="actions">
            <button
              onClick={() => removeSong(song.id, 'removed-from-spotify')}
              className="remove-btn"
              disabled={loading}
            >
              🗑️ Remove Song
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="duplicate-manager">
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'duplicates' ? 'active' : ''}`}
          onClick={() => setActiveTab('duplicates')}
        >
          🔍 Find Duplicates
        </button>
        <button
          className={`tab ${activeTab === 'spotify-validation' ? 'active' : ''}`}
          onClick={() => setActiveTab('spotify-validation')}
        >
          ⚠️ Spotify Issues
        </button>
      </div>

      {message && <div className="success-message">{message}</div>}
      {error && <div className="error-message">{error}</div>}

      <div className="tab-content">
        {activeTab === 'duplicates' && renderDuplicatesTab()}
        {activeTab === 'spotify-validation' && renderSpotifyValidationTab()}
      </div>

      <style jsx>{`
        .duplicate-manager {
          padding: 20px;
        }

        .tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          border-bottom: 2px solid #eee;
        }

        .tab {
          padding: 10px 20px;
          border: none;
          background: #f8f9fa;
          cursor: pointer;
          border-bottom: 3px solid transparent;
          font-weight: 500;
          color: #495057;
          border-radius: 4px 4px 0 0;
          margin-right: 2px;
        }

        .tab:hover {
          background: #e9ecef;
          color: #212529;
        }

        .tab.active {
          border-bottom-color: #4CAF50;
          color: #4CAF50;
          background: white;
        }

        .tab-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .refresh-btn {
          padding: 8px 16px;
          background: #2196F3;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .refresh-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .summary-stats {
          display: flex;
          gap: 20px;
          background: #f5f5f5;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat .label {
          font-size: 12px;
          color: #666;
          margin-bottom: 5px;
        }

        .stat .value {
          font-size: 24px;
          font-weight: bold;
          color: #333;
        }

        .duplicate-group {
          border: 1px solid #ddd;
          border-radius: 8px;
          margin-bottom: 20px;
          overflow: hidden;
        }

        .group-header {
          background: #f8f9fa;
          padding: 15px;
          border-bottom: 1px solid #ddd;
        }

        .group-header h4 {
          margin: 0 0 10px 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .confidence {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: normal;
        }

        .confidence.high {
          background: #ffeb3b;
          color: #333;
        }

        .confidence.medium {
          background: #ff9800;
          color: white;
        }

        .recommendation {
          margin: 0;
          color: #666;
          font-style: italic;
        }

        .songs-list {
          background: white;
        }

        .song-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          border-bottom: 1px solid #eee;
        }

        .song-item.recommended-keep {
          background: #e8f5e8;
          border-left: 4px solid #4CAF50;
        }

        .song-item.candidate-remove {
          background: #fff3e0;
          border-left: 4px solid #ff9800;
        }

        .song-info {
          flex: 1;
        }

        .title-artist strong {
          font-size: 16px;
          color: #333;
        }

        .title-artist .artist {
          color: #666;
          margin-left: 10px;
        }

        .song-details {
          display: flex;
          gap: 15px;
          margin-top: 5px;
          font-size: 12px;
          color: #888;
        }

        .song-details span {
          background: #f0f0f0;
          padding: 2px 6px;
          border-radius: 3px;
        }

        .actions {
          margin-left: 20px;
        }

        .remove-btn {
          background: #f44336;
          color: white;
          border: none;
          padding: 10px 18px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          min-width: 160px;
        }

        .remove-btn:hover {
          background: #d32f2f;
        }

        .remove-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .keep-label {
          color: #4CAF50;
          font-weight: bold;
        }

        .suspicious-song {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 8px;
          margin-bottom: 10px;
          background: #fff8e1;
        }

        .issues {
          margin-top: 10px;
        }

        .issue-tag {
          background: #ff5722;
          color: white;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          margin-right: 5px;
        }

        .spotify-link {
          color: #1DB954;
          text-decoration: none;
          font-weight: bold;
          background: #f0f9f4;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid #1DB954;
          display: inline-block;
          margin: 2px 0;
        }

        .spotify-link:hover {
          text-decoration: none;
          background: #1DB954;
          color: white;
        }

        .validation-info {
          background: #f0f8ff;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
          border: 1px solid #0066cc;
          border-left: 4px solid #0066cc;
          color: #003366;
          font-size: 14px;
          line-height: 1.5;
        }

        .validation-info p {
          margin: 0 0 12px 0;
          font-weight: 600;
          color: #001a33;
        }

        .validation-info ul {
          margin: 12px 0 12px 24px;
          padding: 0;
        }

        .validation-info li {
          margin-bottom: 8px;
          color: #003366;
        }

        .validation-info strong {
          color: #001a33;
        }

        .no-results {
          text-align: center;
          padding: 40px;
          color: #666;
          font-size: 18px;
        }

        .success-message {
          background: #d4edda;
          color: #155724;
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 20px;
          border: 1px solid #c3e6cb;
        }

        .error-message {
          background: #f8d7da;
          color: #721c24;
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 20px;
          border: 1px solid #f5c6cb;
        }
      `}</style>
    </div>
  );
}

export default DuplicateManager;
