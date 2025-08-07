import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5000/api';
const ADMIN_PASSWORD = 'admin123'; // This should match your actual admin password

function YouTubeVideoManager() {
  const [songsNeedingVideos, setSongsNeedingVideos] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [manualUrl, setManualUrl] = useState('');
  const [message, setMessage] = useState('');
  const [processingVideo, setProcessingVideo] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedSongs, setSelectedSongs] = useState(new Set());
  const [batchUrls, setBatchUrls] = useState('');

  useEffect(() => {
    loadSongsNeedingVideos();
  }, [currentPage]);

  const loadSongsNeedingVideos = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/youtube/songs/missing-videos?page=${currentPage}&limit=20`);
      const data = await response.json();
      
      if (data.success) {
        setSongsNeedingVideos(data.songs);
        setPagination(data.pagination);
      } else {
        setMessage('Failed to load songs: ' + data.error);
      }
    } catch (error) {
      console.error('Error loading songs:', error);
      setMessage('Failed to load songs');
    } finally {
      setLoading(false);
    }
  };

  const searchYouTube = async (song) => {
    try {
      setSelectedSong(song);
      setMessage(`Preparing search for "${song.artists} - ${song.title}"...`);
      
      const response = await fetch(`${API_BASE}/youtube/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id })
      });
      
      const data = await response.json();
      if (data.success) {
        setSearchResults(data.results);
        setMessage(data.message);
      } else {
        setMessage('Search failed: ' + data.error);
      }
    } catch (error) {
      console.error('Error searching:', error);
      setMessage('Search failed');
    }
  };

  const addVideoFromUrl = async (song, youtubeUrl) => {
    if (!youtubeUrl.trim()) {
      setMessage('Please enter a YouTube URL');
      return;
    }

    try {
      setProcessingVideo(true);
      setMessage('Adding video...');

      const response = await fetch(`${API_BASE}/admin/save-youtube-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        },
        body: JSON.stringify({
          song_id: song.id,
          youtube_url: youtubeUrl.trim()
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setMessage(`✅ Video added successfully for "${song.title}"!`);
        setManualUrl('');
        setSelectedSong(null);
        setSearchResults([]);
        
        // Reload the list to remove this song
        loadSongsNeedingVideos();
      } else {
        setMessage(`❌ Failed to add video: ${result.error}`);
      }
    } catch (error) {
      console.error('Error adding video:', error);
      setMessage('❌ Failed to add video');
    } finally {
      setProcessingVideo(false);
    }
  };

  const openYouTubeSearch = (song) => {
    const query = encodeURIComponent(`${song.artists} ${song.title}`);
    window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
  };

  const toggleSongSelection = (songId) => {
    const newSelected = new Set(selectedSongs);
    if (newSelected.has(songId)) {
      newSelected.delete(songId);
    } else {
      newSelected.add(songId);
    }
    setSelectedSongs(newSelected);
  };

  const processBatchUrls = async () => {
    if (!batchUrls.trim()) {
      setMessage('Please enter YouTube URLs');
      return;
    }

    const urls = batchUrls.split('\n').filter(url => url.trim());
    const selectedSongsList = songsNeedingVideos.filter(song => selectedSongs.has(song.id));
    
    if (urls.length !== selectedSongsList.length) {
      setMessage(`❌ Mismatch: ${selectedSongsList.length} songs selected but ${urls.length} URLs provided`);
      return;
    }

    setProcessingVideo(true);
    setMessage('Processing batch videos...');
    
    let successCount = 0;
    let errors = [];

    for (let i = 0; i < urls.length; i++) {
      const song = selectedSongsList[i];
      const url = urls[i].trim();
      
      try {
        const response = await fetch(`${API_BASE}/admin/save-youtube-video`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Password': ADMIN_PASSWORD
          },
          body: JSON.stringify({
            song_id: song.id,
            youtube_url: url
          })
        });

        const result = await response.json();
        
        if (result.success) {
          successCount++;
        } else {
          errors.push(`${song.title}: ${result.error}`);
        }
      } catch (error) {
        errors.push(`${song.title}: Network error`);
      }
    }

    setProcessingVideo(false);
    
    if (successCount > 0) {
      setMessage(`✅ Added ${successCount} videos successfully!${errors.length > 0 ? ` ${errors.length} errors.` : ''}`);
      setSelectedSongs(new Set());
      setBatchUrls('');
      setBatchMode(false);
      loadSongsNeedingVideos(); // Reload to remove processed songs
    } else {
      setMessage(`❌ No videos added. Errors: ${errors.slice(0, 3).join(', ')}`);
    }
  };

  const extractVideoId = (url) => {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  if (loading) {
    return (
      <div className="youtube-manager">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading songs that need YouTube videos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="youtube-manager">
      <div className="youtube-manager-header">
        <h2>🎥 YouTube Video Manager</h2>
        <p className="stats">
          {pagination.total || 0} songs need YouTube videos • Page {pagination.page} of {pagination.pages}
        </p>
        <div className="batch-mode-toggle">
          <button
            className={`batch-toggle-btn ${batchMode ? 'active' : ''}`}
            onClick={() => {
              setBatchMode(!batchMode);
              setSelectedSongs(new Set());
              setBatchUrls('');
            }}
          >
            {batchMode ? '🔄 Single Mode' : '📋 Batch Mode'} 
          </button>
          {batchMode && (
            <span className="batch-hint">
              Select songs below, then paste URLs in the same order
            </span>
          )}
        </div>
      </div>

      {message && (
        <div className={`message ${message.includes('✅') ? 'success' : message.includes('❌') ? 'error' : 'info'}`}>
          {message}
        </div>
      )}

      {selectedSong && (
        <div className="video-search-modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>🔍 Find Video: {selectedSong.title} by {selectedSong.artists}</h3>
              <button 
                className="close-button" 
                onClick={() => {setSelectedSong(null); setSearchResults([]); setManualUrl('');}}
              >
                ✕
              </button>
            </div>
            
            <div className="search-actions">
              <button 
                className="youtube-search-button"
                onClick={() => openYouTubeSearch(selectedSong)}
              >
                🔍 Search on YouTube
              </button>
              <span className="search-hint">Opens YouTube in new tab - copy the URL back here</span>
            </div>

            <div className="manual-url-section">
              <h4>📝 Paste YouTube URL:</h4>
              <div className="url-input-group">
                <input
                  type="url"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=... or https://youtu.be/..."
                  className="url-input"
                />
                <button
                  className="add-video-button"
                  onClick={() => addVideoFromUrl(selectedSong, manualUrl)}
                  disabled={!manualUrl.trim() || processingVideo}
                >
                  {processingVideo ? 'Adding...' : 'Add Video'}
                </button>
              </div>
              {manualUrl && extractVideoId(manualUrl) && (
                <div className="url-preview">
                  ✅ Valid YouTube URL detected: {extractVideoId(manualUrl)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {batchMode && selectedSongs.size > 0 && (
        <div className="batch-processing">
          <h3>📋 Batch Process {selectedSongs.size} Songs</h3>
          <p>Paste YouTube URLs below, one per line, in the same order as the selected songs:</p>
          <div className="selected-songs-preview">
            {songsNeedingVideos.filter(song => selectedSongs.has(song.id)).map((song, index) => (
              <div key={song.id} className="selected-song-item">
                <span className="song-number">{index + 1}.</span>
                <span className="song-name">{song.title} by {song.artists}</span>
              </div>
            ))}
          </div>
          <textarea
            value={batchUrls}
            onChange={(e) => setBatchUrls(e.target.value)}
            placeholder="https://youtube.com/watch?v=...
https://youtube.com/watch?v=...
https://youtube.com/watch?v=..."
            className="batch-urls-input"
            rows={Math.max(3, selectedSongs.size)}
          />
          <div className="batch-actions">
            <button
              className="process-batch-button"
              onClick={processBatchUrls}
              disabled={!batchUrls.trim() || processingVideo}
            >
              {processingVideo ? 'Processing...' : `🚀 Add ${selectedSongs.size} Videos`}
            </button>
            <button
              className="cancel-batch-button"
              onClick={() => {
                setSelectedSongs(new Set());
                setBatchUrls('');
              }}
              disabled={processingVideo}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="songs-grid">
        {songsNeedingVideos.map(song => (
          <div key={song.id} className={`song-card ${batchMode && selectedSongs.has(song.id) ? 'selected' : ''}`}>
            {batchMode && (
              <div className="selection-checkbox">
                <input
                  type="checkbox"
                  checked={selectedSongs.has(song.id)}
                  onChange={() => toggleSongSelection(song.id)}
                  id={`song-${song.id}`}
                />
                <label htmlFor={`song-${song.id}`} className="checkbox-label">
                  {selectedSongs.has(song.id) && (
                    <span className="selection-number">
                      {Array.from(selectedSongs).indexOf(song.id) + 1}
                    </span>
                  )}
                </label>
              </div>
            )}
            <div className="song-info">
              <h4 className="song-title">{song.title}</h4>
              <p className="song-artist">{song.artists}</p>
              {song.popularity > 0 && (
                <span className="popularity-badge">
                  🔥 {song.popularity}% popular
                </span>
              )}
            </div>
            <div className="song-actions">
              {!batchMode && (
                <button
                  className="search-video-button"
                  onClick={() => searchYouTube(song)}
                >
                  🎥 Find Video
                </button>
              )}
              {batchMode && (
                <button
                  className={`select-song-button ${selectedSongs.has(song.id) ? 'selected' : ''}`}
                  onClick={() => toggleSongSelection(song.id)}
                >
                  {selectedSongs.has(song.id) ? '✓ Selected' : 'Select'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {pagination.pages > 1 && (
        <div className="pagination">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="pagination-button"
          >
            ← Previous
          </button>
          
          <span className="pagination-info">
            Page {currentPage} of {pagination.pages}
          </span>
          
          <button
            onClick={() => setCurrentPage(prev => Math.min(pagination.pages, prev + 1))}
            disabled={currentPage === pagination.pages}
            className="pagination-button"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

export default YouTubeVideoManager;