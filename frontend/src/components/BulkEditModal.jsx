import { useState } from 'react';

function BulkEditModal({ isOpen, onClose }) {
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleDownloadCSV = async () => {
    setDownloading(true);
    setError('');
    setMessage('');
    
    try {
      const response = await fetch('/api/admin/all-songs?limit=1000', {
        headers: {
          'X-Admin-Password': 'admin123'
        }
      }); // Get all songs
      const data = await response.json();
      
      if (!data.songs) {
        throw new Error('No songs data received');
      }

      const headers = [
        // Basic Info
        'ID', 'Title', 'Artists', 'Album', 'Source Type',
        // Spotify Data
        'Spotify ID', 'Spotify URL', 'Preview URL', 'Duration (ms)', 'Popularity', 'Explicit', 'Track Number', 'Disc Number',
        // Genre & Classification
        'Genre', 'Parent Genre', 'Custom Mood', 'Featured',
        // Vegan Categorization
        'Vegan Focus', 'Animal Category', 'Advocacy Style', 'Advocacy Issues', 'Lyrical Explicitness',
        // Audio Features
        'Energy', 'Danceability', 'Valence', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness', 'Tempo', 'Loudness', 'Key', 'Mode', 'Time Signature',
        // Lyrics Data
        'Lyrics URL', 'Lyrics Source', 'Lyrics Highlights', 'Manual Lyrics', 'Notes',
        // YouTube Data
        'YouTube ID', 'YouTube URL', 'YouTube Thumbnail', 'YouTube Video Type', 'YouTube Title',
        // Review & Rating
        'Your Review', 'Audio Review URL', 'Inclusion Notes', 'Rating',
        // Manual Song Data
        'External URL', 'Audio File Path',
        // Timestamps
        'Date Added', 'Created At', 'Updated At'
      ];

      const csvData = data.songs.map(song => [
        // Basic Info
        song.id,
        `"${song.title || ''}"`,
        `"${song.artists || ''}"`,  
        `"${song.album_name || ''}"`,
        `"${song.source_type || ''}"`,
        // Spotify Data
        `"${song.spotify_id || ''}"`,
        `"${song.spotify_url || ''}"`,
        `"${song.preview_url || ''}"`,
        song.duration_ms || '',
        song.popularity || '',
        song.explicit || '',
        song.track_number || '',
        song.disc_number || '',
        // Genre & Classification
        `"${song.genre || ''}"`,
        `"${song.parent_genre || ''}"`,
        `"${song.custom_mood || ''}"`,
        song.featured || false,
        // Vegan Categorization
        `"${(song.vegan_focus || []).join(', ')}"`,
        `"${(song.animal_category || []).join(', ')}"`,
        `"${(song.advocacy_style || []).join(', ')}"`,
        `"${(song.advocacy_issues || []).join(', ')}"`,
        `"${(song.lyrical_explicitness || []).join(', ')}"`,
        // Audio Features
        song.energy || '',
        song.danceability || '',
        song.valence || '',
        song.acousticness || '',
        song.instrumentalness || '',
        song.liveness || '',
        song.speechiness || '',
        song.tempo || '',
        song.loudness || '',
        song.key || '',
        song.mode || '',
        song.time_signature || '',
        // Lyrics Data
        `"${song.lyrics_url || ''}"`,
        `"${song.lyrics_source || ''}"`,
        `"${song.lyrics_highlights || ''}"`,
        `"${song.lyrics || ''}"`,
        `"${song.notes || ''}"`,
        // YouTube Data
        `"${song.youtube_id || ''}"`,
        `"${song.youtube_id ? `https://www.youtube.com/watch?v=${song.youtube_id}` : ''}"`,
        `"${song.youtube_thumbnail || ''}"`,
        `"${song.youtube_video_type || ''}"`,
        `"${song.youtube_title || ''}"`,
        // Review & Rating
        `"${song.your_review || ''}"`,
        `"${song.audio_review_url || ''}"`,
        `"${song.inclusion_notes || ''}"`,
        song.rating || '',
        // Manual Song Data
        `"${song.external_url || ''}"`,
        `"${song.audio_file_path || ''}"`,
        // Timestamps
        `"${song.date_added || ''}"`,
        `"${song.created_at || ''}"`,
        `"${song.updated_at || ''}"`,
      ]);

      const csvContent = [headers.join(','), ...csvData.map(row => row.join(','))].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vegan_playlist_bulk_edit_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      setMessage(`Successfully downloaded ${data.songs.length} songs to CSV`);
    } catch (err) {
      setError('Failed to download CSV: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleUploadCSV = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    setError('');
    setMessage('');

    try {
      const formData = new FormData();
      formData.append('csv', file);

      const response = await fetch('/api/admin/bulk-upload', {
        method: 'POST',
        headers: {
          'X-Admin-Password': 'admin123'
        },
        body: formData
      });

      const result = await response.json();

      if (response.ok) {
        setMessage(`Successfully processed ${result.updated || 0} songs, ${result.errors || 0} errors`);
        if (result.errorDetails && result.errorDetails.length > 0) {
          setError(`Some errors occurred: ${result.errorDetails.slice(0, 3).join(', ')}`);
        }
      } else {
        setError(result.error || 'Upload failed');
      }
    } catch (err) {
      setError('Failed to upload CSV: ' + err.message);
    } finally {
      setUploading(false);
      // Clear the file input
      event.target.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content bulk-edit-modal">
        <div className="modal-header">
          <h2>Bulk Edit Songs</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="bulk-edit-content" style={{ padding: '0 24px 24px 24px' }}>
          <div className="bulk-edit-section">
            <h3>📥 Download Songs</h3>
            <p>Download all songs as a CSV file to edit offline</p>
            <button 
              onClick={handleDownloadCSV}
              className="download-btn"
              disabled={downloading}
            >
              {downloading ? '📥 Downloading...' : '📥 Download CSV'}
            </button>
          </div>

          <div className="bulk-edit-divider">
            <span>Then edit the CSV file and upload it back</span>
          </div>

          <div className="bulk-edit-section">
            <h3>📤 Upload Updated Songs</h3>
            <p>Upload your edited CSV file to update songs in bulk</p>
            <label className="upload-btn">
              {uploading ? '📤 Uploading...' : '📤 Upload CSV'}
              <input
                type="file"
                accept=".csv"
                onChange={handleUploadCSV}
                style={{ display: 'none' }}
                disabled={uploading}
              />
            </label>
          </div>

          {message && <div className="success-message">{message}</div>}
          {error && <div className="error-message">{error}</div>}

          <div className="bulk-edit-instructions">
            <h4>Instructions:</h4>
            <ol>
              <li><strong>Download</strong> the CSV file with all current song data</li>
              <li><strong>Edit</strong> the CSV in Excel, Google Sheets, or any spreadsheet app</li>
              <li><strong>Save</strong> the file as CSV format</li>
              <li><strong>Upload</strong> the edited CSV to update songs in bulk</li>
            </ol>
            <p><strong>Editable fields:</strong> Vegan Focus, Animal Category, Advocacy Style, Advocacy Issues, Lyrical Explicitness</p>
            <p><strong>Format:</strong> Use commas to separate multiple values (e.g., "explicit, direct")</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BulkEditModal;