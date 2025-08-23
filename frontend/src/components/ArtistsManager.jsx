import { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5000/api/admin';
const ADMIN_PASSWORD = 'admin123';

function ArtistsManager() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [reviewedFilter, setReviewedFilter] = useState('');
  const [editingArtist, setEditingArtist] = useState(null);
  const [stats, setStats] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0
  });

  // Initial setup - ensure database columns exist
  useEffect(() => {
    setupDatabase();
    fetchStats();
  }, []);

  // Fetch artists when filters, sorting, or pagination change
  useEffect(() => {
    fetchArtists();
  }, [searchTerm, reviewedFilter, sortBy, sortOrder, pagination.page]);

  const setupDatabase = async () => {
    try {
      const response = await fetch(`${API_BASE}/setup-discography-tracking`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });
      
      if (!response.ok) {
        console.warn('Database setup may have failed, continuing anyway...');
      }
    } catch (error) {
      console.warn('Database setup error:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/artists-stats`, {
        headers: { 
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching artist stats:', error);
    }
  };

  const fetchArtists = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page,
        limit: pagination.limit,
        search: searchTerm,
        sortBy: sortBy,
        sortOrder: sortOrder,
        ...(reviewedFilter && { reviewed: reviewedFilter })
      });

      const response = await fetch(`${API_BASE}/all-artists?${params}`, {
        headers: { 
          'X-Admin-Password': ADMIN_PASSWORD
        }
      });
      const data = await response.json();
      
      if (response.ok) {
        setArtists(data.artists);
        setPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          pages: data.pagination.pages
        }));
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (error) {
      setMessage(`Error fetching artists: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateArtist = async (artistId, updates) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/artists/${artistId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'X-Admin-Password': ADMIN_PASSWORD
        },
        body: JSON.stringify(updates)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage(data.message);
        fetchArtists();
        fetchStats();
        setEditingArtist(null);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (error) {
      setMessage(`Error updating artist: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscographyReview = async (artist, isReviewed) => {
    await handleUpdateArtist(artist.id, {
      discography_reviewed: isReviewed
    });
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      // Toggle sort order if same field
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortBy(field);
      setSortOrder('asc');
    }
    // Reset to first page when sorting changes
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getSortIcon = (field) => {
    if (sortBy !== field) return '↕️';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getArtistImage = (artist) => {
    if (artist.images && artist.images.length > 0) {
      const mediumImage = artist.images.find(img => img.width >= 200 && img.width <= 400);
      return mediumImage ? mediumImage.url : artist.images[0].url;
    }
    return "https://via.placeholder.com/64x64/1DB954/000000?text=♪";
  };

  return (
    <div className="artists-manager">
      {/* Header with Statistics */}
      <div className="admin-header">
        <h2>Artists Management</h2>
        {stats && (
          <div className="artists-stats-grid">
            <div className="stat-card">
              <div className="stat-number">{stats.total_artists}</div>
              <div className="stat-label">Total Artists</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{stats.reviewed_artists}</div>
              <div className="stat-label">Discography Reviewed</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{stats.unreviewed_artists}</div>
              <div className="stat-label">Need Review</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{stats.artists_with_notes}</div>
              <div className="stat-label">With Advocacy Notes</div>
            </div>
          </div>
        )}
      </div>

      {/* Filters and Search */}
      <div className="admin-filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search artists by name, bio, or advocacy notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        
        <div className="filter-group">
          <label>Discography Status:</label>
          <select
            value={reviewedFilter}
            onChange={(e) => setReviewedFilter(e.target.value)}
            className="filter-select"
          >
            <option value="">All Artists</option>
            <option value="true">Reviewed</option>
            <option value="false">Not Reviewed</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Sort By:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="filter-select"
          >
            <option value="name">Name</option>
            <option value="song_count">Number of Songs</option>
            <option value="followers">Followers</option>
            <option value="popularity">Popularity</option>
            <option value="discography_reviewed">Review Status</option>
            <option value="updated_at">Last Updated</option>
            <option value="created_at">Date Added</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Order:</label>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="filter-select"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      </div>

      {/* Artists Table */}
      <div className="admin-section">
        {loading && <div className="loading">Loading artists...</div>}
        {message && <div className="message">{message}</div>}
        
        <div className="artists-table-container">
          <table className="artists-table">
            <thead>
              <tr>
                <th 
                  className="sortable-header" 
                  onClick={() => handleSort('name')}
                  title="Click to sort by artist name"
                >
                  Artist {getSortIcon('name')}
                </th>
                <th 
                  className="sortable-header" 
                  onClick={() => handleSort('song_count')}
                  title="Click to sort by number of songs"
                >
                  Songs {getSortIcon('song_count')}
                </th>
                <th 
                  className="sortable-header" 
                  onClick={() => handleSort('followers')}
                  title="Click to sort by followers"
                >
                  Followers {getSortIcon('followers')}
                </th>
                <th 
                  className="sortable-header" 
                  onClick={() => handleSort('discography_reviewed')}
                  title="Click to sort by review status"
                >
                  Discography Reviewed {getSortIcon('discography_reviewed')}
                </th>
                <th>Advocacy Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {artists.map((artist) => (
                <tr key={artist.id} className={artist.discography_reviewed ? 'reviewed' : 'unreviewed'}>
                  <td>
                    <div className="artist-info">
                      <img 
                        src={getArtistImage(artist)} 
                        alt={artist.name}
                        className="artist-thumb"
                      />
                      <div>
                        <div className="artist-name">{artist.name}</div>
                        <div className="artist-meta">
                          {artist.genres && artist.genres.length > 0 && (
                            <span className="genres">{artist.genres.slice(0, 2).join(', ')}</span>
                          )}
                          {artist.popularity > 0 && (
                            <span className="popularity">Pop: {artist.popularity}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  
                  <td>
                    <div className="song-count">
                      <strong>{artist.song_count}</strong> songs
                      {artist.sample_songs && (
                        <div className="sample-songs" title={artist.sample_songs}>
                          {artist.sample_songs.substring(0, 50)}...
                        </div>
                      )}
                    </div>
                  </td>
                  
                  <td>
                    {artist.followers ? artist.followers.toLocaleString() : 'Unknown'}
                  </td>
                  
                  <td>
                    <div className="review-status">
                      <label className="review-checkbox">
                        <input
                          type="checkbox"
                          checked={artist.discography_reviewed || false}
                          onChange={(e) => handleDiscographyReview(artist, e.target.checked)}
                        />
                        <span className="checkmark"></span>
                        {artist.discography_reviewed ? 'Reviewed' : 'Not Reviewed'}
                      </label>
                      {artist.discography_reviewed_date && (
                        <div className="review-date">
                          {formatDate(artist.discography_reviewed_date)}
                        </div>
                      )}
                    </div>
                  </td>
                  
                  <td>
                    <div className="advocacy-notes">
                      {artist.vegan_advocacy_notes ? (
                        <span className="has-notes" title={artist.vegan_advocacy_notes}>
                          ✓ Has Notes
                        </span>
                      ) : (
                        <span className="no-notes">No Notes</span>
                      )}
                    </div>
                  </td>
                  
                  <td>
                    <div className="action-buttons">
                      <button
                        onClick={() => setEditingArtist(artist)}
                        className="btn-edit"
                      >
                        Edit
                      </button>
                      {artist.spotify_url && (
                        <a
                          href={artist.spotify_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-spotify"
                        >
                          Spotify
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="pagination">
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={pagination.page === 1}
            >
              Previous
            </button>
            <span className="pagination-info">
              Page {pagination.page} of {pagination.pages} ({pagination.total} artists)
            </span>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.pages, prev.page + 1) }))}
              disabled={pagination.page === pagination.pages}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Edit Artist Modal */}
      {editingArtist && (
        <ArtistEditModal
          artist={editingArtist}
          onSave={handleUpdateArtist}
          onClose={() => setEditingArtist(null)}
        />
      )}
    </div>
  );
}

// Artist Edit Modal Component
function ArtistEditModal({ artist, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: artist.name || '',
    bio: artist.bio || '',
    vegan_advocacy_notes: artist.vegan_advocacy_notes || '',
    discography_reviewed: artist.discography_reviewed || false,
    discography_review_notes: artist.discography_review_notes || '',
    genres: artist.genres || []
  });

  const handleSave = () => {
    onSave(artist.id, formData);
  };

  const handleGenresChange = (e) => {
    const genresArray = e.target.value.split(',').map(g => g.trim()).filter(g => g);
    setFormData({ ...formData, genres: genresArray });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content artist-edit-modal">
        <div className="modal-header">
          <h3>Edit Artist: {artist.name}</h3>
          <button onClick={onClose} className="modal-close">&times;</button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>Name:</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Biography:</label>
            <textarea
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              rows={3}
              placeholder="Artist biography..."
            />
          </div>

          <div className="form-group">
            <label>Vegan Advocacy Notes:</label>
            <textarea
              value={formData.vegan_advocacy_notes}
              onChange={(e) => setFormData({ ...formData, vegan_advocacy_notes: e.target.value })}
              rows={3}
              placeholder="Notes about artist's vegan advocacy, animal rights involvement, etc."
            />
          </div>

          <div className="form-group">
            <label>Genres (comma-separated):</label>
            <input
              type="text"
              value={formData.genres.join(', ')}
              onChange={handleGenresChange}
              placeholder="rock, alternative, indie"
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={formData.discography_reviewed}
                onChange={(e) => setFormData({ ...formData, discography_reviewed: e.target.checked })}
              />
              <span className="checkmark"></span>
              Discography Reviewed
            </label>
            <small>Check this box if you have reviewed this artist's back catalogue for vegan-themed songs</small>
          </div>

          {formData.discography_reviewed && (
            <div className="form-group">
              <label>Review Notes:</label>
              <textarea
                value={formData.discography_review_notes}
                onChange={(e) => setFormData({ ...formData, discography_review_notes: e.target.value })}
                rows={2}
                placeholder="Notes about what you found during the discography review..."
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-cancel">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-save">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default ArtistsManager;