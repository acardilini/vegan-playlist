import { useState, useEffect } from 'react';
import BulkEditModal from './BulkEditModal';

const API_BASE = 'http://localhost:5000/api/admin';

function AdminInterface() {
  const [activeTab, setActiveTab] = useState('manage-songs');
  const [allSongs, setAllSongs] = useState([]);
  const [categorOptions, setCategorOptions] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSong, setEditingSong] = useState(null);
  const [editingCategorization, setEditingCategorization] = useState(null);

  // Complete form state with all Spotify fields
  const [songForm, setSongForm] = useState({
    title: '',
    artist_names: [''],
    album_name: '',
    duration_ms: '',
    release_date: '',
    external_url: '',
    audio_file_path: '',
    lyrics: '',
    notes: '',
    popularity: '',
    explicit: false,
    track_number: '',
    disc_number: '',
    custom_mood: '',
    genre: '',
    parent_genre: '',
    vegan_focus: [],
    animal_category: [],
    advocacy_style: [],
    advocacy_issues: [],
    lyrical_explicitness: [],
    your_review: '',
    audio_review_url: '',
    inclusion_notes: '',
    rating: '',
    // Audio features
    energy: '',
    danceability: '',
    valence: '',
    acousticness: '',
    instrumentalness: '',
    liveness: '',
    speechiness: '',
    tempo: '',
    loudness: '',
    key: '',
    mode: '',
    time_signature: ''
  });

  useEffect(() => {
    loadCategorizationOptions();
    loadAllSongs();
  }, [searchTerm]);

  const loadCategorizationOptions = async () => {
    try {
      const response = await fetch(`${API_BASE}/categorization-options`);
      const options = await response.json();
      console.log('Loaded categorization options:', options);
      setCategorOptions(options);
    } catch (error) {
      console.error('Error loading categorization options:', error);
      setMessage('Error loading categorization options');
    }
  };

  const loadAllSongs = async () => {
    try {
      setLoading(true);
      const searchParam = searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : '';
      const response = await fetch(`${API_BASE}/all-songs?limit=50${searchParam}`);
      const data = await response.json();
      setAllSongs(data.songs);
    } catch (error) {
      console.error('Error loading songs:', error);
      setMessage('Error loading songs');
    } finally {
      setLoading(false);
    }
  };


  const handleInputChange = (field, value) => {
    setSongForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleArrayChange = (field, value, checked) => {
    setSongForm(prev => ({
      ...prev,
      [field]: checked 
        ? [...prev[field], value]
        : prev[field].filter(v => v !== value)
    }));
  };

  const addArtistField = () => {
    setSongForm(prev => ({
      ...prev,
      artist_names: [...prev.artist_names, '']
    }));
  };

  const updateArtistName = (index, value) => {
    setSongForm(prev => ({
      ...prev,
      artist_names: prev.artist_names.map((name, i) => i === index ? value : name)
    }));
  };

  const removeArtistField = (index) => {
    setSongForm(prev => ({
      ...prev,
      artist_names: prev.artist_names.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      setMessage('');
      
      // Clean up the form data
      const formData = {
        ...songForm,
        artist_names: songForm.artist_names.filter(name => name.trim()),
        duration_ms: songForm.duration_ms ? parseInt(songForm.duration_ms) : null,
        popularity: songForm.popularity ? parseInt(songForm.popularity) : null,
        track_number: songForm.track_number ? parseInt(songForm.track_number) : null,
        disc_number: songForm.disc_number ? parseInt(songForm.disc_number) : null,
        rating: songForm.rating ? parseInt(songForm.rating) : null,
        key: songForm.key !== '' ? parseInt(songForm.key) : null,
        mode: songForm.mode !== '' ? parseInt(songForm.mode) : null,
        time_signature: songForm.time_signature ? parseInt(songForm.time_signature) : null,
        // Convert audio features to floats
        energy: songForm.energy !== '' ? parseFloat(songForm.energy) : null,
        danceability: songForm.danceability !== '' ? parseFloat(songForm.danceability) : null,
        valence: songForm.valence !== '' ? parseFloat(songForm.valence) : null,
        acousticness: songForm.acousticness !== '' ? parseFloat(songForm.acousticness) : null,
        instrumentalness: songForm.instrumentalness !== '' ? parseFloat(songForm.instrumentalness) : null,
        liveness: songForm.liveness !== '' ? parseFloat(songForm.liveness) : null,
        speechiness: songForm.speechiness !== '' ? parseFloat(songForm.speechiness) : null,
        tempo: songForm.tempo !== '' ? parseFloat(songForm.tempo) : null,
        loudness: songForm.loudness !== '' ? parseFloat(songForm.loudness) : null
      };
      
      const url = editingSong 
        ? `${API_BASE}/manual-songs/${editingSong.id}`
        : `${API_BASE}/manual-songs`;
      const method = editingSong ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setMessage(editingSong ? 'Song updated successfully!' : 'Song added successfully!');
        setEditingSong(null);
        setShowAddForm(false);
        // Reset form
        setSongForm({
          title: '',
          artist_names: [''],
          album_name: '',
          duration_ms: '',
          release_date: '',
          external_url: '',
          audio_file_path: '',
          lyrics: '',
          notes: '',
          popularity: '',
          explicit: false,
          track_number: '',
          disc_number: '',
          custom_mood: '',
          vegan_focus: [],
          animal_category: [],
          advocacy_style: [],
          advocacy_issues: [],
          lyrical_explicitness: [],
          your_review: '',
          audio_review_url: '',
          inclusion_notes: '',
          rating: '',
          energy: '',
          danceability: '',
          valence: '',
          acousticness: '',
          instrumentalness: '',
          liveness: '',
          speechiness: '',
          tempo: '',
          loudness: '',
          key: '',
          mode: '',
          time_signature: ''
        });
        loadAllSongs();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving song:', error);
      setMessage('Error saving song');
    } finally {
      setLoading(false);
    }
  };

  const handleEditSong = (song) => {
    setEditingSong(song);
    setSongForm({
      title: song.title || '',
      artist_names: song.artist_names || [''],
      album_name: song.album_name || '',
      duration_ms: song.duration_ms || '',
      release_date: song.release_date || '',
      external_url: song.external_url || '',
      audio_file_path: song.audio_file_path || '',
      lyrics: song.lyrics || '',
      notes: song.notes || '',
      popularity: song.popularity || '',
      explicit: song.explicit || false,
      track_number: song.track_number || '',
      disc_number: song.disc_number || '',
      custom_mood: song.custom_mood || '',
      vegan_focus: song.vegan_focus || [],
      animal_category: song.animal_category || [],
      advocacy_style: song.advocacy_style || [],
      advocacy_issues: song.advocacy_issues || [],
      lyrical_explicitness: song.lyrical_explicitness || [],
      your_review: song.your_review || '',
      audio_review_url: song.audio_review_url || '',
      inclusion_notes: song.inclusion_notes || '',
      rating: song.rating || '',
      energy: song.energy || '',
      danceability: song.danceability || '',
      valence: song.valence || '',
      acousticness: song.acousticness || '',
      instrumentalness: song.instrumentalness || '',
      liveness: song.liveness || '',
      speechiness: song.speechiness || '',
      tempo: song.tempo || '',
      loudness: song.loudness || '',
      key: song.key !== null && song.key !== undefined ? song.key : '',
      mode: song.mode !== null && song.mode !== undefined ? song.mode : '',
      time_signature: song.time_signature || ''
    });
    setShowAddForm(true);
  };

  const handleDeleteSong = async (songId) => {
    if (!confirm('Are you sure you want to delete this song? This action cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/manual-songs/${songId}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      
      if (result.success) {
        setMessage('Song deleted successfully!');
        loadAllSongs();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error deleting song:', error);
      setMessage('Error deleting song');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingSong(null);
    setShowAddForm(false);
    setSongForm({
      title: '',
      artist_names: [''],
      album_name: '',
      duration_ms: '',
      release_date: '',
      external_url: '',
      audio_file_path: '',
      lyrics: '',
      notes: '',
      popularity: '',
      explicit: false,
      track_number: '',
      disc_number: '',
      custom_mood: '',
      vegan_focus: [],
      animal_category: [],
      advocacy_style: [],
      advocacy_issues: [],
      lyrical_explicitness: [],
      your_review: '',
      audio_review_url: '',
      inclusion_notes: '',
      rating: '',
      energy: '',
      danceability: '',
      valence: '',
      acousticness: '',
      instrumentalness: '',
      liveness: '',
      speechiness: '',
      tempo: '',
      loudness: '',
      key: '',
      mode: '',
      time_signature: ''
    });
  };

  const handleEditCategorization = (song) => {
    console.log('Editing categorization for song:', song);
    console.log('Available categorization options:', categorOptions);
    setEditingCategorization({
      id: song.id,
      title: song.title,
      artists: song.artists,
      source_type: song.source_type,
      album_name: song.album_name || '',
      duration_ms: song.duration_ms || '',
      popularity: song.popularity || '',
      explicit: song.explicit || false,
      track_number: song.track_number || '',
      disc_number: song.disc_number || '',
      custom_mood: song.custom_mood || '',
      genre: song.genre || '',
      parent_genre: song.parent_genre || '',
      spotify_url: song.spotify_url || '',
      preview_url: song.preview_url || '',
      external_url: song.external_url || '',
      audio_file_path: song.audio_file_path || '',
      lyrics: song.lyrics || '',
      notes: song.notes || '',
      // Categorization fields
      vegan_focus: song.vegan_focus || [],
      animal_category: song.animal_category || [],
      advocacy_style: song.advocacy_style || [],
      advocacy_issues: song.advocacy_issues || [],
      lyrical_explicitness: song.lyrical_explicitness || [],
      your_review: song.your_review || '',
      audio_review_url: song.audio_review_url || '',
      inclusion_notes: song.inclusion_notes || '',
      rating: song.rating || '',
      // Audio features
      energy: song.energy || '',
      danceability: song.danceability || '',
      valence: song.valence || '',
      acousticness: song.acousticness || '',
      instrumentalness: song.instrumentalness || '',
      liveness: song.liveness || '',
      speechiness: song.speechiness || '',
      tempo: song.tempo || '',
      loudness: song.loudness || '',
      key: song.key !== null && song.key !== undefined ? song.key : '',
      mode: song.mode !== null && song.mode !== undefined ? song.mode : '',
      time_signature: song.time_signature || ''
    });
  };

  const handleSaveCategorization = async () => {
    try {
      setLoading(true);
      setMessage('');
      
      const response = await fetch(`${API_BASE}/songs/${editingCategorization.id}/categorize`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // Basic info
          title: editingCategorization.title,
          album_name: editingCategorization.album_name,
          duration_ms: editingCategorization.duration_ms ? parseInt(editingCategorization.duration_ms) : null,
          popularity: editingCategorization.popularity ? parseInt(editingCategorization.popularity) : null,
          explicit: editingCategorization.explicit,
          track_number: editingCategorization.track_number ? parseInt(editingCategorization.track_number) : null,
          disc_number: editingCategorization.disc_number ? parseInt(editingCategorization.disc_number) : null,
          custom_mood: editingCategorization.custom_mood,
          external_url: editingCategorization.external_url,
          audio_file_path: editingCategorization.audio_file_path,
          lyrics: editingCategorization.lyrics,
          notes: editingCategorization.notes,
          // Categorization
          vegan_focus: editingCategorization.vegan_focus,
          animal_category: editingCategorization.animal_category,
          advocacy_style: editingCategorization.advocacy_style,
          advocacy_issues: editingCategorization.advocacy_issues,
          lyrical_explicitness: editingCategorization.lyrical_explicitness,
          your_review: editingCategorization.your_review,
          audio_review_url: editingCategorization.audio_review_url,
          inclusion_notes: editingCategorization.inclusion_notes,
          rating: editingCategorization.rating,
          // Audio features
          energy: editingCategorization.energy !== '' ? parseFloat(editingCategorization.energy) : null,
          danceability: editingCategorization.danceability !== '' ? parseFloat(editingCategorization.danceability) : null,
          valence: editingCategorization.valence !== '' ? parseFloat(editingCategorization.valence) : null,
          acousticness: editingCategorization.acousticness !== '' ? parseFloat(editingCategorization.acousticness) : null,
          instrumentalness: editingCategorization.instrumentalness !== '' ? parseFloat(editingCategorization.instrumentalness) : null,
          liveness: editingCategorization.liveness !== '' ? parseFloat(editingCategorization.liveness) : null,
          speechiness: editingCategorization.speechiness !== '' ? parseFloat(editingCategorization.speechiness) : null,
          tempo: editingCategorization.tempo !== '' ? parseFloat(editingCategorization.tempo) : null,
          loudness: editingCategorization.loudness !== '' ? parseFloat(editingCategorization.loudness) : null,
          key: editingCategorization.key !== '' ? parseInt(editingCategorization.key) : null,
          mode: editingCategorization.mode !== '' ? parseInt(editingCategorization.mode) : null,
          time_signature: editingCategorization.time_signature !== '' ? parseInt(editingCategorization.time_signature) : null
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setMessage('Categorization updated successfully!');
        setEditingCategorization(null);
        loadAllSongs();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error updating categorization:', error);
      setMessage('Error updating categorization');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelCategorization = () => {
    setEditingCategorization(null);
  };

  const handleCategorizationArrayChange = (field, value, checked) => {
    setEditingCategorization(prev => ({
      ...prev,
      [field]: checked 
        ? [...prev[field], value]
        : prev[field].filter(v => v !== value)
    }));
  };

  const handleCategorizationInputChange = (field, value) => {
    setEditingCategorization(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const formatDuration = (durationMs) => {
    if (!durationMs) return '';
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const CompactSelect = ({ field, title, options, value, onChange }) => {
    const currentValue = value || songForm?.[field] || [];
    const handleChange = onChange || ((field, value, checked) => {
      setSongForm(prev => ({
        ...prev,
        [field]: checked 
          ? [...prev[field], value]
          : prev[field].filter(v => v !== value)
      }));
    });

    return (
      <div className="compact-form-group">
        <label className="compact-label">{title}</label>
        <select 
          className="compact-select"
          multiple
          value={currentValue}
          onChange={(e) => {
            const values = Array.from(e.target.selectedOptions, option => option.value);
            if (onChange) {
              // For categorization modal, we need to set the entire array
              if (field === 'vegan_focus') {
                setEditingCategorization(prev => ({ ...prev, vegan_focus: values }));
              } else if (field === 'animal_category') {
                setEditingCategorization(prev => ({ ...prev, animal_category: values }));
              } else if (field === 'advocacy_style') {
                setEditingCategorization(prev => ({ ...prev, advocacy_style: values }));
              } else if (field === 'advocacy_issues') {
                setEditingCategorization(prev => ({ ...prev, advocacy_issues: values }));
              } else if (field === 'lyrical_explicitness') {
                setEditingCategorization(prev => ({ ...prev, lyrical_explicitness: values }));
              }
            } else {
              // For add song form
              setSongForm(prev => ({ ...prev, [field]: values }));
            }
          }}
        >
          {(options || []).map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
    );
  };


  return (
    <div className="admin-interface">
      <div className="admin-header">
        <div className="admin-title">
          <h1>Admin Dashboard</h1>
          <p>Manage songs and categorizations</p>
        </div>
        <div className="admin-actions">
          <button 
            className="compact-btn secondary"
            onClick={() => setShowBulkEdit(true)}
          >
            📊 Bulk Edit Songs
          </button>
          <button 
            className="compact-btn primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Cancel' : '+ Add Manual Song'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`admin-message ${message.includes('Error') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      {/* Compact Add/Edit Form */}
      {showAddForm && (
        <div className="compact-form-container">
          <div className="compact-form-header">
            <h3>{editingSong ? 'Edit Manual Song' : 'Add Manual Song'}</h3>
          </div>
          
          <form onSubmit={handleSubmit} className="compact-form">
            {/* Basic Information Section */}
            <div className="form-section">
              <h4 className="section-title">Basic Information</h4>
              <div className="compact-form-grid">
                <div className="compact-form-group">
                  <label className="compact-label">Title *</label>
                  <input
                    type="text"
                    className="compact-input"
                    value={songForm.title}
                    onChange={(e) => handleInputChange('title', e.target.value)}
                    required
                    placeholder="Song title"
                  />
                </div>
                
                <div className="compact-form-group">
                  <label className="compact-label">Artist(s) *</label>
                  <div className="artist-inputs">
                    {songForm.artist_names.map((name, index) => (
                      <div key={index} className="artist-input-row">
                        <input
                          type="text"
                          className="compact-input"
                          value={name}
                          onChange={(e) => updateArtistName(index, e.target.value)}
                          placeholder="Artist name"
                          required={index === 0}
                        />
                        {index > 0 && (
                          <button 
                            type="button" 
                            onClick={() => removeArtistField(index)}
                            className="remove-btn"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={addArtistField} className="add-artist-btn">
                      + Add Artist
                    </button>
                  </div>
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Album</label>
                  <input
                    type="text"
                    className="compact-input"
                    value={songForm.album_name}
                    onChange={(e) => handleInputChange('album_name', e.target.value)}
                    placeholder="Album name"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Duration (ms)</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.duration_ms}
                    onChange={(e) => handleInputChange('duration_ms', e.target.value)}
                    placeholder="Duration in milliseconds"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Release Date</label>
                  <input
                    type="date"
                    className="compact-input"
                    value={songForm.release_date}
                    onChange={(e) => handleInputChange('release_date', e.target.value)}
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Popularity (0-100)</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.popularity}
                    onChange={(e) => handleInputChange('popularity', e.target.value)}
                    min="0"
                    max="100"
                    placeholder="Spotify popularity score"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Track #</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.track_number}
                    onChange={(e) => handleInputChange('track_number', e.target.value)}
                    min="1"
                    placeholder="Track number"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Disc #</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.disc_number}
                    onChange={(e) => handleInputChange('disc_number', e.target.value)}
                    min="1"
                    placeholder="Disc number"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Custom Mood</label>
                  <input
                    type="text"
                    className="compact-input"
                    value={songForm.custom_mood}
                    onChange={(e) => handleInputChange('custom_mood', e.target.value)}
                    placeholder="Happy, Sad, Energetic, etc."
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Genre</label>
                  <CompactSelect
                    value={songForm.genre}
                    onChange={(value) => handleInputChange('genre', value)}
                    options={categorOptions.subgenres || []}
                    placeholder="Select specific genre"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Parent Genre</label>
                  <CompactSelect
                    value={songForm.parent_genre}
                    onChange={(value) => handleInputChange('parent_genre', value)}
                    options={categorOptions.parent_genres || []}
                    placeholder="Select parent genre"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">External URL</label>
                  <input
                    type="url"
                    className="compact-input"
                    value={songForm.external_url}
                    onChange={(e) => handleInputChange('external_url', e.target.value)}
                    placeholder="YouTube, Bandcamp, etc."
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Audio File Path</label>
                  <input
                    type="text"
                    className="compact-input"
                    value={songForm.audio_file_path}
                    onChange={(e) => handleInputChange('audio_file_path', e.target.value)}
                    placeholder="Path to local audio file"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Audio Review URL</label>
                  <input
                    type="url"
                    className="compact-input"
                    value={songForm.audio_review_url}
                    onChange={(e) => handleInputChange('audio_review_url', e.target.value)}
                    placeholder="Link to audio review"
                  />
                </div>
              </div>

              <div className="compact-form-group full-width">
                <label className="compact-checkbox-label">
                  <input
                    type="checkbox"
                    checked={songForm.explicit}
                    onChange={(e) => handleInputChange('explicit', e.target.checked)}
                  />
                  <span>Explicit Content</span>
                </label>
              </div>
            </div>

            {/* Vegan Categorization Section */}
            <div className="form-section">
              <h4 className="section-title">Vegan Categorization</h4>
              <div className="compact-form-grid">
                <CompactSelect 
                  field="vegan_focus" 
                  title="Vegan Focus"
                  options={categorOptions.vegan_focus}
                />
                
                <CompactSelect 
                  field="animal_category" 
                  title="Animal Category"
                  options={categorOptions.animal_category}
                />
                
                <CompactSelect 
                  field="advocacy_style" 
                  title="Advocacy Style"
                  options={categorOptions.advocacy_style}
                />

                <CompactSelect 
                  field="advocacy_issues" 
                  title="Advocacy Issues"
                  options={categorOptions.advocacy_issues}
                />

                <CompactSelect 
                  field="lyrical_explicitness" 
                  title="Lyrical Approach"
                  options={categorOptions.lyrical_explicitness}
                />

                <div className="compact-form-group">
                  <label className="compact-label">Rating</label>
                  <select
                    className="compact-select"
                    value={songForm.rating}
                    onChange={(e) => handleInputChange('rating', e.target.value)}
                  >
                    <option value="">No rating</option>
                    <option value="1">1 - Poor</option>
                    <option value="2">2 - Fair</option>
                    <option value="3">3 - Good</option>
                    <option value="4">4 - Very Good</option>
                    <option value="5">5 - Excellent</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Audio Features Section */}
            <div className="form-section">
              <h4 className="section-title">Audio Features (0.0 - 1.0)</h4>
              <div className="compact-form-grid">
                <div className="compact-form-group">
                  <label className="compact-label">Energy</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.energy}
                    onChange={(e) => handleInputChange('energy', e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.0 - 1.0"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Danceability</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.danceability}
                    onChange={(e) => handleInputChange('danceability', e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.0 - 1.0"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Valence (Positivity)</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.valence}
                    onChange={(e) => handleInputChange('valence', e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.0 - 1.0"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Acousticness</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.acousticness}
                    onChange={(e) => handleInputChange('acousticness', e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.0 - 1.0"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Instrumentalness</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.instrumentalness}
                    onChange={(e) => handleInputChange('instrumentalness', e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.0 - 1.0"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Liveness</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.liveness}
                    onChange={(e) => handleInputChange('liveness', e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.0 - 1.0"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Speechiness</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.speechiness}
                    onChange={(e) => handleInputChange('speechiness', e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.0 - 1.0"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Tempo (BPM)</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.tempo}
                    onChange={(e) => handleInputChange('tempo', e.target.value)}
                    min="0"
                    max="300"
                    step="0.1"
                    placeholder="Beats per minute"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Loudness (dB)</label>
                  <input
                    type="number"
                    className="compact-input"
                    value={songForm.loudness}
                    onChange={(e) => handleInputChange('loudness', e.target.value)}
                    min="-60"
                    max="0"
                    step="0.1"
                    placeholder="-60 to 0 dB"
                  />
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Key (0-11)</label>
                  <select
                    className="compact-select"
                    value={songForm.key}
                    onChange={(e) => handleInputChange('key', e.target.value)}
                  >
                    <option value="">Select key</option>
                    <option value="0">C</option>
                    <option value="1">C♯/D♭</option>
                    <option value="2">D</option>
                    <option value="3">D♯/E♭</option>
                    <option value="4">E</option>
                    <option value="5">F</option>
                    <option value="6">F♯/G♭</option>
                    <option value="7">G</option>
                    <option value="8">G♯/A♭</option>
                    <option value="9">A</option>
                    <option value="10">A♯/B♭</option>
                    <option value="11">B</option>
                  </select>
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Mode</label>
                  <select
                    className="compact-select"
                    value={songForm.mode}
                    onChange={(e) => handleInputChange('mode', e.target.value)}
                  >
                    <option value="">Select mode</option>
                    <option value="0">Minor</option>
                    <option value="1">Major</option>
                  </select>
                </div>

                <div className="compact-form-group">
                  <label className="compact-label">Time Signature</label>
                  <select
                    className="compact-select"
                    value={songForm.time_signature}
                    onChange={(e) => handleInputChange('time_signature', e.target.value)}
                  >
                    <option value="">Select time signature</option>
                    <option value="3">3/4</option>
                    <option value="4">4/4</option>
                    <option value="5">5/4</option>
                    <option value="6">6/8</option>
                    <option value="7">7/4</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Text Content Section */}
            <div className="form-section">
              <h4 className="section-title">Additional Content</h4>
              <div className="compact-form-group full-width">
                <label className="compact-label">Your Review</label>
                <textarea
                  className="compact-textarea"
                  value={songForm.your_review}
                  onChange={(e) => handleInputChange('your_review', e.target.value)}
                  rows="3"
                  placeholder="Your review or analysis of this song..."
                />
              </div>

              <div className="compact-form-group full-width">
                <label className="compact-label">Inclusion Notes</label>
                <textarea
                  className="compact-textarea"
                  value={songForm.inclusion_notes}
                  onChange={(e) => handleInputChange('inclusion_notes', e.target.value)}
                  rows="2"
                  placeholder="Notes about why this song was included..."
                />
              </div>

              <div className="compact-form-group full-width">
                <label className="compact-label">Internal Notes</label>
                <textarea
                  className="compact-textarea"
                  value={songForm.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  rows="2"
                  placeholder="Internal notes (not shown to users)..."
                />
              </div>

              <div className="compact-form-group full-width">
                <label className="compact-label">Lyrics</label>
                <textarea
                  className="compact-textarea"
                  value={songForm.lyrics}
                  onChange={(e) => handleInputChange('lyrics', e.target.value)}
                  rows="6"
                  placeholder="Song lyrics..."
                />
              </div>
            </div>

            <div className="compact-form-actions">
              <button type="button" onClick={handleCancelEdit} className="compact-btn secondary">
                Cancel
              </button>
              <button type="submit" className="compact-btn primary" disabled={loading}>
                {loading ? 'Saving...' : (editingSong ? 'Update Song' : 'Add Song')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Songs Management */}
      {(
        <div className="admin-manage-section">
          <div className="admin-manage-header">
            <h2>Manage All Songs</h2>
            <div className="admin-search-container">
              <input
                type="text"
                placeholder="Search songs or artists..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="admin-search-input"
              />
            </div>
          </div>
          
          {editingCategorization && (
            <div className="admin-categorization-modal">
              <div className="admin-modal-content">
                <div className="compact-form-header">
                  <h3>Edit Song: {editingCategorization.title}</h3>
                  <div className="song-meta">
                    <span className="song-artist">{editingCategorization.artists}</span>
                    <span className={`source-badge ${editingCategorization.source_type.toLowerCase()}`}>
                      {editingCategorization.source_type}
                    </span>
                  </div>
                </div>
                
                <form className="compact-form">
                  {/* Basic Information */}
                  <div className="form-section">
                    <h4 className="section-title">Basic Information</h4>
                    <div className="compact-form-grid">
                      <div className="compact-form-group">
                        <label className="compact-label">Title</label>
                        <input
                          type="text"
                          className="compact-input"
                          value={editingCategorization.title || ''}
                          onChange={(e) => handleCategorizationInputChange('title', e.target.value)}
                          placeholder="Song title"
                        />
                      </div>
                      
                      <div className="compact-form-group">
                        <label className="compact-label">Album</label>
                        <input
                          type="text"
                          className="compact-input"
                          value={editingCategorization.album_name || ''}
                          onChange={(e) => handleCategorizationInputChange('album_name', e.target.value)}
                          placeholder="Album name"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Duration (ms)</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.duration_ms || ''}
                          onChange={(e) => handleCategorizationInputChange('duration_ms', e.target.value)}
                          placeholder="Duration in milliseconds"
                        />
                        {editingCategorization.duration_ms && (
                          <span className="duration-display">({formatDuration(editingCategorization.duration_ms)})</span>
                        )}
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Popularity</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.popularity || ''}
                          onChange={(e) => handleCategorizationInputChange('popularity', e.target.value)}
                          min="0"
                          max="100"
                          placeholder="0-100"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Track #</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.track_number || ''}
                          onChange={(e) => handleCategorizationInputChange('track_number', e.target.value)}
                          min="1"
                          placeholder="Track #"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Disc #</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.disc_number || ''}
                          onChange={(e) => handleCategorizationInputChange('disc_number', e.target.value)}
                          min="1"
                          placeholder="Disc #"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Custom Mood</label>
                        <input
                          type="text"
                          className="compact-input"
                          value={editingCategorization.custom_mood || ''}
                          onChange={(e) => handleCategorizationInputChange('custom_mood', e.target.value)}
                          placeholder="Happy, Sad, etc."
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Genre</label>
                        <CompactSelect
                          value={editingCategorization.genre || ''}
                          onChange={(value) => handleCategorizationInputChange('genre', value)}
                          options={categorOptions.subgenres || []}
                          placeholder="Select specific genre"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Parent Genre</label>
                        <CompactSelect
                          value={editingCategorization.parent_genre || ''}
                          onChange={(value) => handleCategorizationInputChange('parent_genre', value)}
                          options={categorOptions.parent_genres || []}
                          placeholder="Select parent genre"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">External URL</label>
                        <input
                          type="url"
                          className="compact-input"
                          value={editingCategorization.external_url || ''}
                          onChange={(e) => handleCategorizationInputChange('external_url', e.target.value)}
                          placeholder="YouTube, etc."
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Audio Review URL</label>
                        <input
                          type="url"
                          className="compact-input"
                          value={editingCategorization.audio_review_url || ''}
                          onChange={(e) => handleCategorizationInputChange('audio_review_url', e.target.value)}
                          placeholder="Review link"
                        />
                      </div>
                    </div>

                    <div className="compact-form-group full-width">
                      <label className="compact-checkbox-label">
                        <input
                          type="checkbox"
                          checked={editingCategorization.explicit || false}
                          onChange={(e) => handleCategorizationInputChange('explicit', e.target.checked)}
                        />
                        <span>Explicit Content</span>
                      </label>
                    </div>

                    {/* Read-only Spotify links */}
                    {(editingCategorization.spotify_url || editingCategorization.preview_url) && (
                      <div className="spotify-links">
                        {editingCategorization.spotify_url && (
                          <a href={editingCategorization.spotify_url} target="_blank" rel="noopener noreferrer" className="spotify-link-btn">
                            Open in Spotify
                          </a>
                        )}
                        {editingCategorization.preview_url && (
                          <a href={editingCategorization.preview_url} target="_blank" rel="noopener noreferrer" className="preview-link-btn">
                            Play Preview
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Vegan Categorization */}
                  <div className="form-section">
                    <h4 className="section-title">Vegan Categorization</h4>
                    <div className="compact-form-grid">
                      <CompactSelect 
                        field="vegan_focus" 
                        title="Vegan Focus"
                        options={categorOptions.vegan_focus}
                        value={editingCategorization.vegan_focus}
                        onChange={handleCategorizationArrayChange}
                      />
                      
                      <CompactSelect 
                        field="animal_category" 
                        title="Animal Category"
                        options={categorOptions.animal_category}
                        value={editingCategorization.animal_category}
                        onChange={handleCategorizationArrayChange}
                      />
                      
                      <CompactSelect 
                        field="advocacy_style" 
                        title="Advocacy Style"
                        options={categorOptions.advocacy_style}
                        value={editingCategorization.advocacy_style}
                        onChange={handleCategorizationArrayChange}
                      />

                      <CompactSelect 
                        field="advocacy_issues" 
                        title="Advocacy Issues"
                        options={categorOptions.advocacy_issues}
                        value={editingCategorization.advocacy_issues}
                        onChange={handleCategorizationArrayChange}
                      />

                      <CompactSelect 
                        field="lyrical_explicitness" 
                        title="Lyrical Approach"
                        options={categorOptions.lyrical_explicitness}
                        value={editingCategorization.lyrical_explicitness}
                        onChange={handleCategorizationArrayChange}
                      />

                      <div className="compact-form-group">
                        <label className="compact-label">Rating</label>
                        <select
                          className="compact-select"
                          value={editingCategorization.rating || ''}
                          onChange={(e) => handleCategorizationInputChange('rating', e.target.value)}
                        >
                          <option value="">No rating</option>
                          <option value="1">1 - Poor</option>
                          <option value="2">2 - Fair</option>
                          <option value="3">3 - Good</option>
                          <option value="4">4 - Very Good</option>
                          <option value="5">5 - Excellent</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Audio Features */}
                  <div className="form-section">
                    <h4 className="section-title">Audio Features (0.0-1.0)</h4>
                    <div className="compact-form-grid">
                      <div className="compact-form-group">
                        <label className="compact-label">Energy</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.energy || ''}
                          onChange={(e) => handleCategorizationInputChange('energy', e.target.value)}
                          min="0" max="1" step="0.01" placeholder="0.0-1.0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Danceability</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.danceability || ''}
                          onChange={(e) => handleCategorizationInputChange('danceability', e.target.value)}
                          min="0" max="1" step="0.01" placeholder="0.0-1.0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Valence</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.valence || ''}
                          onChange={(e) => handleCategorizationInputChange('valence', e.target.value)}
                          min="0" max="1" step="0.01" placeholder="0.0-1.0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Acousticness</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.acousticness || ''}
                          onChange={(e) => handleCategorizationInputChange('acousticness', e.target.value)}
                          min="0" max="1" step="0.01" placeholder="0.0-1.0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Instrumentalness</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.instrumentalness || ''}
                          onChange={(e) => handleCategorizationInputChange('instrumentalness', e.target.value)}
                          min="0" max="1" step="0.01" placeholder="0.0-1.0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Liveness</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.liveness || ''}
                          onChange={(e) => handleCategorizationInputChange('liveness', e.target.value)}
                          min="0" max="1" step="0.01" placeholder="0.0-1.0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Speechiness</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.speechiness || ''}
                          onChange={(e) => handleCategorizationInputChange('speechiness', e.target.value)}
                          min="0" max="1" step="0.01" placeholder="0.0-1.0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Tempo (BPM)</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.tempo || ''}
                          onChange={(e) => handleCategorizationInputChange('tempo', e.target.value)}
                          min="0" max="300" step="0.1" placeholder="BPM"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Loudness (dB)</label>
                        <input
                          type="number"
                          className="compact-input"
                          value={editingCategorization.loudness || ''}
                          onChange={(e) => handleCategorizationInputChange('loudness', e.target.value)}
                          min="-60" max="0" step="0.1" placeholder="-60 to 0"
                        />
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Key</label>
                        <select
                          className="compact-select"
                          value={editingCategorization.key || ''}
                          onChange={(e) => handleCategorizationInputChange('key', e.target.value)}
                        >
                          <option value="">Select key</option>
                          <option value="0">C</option>
                          <option value="1">C♯/D♭</option>
                          <option value="2">D</option>
                          <option value="3">D♯/E♭</option>
                          <option value="4">E</option>
                          <option value="5">F</option>
                          <option value="6">F♯/G♭</option>
                          <option value="7">G</option>
                          <option value="8">G♯/A♭</option>
                          <option value="9">A</option>
                          <option value="10">A♯/B♭</option>
                          <option value="11">B</option>
                        </select>
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Mode</label>
                        <select
                          className="compact-select"
                          value={editingCategorization.mode || ''}
                          onChange={(e) => handleCategorizationInputChange('mode', e.target.value)}
                        >
                          <option value="">Select mode</option>
                          <option value="0">Minor</option>
                          <option value="1">Major</option>
                        </select>
                      </div>

                      <div className="compact-form-group">
                        <label className="compact-label">Time Signature</label>
                        <select
                          className="compact-select"
                          value={editingCategorization.time_signature || ''}
                          onChange={(e) => handleCategorizationInputChange('time_signature', e.target.value)}
                        >
                          <option value="">Select time signature</option>
                          <option value="3">3/4</option>
                          <option value="4">4/4</option>
                          <option value="5">5/4</option>
                          <option value="6">6/8</option>
                          <option value="7">7/4</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Text Content */}
                  <div className="form-section">
                    <h4 className="section-title">Additional Content</h4>
                    
                    <div className="compact-form-group full-width">
                      <label className="compact-label">Your Review</label>
                      <textarea
                        className="compact-textarea"
                        value={editingCategorization.your_review || ''}
                        onChange={(e) => handleCategorizationInputChange('your_review', e.target.value)}
                        rows="3"
                        placeholder="Your review or analysis..."
                      />
                    </div>

                    <div className="compact-form-group full-width">
                      <label className="compact-label">Inclusion Notes</label>
                      <textarea
                        className="compact-textarea"
                        value={editingCategorization.inclusion_notes || ''}
                        onChange={(e) => handleCategorizationInputChange('inclusion_notes', e.target.value)}
                        rows="2"
                        placeholder="Why was this song included..."
                      />
                    </div>

                    <div className="compact-form-group full-width">
                      <label className="compact-label">Internal Notes</label>
                      <textarea
                        className="compact-textarea"
                        value={editingCategorization.notes || ''}
                        onChange={(e) => handleCategorizationInputChange('notes', e.target.value)}
                        rows="2"
                        placeholder="Internal notes..."
                      />
                    </div>

                    <div className="compact-form-group full-width">
                      <label className="compact-label">Lyrics</label>
                      <textarea
                        className="compact-textarea"
                        value={editingCategorization.lyrics || ''}
                        onChange={(e) => handleCategorizationInputChange('lyrics', e.target.value)}
                        rows="4"
                        placeholder="Song lyrics..."
                      />
                    </div>
                  </div>

                  <div className="compact-form-actions">
                    <button 
                      type="button"
                      className="compact-btn secondary" 
                      onClick={handleCancelCategorization}
                    >
                      Cancel
                    </button>
                    <button 
                      type="button"
                      className="compact-btn primary" 
                      onClick={handleSaveCategorization}
                      disabled={loading}
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
          
          {loading ? (
            <div className="admin-loading">Loading songs...</div>
          ) : (
            <div className="admin-songs-list">
              {allSongs.map(song => (
                <div key={song.id} className="admin-song-card">
                  <div className="admin-song-header">
                    <h3>{song.title}</h3>
                    <span className={`source-badge ${song.source_type.toLowerCase()}`}>
                      {song.source_type}
                    </span>
                  </div>
                  <p><strong>Artist(s):</strong> {song.artists}</p>
                  {song.album_name && <p><strong>Album:</strong> {song.album_name}</p>}
                  <p><strong>Added:</strong> {new Date(song.created_at).toLocaleDateString()}</p>
                  
                  {(song.vegan_focus && song.vegan_focus.length > 0) && (
                    <p><strong>Vegan Focus:</strong> {song.vegan_focus.join(', ')}</p>
                  )}
                  {(song.animal_category && song.animal_category.length > 0) && (
                    <p><strong>Animal Category:</strong> {song.animal_category.join(', ')}</p>
                  )}
                  {song.your_review && (
                    <p><strong>Review:</strong> {song.your_review.substring(0, 100)}{song.your_review.length > 100 ? '...' : ''}</p>
                  )}
                  {song.rating && (
                    <p><strong>Rating:</strong> {song.rating}/5</p>
                  )}
                  
                  <div className="admin-song-actions">
                    <button 
                      className="admin-categorize-btn"
                      onClick={() => handleEditCategorization(song)}
                    >
                      Edit Categories
                    </button>
                    {song.source_type === 'Manual' && (
                      <>
                        <button 
                          className="admin-edit-btn"
                          onClick={() => handleEditSong(song)}
                        >
                          Edit Song
                        </button>
                        <button 
                          className="admin-delete-btn"
                          onClick={() => handleDeleteSong(song.manual_song_id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {allSongs.length === 0 && (
                <div className="admin-no-results">
                  {searchTerm ? `No songs found matching "${searchTerm}"` : 'No songs found'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Bulk Edit Modal */}
      <BulkEditModal 
        isOpen={showBulkEdit}
        onClose={() => setShowBulkEdit(false)}
      />
    </div>
  );
}

export default AdminInterface;