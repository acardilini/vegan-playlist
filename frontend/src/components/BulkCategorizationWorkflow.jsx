import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:5000/api';
const ADMIN_PASSWORD = 'admin123';

function BulkCategorizationWorkflow() {
  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [categoryOptions, setCategoryOptions] = useState({});
  const [workflowMode, setWorkflowMode] = useState('uncategorized'); // 'uncategorized', 'all', 'filtered'
  const [filters, setFilters] = useState({});
  const [batchCategories, setBatchCategories] = useState({
    vegan_focus: [],
    animal_category: [],
    advocacy_style: [],
    advocacy_issues: [],
    lyrical_explicitness: []
  });
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  
  const workflowRef = useRef();

  // Keyboard shortcuts configuration - easily changeable
  const keyboardShortcuts = {
    // Navigation
    'ArrowRight': () => navigateToNext(),
    'ArrowLeft': () => navigateToPrevious(),
    'Space': () => toggleCurrentSong(),
    
    // Quick categorization (easily updatable as framework evolves)
    'v': () => quickCategory('vegan_focus', 'animals'),
    'h': () => quickCategory('vegan_focus', 'health'),
    'e': () => quickCategory('vegan_focus', 'environment'),
    'f': () => quickCategory('animal_category', 'farm_animals'),
    'w': () => quickCategory('animal_category', 'wild_animals'),
    'd': () => quickCategory('advocacy_style', 'direct'),
    's': () => quickCategory('advocacy_style', 'subtle'),
    'n': () => quickCategory('advocacy_style', 'educational'),
    
    // Batch operations
    'b': () => openBatchCategoryModal(),
    'Enter': () => saveCurrentSong(),
    'Escape': () => clearCurrentCategories(),
  };

  useEffect(() => {
    loadCategorizationOptions();
    loadSongsForCategorization();
  }, [workflowMode, filters]);

  // Keyboard event handler
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      const key = e.key === ' ' ? 'Space' : e.key;
      if (keyboardShortcuts[key]) {
        e.preventDefault();
        keyboardShortcuts[key]();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [currentIndex, songs]);

  const loadCategorizationOptions = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/categorization-options`, {
        headers: { 'X-Admin-Password': ADMIN_PASSWORD }
      });
      if (response.ok) {
        const options = await response.json();
        setCategoryOptions(options);
      }
    } catch (error) {
      console.error('Error loading categorization options:', error);
    }
  };

  const loadSongsForCategorization = async () => {
    try {
      setLoading(true);
      let endpoint = `${API_BASE}/admin/all-songs?limit=50`;
      
      // Modify endpoint based on workflow mode
      if (workflowMode === 'uncategorized') {
        endpoint += '&uncategorized=true';
      } else if (workflowMode === 'filtered') {
        // Add filter parameters
        Object.entries(filters).forEach(([key, value]) => {
          if (value && value.length > 0) {
            endpoint += `&${key}=${encodeURIComponent(value.join(','))}`;
          }
        });
      }

      const response = await fetch(endpoint, {
        headers: { 'X-Admin-Password': ADMIN_PASSWORD }
      });
      
      if (response.ok) {
        const data = await response.json();
        setSongs(data.songs || []);
        setProgress({ completed: 0, total: data.songs?.length || 0 });
        setCurrentIndex(0);
        setMessage(`Loaded ${data.songs?.length || 0} songs for categorization`);
      }
    } catch (error) {
      console.error('Error loading songs:', error);
      setMessage('Failed to load songs for categorization');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentSong = () => songs[currentIndex] || null;

  const navigateToNext = () => {
    if (currentIndex < songs.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const navigateToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const quickCategory = (field, value) => {
    const currentSong = getCurrentSong();
    if (!currentSong) return;

    const updatedSongs = [...songs];
    const song = updatedSongs[currentIndex];
    
    if (!song.categories) song.categories = {};
    if (!song.categories[field]) song.categories[field] = [];
    
    // Toggle category
    if (song.categories[field].includes(value)) {
      song.categories[field] = song.categories[field].filter(v => v !== value);
    } else {
      song.categories[field].push(value);
    }
    
    setSongs(updatedSongs);
    
    // Auto-advance if enabled
    if (autoAdvance) {
      setTimeout(navigateToNext, 200);
    }
  };

  const saveCurrentSong = async () => {
    const currentSong = getCurrentSong();
    if (!currentSong || !currentSong.categories) return;

    try {
      const response = await fetch(`${API_BASE}/admin/songs/${currentSong.id}/categorize`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        },
        body: JSON.stringify(currentSong.categories)
      });

      if (response.ok) {
        setMessage(`✅ Saved categories for "${currentSong.title}"`);
        setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
        
        if (autoAdvance) {
          setTimeout(navigateToNext, 500);
        }
      } else {
        setMessage(`❌ Failed to save categories for "${currentSong.title}"`);
      }
    } catch (error) {
      console.error('Error saving categories:', error);
      setMessage('❌ Error saving categories');
    }
  };

  const clearCurrentCategories = () => {
    const updatedSongs = [...songs];
    const song = updatedSongs[currentIndex];
    if (song) {
      song.categories = {};
      setSongs(updatedSongs);
    }
  };

  const applyBatchCategories = () => {
    // Apply batch categories to all selected songs
    const updatedSongs = songs.map(song => {
      if (song.selected) {
        if (!song.categories) song.categories = {};
        Object.entries(batchCategories).forEach(([field, values]) => {
          if (values.length > 0) {
            song.categories[field] = [...(song.categories[field] || []), ...values];
            // Remove duplicates
            song.categories[field] = [...new Set(song.categories[field])];
          }
        });
      }
      return song;
    });
    setSongs(updatedSongs);
    setBatchCategories({
      vegan_focus: [],
      animal_category: [],
      advocacy_style: [],
      advocacy_issues: [],
      lyrical_explicitness: []
    });
  };

  const toggleCurrentSong = () => {
    const updatedSongs = [...songs];
    updatedSongs[currentIndex].selected = !updatedSongs[currentIndex].selected;
    setSongs(updatedSongs);
  };

  if (loading) {
    return (
      <div className="bulk-categorization-workflow">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading songs for categorization...</p>
        </div>
      </div>
    );
  }

  const currentSong = getCurrentSong();

  return (
    <div className="bulk-categorization-workflow" ref={workflowRef} tabIndex={0}>
      {/* Workflow Header */}
      <div className="workflow-header">
        <h2>🚀 Bulk Categorization Workflow</h2>
        <div className="workflow-controls">
          <select 
            value={workflowMode} 
            onChange={(e) => setWorkflowMode(e.target.value)}
            className="workflow-mode-select"
          >
            <option value="uncategorized">Uncategorized Songs Only</option>
            <option value="all">All Songs</option>
            <option value="filtered">Filtered Songs</option>
          </select>
          
          <label className="auto-advance-toggle">
            <input 
              type="checkbox" 
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
            />
            Auto-advance after categorization
          </label>
          
          <button 
            onClick={() => setShowKeyboardHelp(!showKeyboardHelp)}
            className="help-button"
          >
            ⌨️ Shortcuts
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="progress-section">
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${(progress.completed / progress.total) * 100}%` }}
          ></div>
        </div>
        <span className="progress-text">
          {progress.completed} of {progress.total} categorized ({Math.round((progress.completed / progress.total) * 100)}%)
        </span>
      </div>

      {/* Current Song Display */}
      {currentSong && (
        <div className="current-song-section">
          <div className="song-navigation">
            <button 
              onClick={navigateToPrevious} 
              disabled={currentIndex === 0}
              className="nav-button"
            >
              ← Previous
            </button>
            <span className="song-counter">
              Song {currentIndex + 1} of {songs.length}
            </span>
            <button 
              onClick={navigateToNext} 
              disabled={currentIndex === songs.length - 1}
              className="nav-button"
            >
              Next →
            </button>
          </div>

          <div className="current-song-card">
            <div className="song-info">
              <h3 className="song-title">{currentSong.title}</h3>
              <p className="song-artist">{currentSong.artists}</p>
              <p className="song-album">{currentSong.album_name}</p>
            </div>
            
            <div className="song-metadata">
              <span>Year: {currentSong.release_date ? new Date(currentSong.release_date).getFullYear() : 'N/A'}</span>
              <span>Popularity: {currentSong.popularity || 0}%</span>
            </div>
          </div>

          {/* Categorization Interface */}
          <div className="categorization-interface">
            {Object.entries(categoryOptions).map(([field, options]) => (
              <div key={field} className="category-section">
                <h4 className="category-title">
                  {field.replace('_', ' ').toUpperCase()}
                </h4>
                <div className="category-options">
                  {options.map(option => (
                    <button
                      key={option}
                      className={`category-button ${
                        currentSong.categories?.[field]?.includes(option) ? 'active' : ''
                      }`}
                      onClick={() => quickCategory(field, option)}
                    >
                      {option.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="action-buttons">
            <button onClick={saveCurrentSong} className="save-button">
              💾 Save Categories (Enter)
            </button>
            <button onClick={clearCurrentCategories} className="clear-button">
              🗑️ Clear (Escape)
            </button>
            <button onClick={toggleCurrentSong} className="select-button">
              {currentSong.selected ? '✅ Selected' : '☐ Select'} (Space)
            </button>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help */}
      {showKeyboardHelp && (
        <div className="keyboard-help-modal">
          <div className="modal-content">
            <h3>Keyboard Shortcuts</h3>
            <div className="shortcuts-grid">
              <div className="shortcut-group">
                <h4>Navigation</h4>
                <div>← → : Previous/Next song</div>
                <div>Space : Toggle selection</div>
                <div>Enter : Save categories</div>
                <div>Escape : Clear categories</div>
              </div>
              <div className="shortcut-group">
                <h4>Quick Categorization</h4>
                <div>V : Vegan Focus - Animals</div>
                <div>H : Vegan Focus - Health</div>
                <div>E : Vegan Focus - Environment</div>
                <div>F : Animal Category - Farm</div>
                <div>W : Animal Category - Wild</div>
                <div>D : Advocacy - Direct</div>
                <div>S : Advocacy - Subtle</div>
                <div>N : Advocacy - Educational</div>
              </div>
            </div>
            <button onClick={() => setShowKeyboardHelp(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Status Message */}
      {message && (
        <div className={`message ${message.includes('✅') ? 'success' : message.includes('❌') ? 'error' : 'info'}`}>
          {message}
        </div>
      )}
    </div>
  );
}

export default BulkCategorizationWorkflow;