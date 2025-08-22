import { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5000/api/admin';
const ADMIN_PASSWORD = 'admin123';

function DuplicateManager() {
  const [activeTab, setActiveTab] = useState('duplicates');
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [suspiciousSongs, setSuspiciousSongs] = useState([]);
  const [removedSongs, setRemovedSongs] = useState([]);
  const [syncResults, setSyncResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({});

  useEffect(() => {
    if (activeTab === 'duplicates') {
      loadDuplicates();
    } else if (activeTab === 'spotify-validation') {
      loadSpotifyValidation();
    } else if (activeTab === 'removed-songs') {
      loadRemovedSongs();
    }
  }, [activeTab]);

  const loadDuplicates = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_BASE}/duplicate-songs`, {
        headers: {
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });

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
      const response = await fetch(`${API_BASE}/spotify-validation`, {
        headers: {
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });

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

  const loadRemovedSongs = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Use all-songs endpoint and filter for removed songs
      const response = await fetch(`${API_BASE}/all-songs?limit=1000`, {
        headers: {
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });

      const data = await response.json();
      
      if (data.songs) {
        // Filter for songs that are marked as removed from playlist
        const removedSongs = data.songs.filter(song => song.removed_from_playlist === true);
        setRemovedSongs(removedSongs);
        setSummary({
          page: 1,
          limit: removedSongs.length,
          total: removedSongs.length,
          pages: 1
        });
        
        if (removedSongs.length === 0) {
          setMessage('No songs are currently flagged as removed from playlist. Run the flagging script first.');
        } else {
          setMessage(`Found ${removedSongs.length} songs flagged as removed from your playlist.`);
        }
      } else {
        setError('Failed to load songs data');
      }
    } catch (err) {
      setError('Failed to connect to server');
      console.error('Error loading removed songs:', err);
    } finally {
      setLoading(false);
    }
  };


  const syncSpotifyPlaylist = async () => {
    setSyncing(true);
    setError('');
    setMessage('');
    
    try {
      const response = await fetch(`${API_BASE}/sync-spotify-playlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        },
        body: JSON.stringify({})
      });

      const data = await response.json();
      
      if (data.success) {
        setSyncResults(data);
        setMessage(data.message);
        
        // Refresh the current view
        if (activeTab === 'removed-songs') {
          loadRemovedSongs();
        }
        
        setTimeout(() => setMessage(''), 10000);
      } else {
        setError(data.error || 'Failed to sync playlist');
        setTimeout(() => setError(''), 5000);
      }
    } catch (err) {
      setError('Failed to sync playlist');
      console.error('Error syncing playlist:', err);
      setTimeout(() => setError(''), 5000);
    } finally {
      setSyncing(false);
    }
  };

  const removeSong = async (songId, reason = 'duplicate') => {
    if (!confirm('Are you sure you want to permanently remove this song? This action cannot be undone.')) {
      return;
    }

    setLoading(true);
    
    try {
      const response = await fetch(`${API_BASE}/songs/${songId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        },
        body: JSON.stringify({ reason })
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage(data.message);
        
        // Refresh the current view
        if (activeTab === 'duplicates') {
          loadDuplicates();
        } else if (activeTab === 'spotify-validation') {
          loadSpotifyValidation();
        } else if (activeTab === 'removed-songs') {
          // Remove the song from the local state immediately
          setRemovedSongs(prevSongs => prevSongs.filter(song => song.id !== songId));
          // Update summary count
          setSummary(prevSummary => ({
            ...prevSummary,
            total: prevSummary.total - 1,
            limit: prevSummary.limit - 1
          }));
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


  const renderRemovedSongsTab = () => (
    <div className="removed-songs-tab">
      <div className="tab-header">
        <h3>🔄 Songs Removed from Playlist</h3>
        <div className="header-actions">
          <button 
            onClick={loadRemovedSongs} 
            disabled={loading}
            className="refresh-btn"
          >
            {loading ? '🔄 Loading...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      <div className="sync-info">
        <p><strong>How to find songs removed from your Spotify playlist:</strong></p>
        <ol>
          <li>Update your Spotify playlist by removing duplicates/unwanted songs</li>
          <li>Run sync in terminal: <code>cd backend && node scripts/simpleSyncSpotify.js</code></li>
          <li>Flag removed songs: <code>cd backend && node scripts/flagRemovedSongs.js</code></li>
          <li>Songs removed from playlist will appear here automatically</li>
          <li>Use the delete buttons below to remove them from your database</li>
        </ol>
        <p><em>You can also run <code>node scripts/showRemovedSongs.js</code> to preview flagged songs in the terminal before using this tool.</em></p>
      </div>

      {syncResults && (
        <div className="sync-results">
          <h4>📊 Last Sync Results</h4>
          <div className="sync-stats">
            <div className="stat">
              <span className="label">Playlist Songs:</span>
              <span className="value">{syncResults.summary.playlistTracks}</span>
            </div>
            <div className="stat">
              <span className="label">Database Songs:</span>
              <span className="value">{syncResults.summary.databaseSongs}</span>
            </div>
            <div className="stat">
              <span className="label">New Added:</span>
              <span className="value">{syncResults.summary.newSongsAdded}</span>
            </div>
            <div className="stat">
              <span className="label">Flagged Removed:</span>
              <span className="value">{syncResults.summary.songsRemovedFromPlaylist}</span>
            </div>
          </div>
          
          {syncResults.newSongs.length > 0 && (
            <div className="new-songs-preview">
              <h5>📈 New Songs Added (showing first 10):</h5>
              {syncResults.newSongs.map((song, index) => (
                <div key={index} className="song-preview">
                  <strong>{song.title}</strong> by {song.artists.join(', ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {summary.total && (
        <div className="summary-stats">
          <div className="stat">
            <span className="label">Songs Removed from Playlist:</span>
            <span className="value">{summary.total}</span>
          </div>
          <div className="stat">
            <span className="label">Page:</span>
            <span className="value">{summary.page} of {summary.pages}</span>
          </div>
        </div>
      )}

      {removedSongs.length === 0 && !loading && (
        <div className="no-results">
          <p>✅ No songs have been removed from the Spotify playlist!</p>
        </div>
      )}

      {removedSongs.map((song) => (
        <div key={song.id} className="removed-song">
          <div className="song-info">
            <div className="title-artist">
              <strong>{song.title}</strong>
              <span className="artist">by {song.artists}</span>
            </div>
            <div className="song-details">
              <span className="album">{song.album_name}</span>
              <span className="popularity">Popularity: {song.popularity}</span>
              <span className="removed-date">
                Removed: {new Date(song.removed_from_playlist_at).toLocaleDateString()}
              </span>
              <span className="youtube-count">
                YouTube Videos: {song.youtube_videos_count}
              </span>
              <span className="has-lyrics">
                {song.has_lyrics ? '📝 Has Lyrics' : '📝 No Lyrics'}
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
            <div className="removal-warning">
              <strong>⚠️ This song was removed from the Spotify playlist.</strong>
              <br />
              You can safely delete it from the database or keep it if you want to maintain the data.
            </div>
          </div>
          
          <div className="actions">
            <button 
              onClick={() => removeSong(song.id, 'removed-from-playlist')}
              className="remove-btn"
              disabled={loading}
            >
              🗑️ Delete from Database
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
        <button 
          className={`tab ${activeTab === 'removed-songs' ? 'active' : ''}`}
          onClick={() => setActiveTab('removed-songs')}
        >
          🔄 Removed from Playlist
        </button>
      </div>

      {message && <div className="success-message">{message}</div>}
      {error && <div className="error-message">{error}</div>}

      <div className="tab-content">
        {activeTab === 'duplicates' && renderDuplicatesTab()}
        {activeTab === 'spotify-validation' && renderSpotifyValidationTab()}
        {activeTab === 'removed-songs' && renderRemovedSongsTab()}
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

        /* Playlist Sync Styles */
        .header-actions {
          display: flex;
          gap: 10px;
        }

        .sync-btn {
          padding: 8px 16px;
          background: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
        }

        .sync-btn:hover {
          background: #45a049;
        }

        .sync-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .sync-info {
          background: #e8f5e8;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          border-left: 4px solid #4CAF50;
        }

        .sync-info ul {
          margin: 10px 0 0 20px;
        }

        .sync-results {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
          border: 1px solid #dee2e6;
        }

        .sync-stats {
          display: flex;
          gap: 20px;
          margin-bottom: 15px;
        }

        .new-songs-preview {
          margin-top: 15px;
          padding: 15px;
          background: #e8f5e8;
          border-radius: 6px;
        }

        .song-preview {
          padding: 5px 0;
          border-bottom: 1px solid #ddd;
        }

        .song-preview:last-child {
          border-bottom: none;
        }

        .removed-song {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          border: 1px solid #ff9800;
          border-radius: 8px;
          margin-bottom: 10px;
          background: #fff8e1;
        }

        .removal-warning {
          margin-top: 10px;
          padding: 10px;
          background: #ffecb3;
          border-radius: 4px;
          color: #e65100;
          font-size: 12px;
        }

        .removed-date {
          background: #ff5722 !important;
          color: white !important;
        }

        .youtube-count {
          background: #2196F3 !important;
          color: white !important;
        }

        .has-lyrics {
          background: #4CAF50 !important;
          color: white !important;
        }

        /* Instructional Info Boxes */
        .sync-info {
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

        .sync-info p {
          margin: 0 0 12px 0;
          font-weight: 600;
          color: #001a33;
        }

        .sync-info code {
          background: #fff;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          color: #0066cc;
          border: 1px solid #cce0ff;
          font-weight: 500;
          font-size: 13px;
        }

        .sync-info ol {
          margin: 12px 0 12px 24px;
          padding: 0;
        }

        .sync-info li {
          margin-bottom: 8px;
          color: #003366;
        }

        .sync-info em {
          color: #004d99;
          font-style: normal;
          font-weight: 500;
        }

      `}</style>
    </div>
  );
}

export default DuplicateManager;