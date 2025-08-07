import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5000/api';
const ADMIN_PASSWORD = 'admin123';

function LyricsLookupManager() {
  const [songsNeedingLyrics, setSongsNeedingLyrics] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [manualUrl, setManualUrl] = useState('');
  const [lyricsSource, setLyricsSource] = useState('genius'); // genius, bandcamp, other
  const [lyricsHighlights, setLyricsHighlights] = useState('');
  const [message, setMessage] = useState('');
  const [processingLyrics, setProcessingLyrics] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedSongs, setSelectedSongs] = useState(new Set());
  const [batchUrls, setBatchUrls] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  useEffect(() => {
    loadSongsNeedingLyrics();
  }, [currentPage]);

  const loadSongsNeedingLyrics = async () => {
    try {
      setLoading(true);
      // We'll need to create this endpoint - for now, simulate
      const response = await fetch(`${API_BASE}/admin/songs-missing-lyrics?page=${currentPage}&limit=20`, {
        headers: {
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setSongsNeedingLyrics(data.songs || []);
        setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
        setNeedsSetup(!data.hasLyricsSupport);
        if (data.message) {
          setMessage(data.message);
        }
      } else {
        // Fallback - use regular songs endpoint for now
        const fallbackResponse = await fetch(`${API_BASE}/admin/all-songs?limit=20`, {
          headers: {
            'X-Admin-Password': ADMIN_PASSWORD
          }
        });
        const fallbackData = await fallbackResponse.json();
        setSongsNeedingLyrics(fallbackData.songs || []);
        setPagination({ page: 1, pages: 5, total: fallbackData.songs?.length || 0 });
      }
    } catch (error) {
      console.error('Error loading songs:', error);
      setMessage('Failed to load songs');
    } finally {
      setLoading(false);
    }
  };

  const openGeniusSearch = (song) => {
    const query = encodeURIComponent(`${song.artists} ${song.title} lyrics`);
    window.open(`https://genius.com/search?q=${query}`, '_blank');
  };

  const openBandcampSearch = (song) => {
    const query = encodeURIComponent(`${song.artists} ${song.title}`);
    window.open(`https://bandcamp.com/search?q=${query}`, '_blank');
  };

  const openGoogleSearch = (song) => {
    const query = encodeURIComponent(`"${song.title}" "${song.artists}" lyrics site:genius.com OR site:bandcamp.com`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
  };

  const saveLyricsLink = async (song, lyricsUrl, source = lyricsSource) => {
    if (!lyricsUrl.trim()) {
      setMessage('Please enter a lyrics URL');
      return;
    }

    try {
      setProcessingLyrics(true);
      setMessage('Saving lyrics link...');

      const response = await fetch(`${API_BASE}/admin/save-lyrics-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        },
        body: JSON.stringify({
          song_id: song.id,
          lyrics_url: lyricsUrl.trim(),
          lyrics_source: source,
          lyrics_highlights: lyricsHighlights.trim(),
          link_type: 'external' // We only store links, never content
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setMessage(`✅ Lyrics link saved for "${song.title}"!`);
        setManualUrl('');
        setLyricsHighlights('');
        setSelectedSong(null);
        setLyricsSource('genius'); // Reset to default
        loadSongsNeedingLyrics(); // Refresh list
      } else {
        setMessage(`❌ Failed to save lyrics link: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving lyrics link:', error);
      setMessage('❌ Failed to save lyrics link');
    } finally {
      setProcessingLyrics(false);
    }
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
      setMessage('Please enter lyrics URLs');
      return;
    }

    const urls = batchUrls.split('\n').filter(url => url.trim());
    const selectedSongsList = songsNeedingLyrics.filter(song => selectedSongs.has(song.id));
    
    if (urls.length !== selectedSongsList.length) {
      setMessage(`❌ Mismatch: ${selectedSongsList.length} songs selected but ${urls.length} URLs provided`);
      return;
    }

    setProcessingLyrics(true);
    setMessage('Processing batch lyrics links...');
    
    let successCount = 0;
    let errors = [];

    for (let i = 0; i < urls.length; i++) {
      const song = selectedSongsList[i];
      const url = urls[i].trim();
      
      // Determine source from URL
      let detectedSource = 'other';
      if (url.includes('genius.com')) detectedSource = 'genius';
      else if (url.includes('bandcamp.com')) detectedSource = 'bandcamp';
      
      try {
        const response = await fetch(`${API_BASE}/admin/save-lyrics-link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Password': ADMIN_PASSWORD
          },
          body: JSON.stringify({
            song_id: song.id,
            lyrics_url: url,
            lyrics_source: detectedSource,
            link_type: 'external'
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

    setProcessingLyrics(false);
    
    if (successCount > 0) {
      setMessage(`✅ Added ${successCount} lyrics links!${errors.length > 0 ? ` ${errors.length} errors.` : ''}`);
      setSelectedSongs(new Set());
      setBatchUrls('');
      setBatchMode(false);
      loadSongsNeedingLyrics();
    } else {
      setMessage(`❌ No lyrics links added. Errors: ${errors.slice(0, 3).join(', ')}`);
    }
  };

  const setupLyricsDatabase = async () => {
    try {
      setSettingUp(true);
      setMessage('Setting up lyrics database...');

      const response = await fetch(`${API_BASE}/admin/setup-lyrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });

      const result = await response.json();
      
      if (result.success) {
        setMessage(`✅ ${result.message}`);
        setNeedsSetup(false);
        // Reload songs list now that database is ready
        setTimeout(() => {
          loadSongsNeedingLyrics();
        }, 1000);
      } else {
        setMessage(`❌ Setup failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error setting up lyrics database:', error);
      setMessage('❌ Failed to set up lyrics database');
    } finally {
      setSettingUp(false);
    }
  };

  const validateLyricsUrl = (url) => {
    if (!url) return false;
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch {
      return false;
    }
  };

  if (loading) {
    return (
      <div className="lyrics-manager">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading songs that need lyrics links...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lyrics-manager">
      <div className="lyrics-manager-header">
        <h2>📝 Lyrics Lookup Manager</h2>
        <p className="disclaimer">
          <strong>Copyright Safe:</strong> This tool helps you find and link to lyrics on external sites. 
          No copyrighted lyrics content is stored in your database.
        </p>
        
        {needsSetup ? (
          <div className="setup-required">
            <h3>🔧 Database Setup Required</h3>
            <p>The lyrics functionality needs to be enabled in your database first.</p>
            <button
              className="setup-button"
              onClick={setupLyricsDatabase}
              disabled={settingUp}
            >
              {settingUp ? '⚙️ Setting up...' : '🚀 Enable Lyrics Functionality'}
            </button>
          </div>
        ) : (
          <p className="stats">
            {pagination.total || 0} songs available for lyrics linking • Page {pagination.page} of {pagination.pages}
          </p>
        )}
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
              Select songs below, then paste lyrics URLs in the same order
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
        <div className="lyrics-search-modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>🔍 Find Lyrics: {selectedSong.title} by {selectedSong.artists}</h3>
              <button 
                className="close-button" 
                onClick={() => {setSelectedSong(null); setManualUrl(''); setLyricsHighlights('');}}
              >
                ✕
              </button>
            </div>
            
            <div className="search-actions">
              <button 
                className="genius-search-button"
                onClick={() => openGeniusSearch(selectedSong)}
              >
                🎵 Search Genius
              </button>
              <button 
                className="bandcamp-search-button"
                onClick={() => openBandcampSearch(selectedSong)}
              >
                🎶 Search Bandcamp
              </button>
              <button 
                className="google-search-button"
                onClick={() => openGoogleSearch(selectedSong)}
              >
                🔍 Google Search
              </button>
              <span className="search-hint">Opens lyrics sites in new tabs - copy the URL back here</span>
            </div>

            <div className="manual-url-section">
              <h4>📝 Paste Lyrics URL:</h4>
              <div className="source-selector">
                <h5 style={{color: '#333', marginBottom: '10px'}}>Choose lyrics source:</h5>
                <label style={{color: '#333', fontWeight: '500'}}>
                  <input
                    type="radio"
                    value="genius"
                    checked={lyricsSource === 'genius'}
                    onChange={(e) => setLyricsSource(e.target.value)}
                  />
                  <span style={{marginLeft: '5px'}}>🎵 Genius.com</span>
                </label>
                <label style={{color: '#333', fontWeight: '500'}}>
                  <input
                    type="radio"
                    value="bandcamp"
                    checked={lyricsSource === 'bandcamp'}
                    onChange={(e) => setLyricsSource(e.target.value)}
                  />
                  <span style={{marginLeft: '5px'}}>🎶 Bandcamp.com</span>
                </label>
                <label style={{color: '#333', fontWeight: '500'}}>
                  <input
                    type="radio"
                    value="other"
                    checked={lyricsSource === 'other'}
                    onChange={(e) => setLyricsSource(e.target.value)}
                  />
                  <span style={{marginLeft: '5px'}}>🌐 Other site</span>
                </label>
              </div>
              <div className="url-input-group">
                <input
                  type="url"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="https://genius.com/... or https://bandcamp.com/..."
                  className="url-input"
                />
                <button
                  className="save-lyrics-button"
                  onClick={() => saveLyricsLink(selectedSong, manualUrl)}
                  disabled={!manualUrl.trim() || processingLyrics}
                >
                  {processingLyrics ? 'Saving...' : 'Save Link'}
                </button>
              </div>
              {manualUrl && validateLyricsUrl(manualUrl) && (
                <div className="url-preview">
                  ✅ Valid URL detected
                </div>
              )}
              
              <div className="lyrics-highlights-section">
                <h4>🌱 Vegan/Animal Lyrics Highlights (Optional)</h4>
                <p className="highlights-hint">
                  Copy and paste key lines or phrases that relate to animals, veganism, or ethical themes. 
                  This helps build your vegan music database for analysis.
                </p>
                <textarea
                  className="lyrics-highlights-textarea"
                  value={lyricsHighlights}
                  onChange={(e) => setLyricsHighlights(e.target.value)}
                  placeholder="Example brief excerpts:
- Lines about animal rights or welfare
- Mentions of plant-based living  
- Environmental or ethical themes
- Factory farming references

Brief excerpts that highlight the song's vegan/animal themes..."
                  rows={6}
                />
                <small className="copyright-note">
                  📝 <strong>Fair Use:</strong> Brief excerpts for analytical purposes only - no full content stored
                </small>
              </div>
            </div>
          </div>
        </div>
      )}

      {batchMode && selectedSongs.size > 0 && (
        <div className="batch-processing">
          <h3>📋 Batch Process {selectedSongs.size} Songs</h3>
          <p>Paste lyrics URLs below, one per line, in the same order as the selected songs:</p>
          <div className="selected-songs-preview">
            {songsNeedingLyrics.filter(song => selectedSongs.has(song.id)).map((song, index) => (
              <div key={song.id} className="selected-song-item">
                <span className="song-number">{index + 1}.</span>
                <span className="song-name">{song.title} by {song.artists}</span>
              </div>
            ))}
          </div>
          <textarea
            value={batchUrls}
            onChange={(e) => setBatchUrls(e.target.value)}
            placeholder="https://genius.com/...
https://bandcamp.com/...
https://genius.com/..."
            className="batch-urls-input"
            rows={Math.max(3, selectedSongs.size)}
          />
          <div className="batch-actions">
            <button
              className="process-batch-button"
              onClick={processBatchUrls}
              disabled={!batchUrls.trim() || processingLyrics}
            >
              {processingLyrics ? 'Processing...' : `🚀 Save ${selectedSongs.size} Lyrics Links`}
            </button>
            <button
              className="cancel-batch-button"
              onClick={() => {
                setSelectedSongs(new Set());
                setBatchUrls('');
              }}
              disabled={processingLyrics}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="songs-grid">
        {songsNeedingLyrics.map(song => (
          <div key={song.id} className={`song-card ${batchMode && selectedSongs.has(song.id) ? 'selected' : ''}`}>
            {batchMode && (
              <div className="selection-checkbox">
                <input
                  type="checkbox"
                  checked={selectedSongs.has(song.id)}
                  onChange={() => toggleSongSelection(song.id)}
                  id={`lyrics-song-${song.id}`}
                />
                <label htmlFor={`lyrics-song-${song.id}`} className="checkbox-label">
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
              {/* Show if lyrics link already exists */}
              {song.lyrics_url && (
                <span className="lyrics-status">
                  ✅ Has lyrics link
                </span>
              )}
            </div>
            <div className="song-actions">
              {!batchMode && (
                <button
                  className="find-lyrics-button"
                  onClick={() => setSelectedSong(song)}
                >
                  📝 Find Lyrics
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

export default LyricsLookupManager;