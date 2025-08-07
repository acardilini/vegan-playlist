import { useState, useEffect } from 'react';

function SubmissionsManager() {
  const [submissions, setSubmissions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Load submissions
  const loadSubmissions = async (status = 'all') => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:5000/api/submissions/admin?status=${status}&limit=50`);
      const data = await response.json();
      
      setSubmissions(data.submissions || []);
      setStats(data.stats);
    } catch (error) {
      console.error('Error loading submissions:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load submissions on component mount and when filter changes
  useEffect(() => {
    loadSubmissions(filter);
  }, [filter]);

  // Update submission status
  const updateSubmissionStatus = async (submissionId, newStatus, adminNotes = '') => {
    try {
      const response = await fetch(`http://localhost:5000/api/submissions/admin/${submissionId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: newStatus,
          admin_notes: adminNotes,
          resolved_by: 'Admin' // In a real app, this would be the logged-in admin's name
        }),
      });

      if (response.ok) {
        // Reload submissions to reflect changes
        loadSubmissions(filter);
        if (selectedSubmission?.id === submissionId) {
          setSelectedSubmission(null);
          setShowModal(false);
        }
      } else {
        console.error('Failed to update submission status');
      }
    } catch (error) {
      console.error('Error updating submission:', error);
    }
  };

  // Delete submission
  const deleteSubmission = async (submissionId) => {
    if (!confirm('Are you sure you want to delete this submission?')) return;

    try {
      const response = await fetch(`http://localhost:5000/api/submissions/admin/${submissionId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadSubmissions(filter);
        if (selectedSubmission?.id === submissionId) {
          setSelectedSubmission(null);
          setShowModal(false);
        }
      } else {
        console.error('Failed to delete submission');
      }
    } catch (error) {
      console.error('Error deleting submission:', error);
    }
  };

  // Open submission details modal
  const viewSubmissionDetails = async (submission) => {
    try {
      const response = await fetch(`http://localhost:5000/api/submissions/admin/${submission.id}`);
      const detailedSubmission = await response.json();
      
      setSelectedSubmission(detailedSubmission);
      setShowModal(true);
    } catch (error) {
      console.error('Error loading submission details:', error);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { text: 'Pending', className: 'status-pending' },
      approved: { text: 'Approved', className: 'status-approved' },
      rejected: { text: 'Rejected', className: 'status-rejected' },
      resolved: { text: 'Resolved', className: 'status-resolved' }
    };
    
    const badge = badges[status] || badges.pending;
    return <span className={`status-badge ${badge.className}`}>{badge.text}</span>;
  };

  return (
    <div className="submissions-manager">
      {/* Header with Stats */}
      <div className="submissions-header">
        <div className="submissions-title">
          <h2>Song Submissions</h2>
          <p>Review and manage user-submitted song suggestions</p>
        </div>
        
        {stats && (
          <div className="submissions-stats">
            <div className="stat-item">
              <span className="stat-number">{stats.total_submissions}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat-item">
              <span className="stat-number">{stats.pending_count}</span>
              <span className="stat-label">Pending</span>
            </div>
            <div className="stat-item">
              <span className="stat-number">{stats.existing_songs_count}</span>
              <span className="stat-label">Already Exist</span>
            </div>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="submissions-filters">
        {['all', 'pending', 'approved', 'rejected', 'resolved'].map(status => (
          <button
            key={status}
            className={`filter-tab ${filter === status ? 'active' : ''}`}
            onClick={() => setFilter(status)}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            {stats && status !== 'all' && (
              <span className="tab-count">
                ({status === 'pending' ? stats.pending_count :
                  status === 'approved' ? stats.approved_count :
                  status === 'rejected' ? stats.rejected_count :
                  status === 'resolved' ? stats.resolved_count : 0})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Submissions List */}
      <div className="submissions-list">
        {loading ? (
          <div className="loading-message">Loading submissions...</div>
        ) : submissions.length === 0 ? (
          <div className="no-submissions">
            <p>No {filter === 'all' ? '' : filter} submissions found.</p>
          </div>
        ) : (
          submissions.map(submission => (
            <div key={submission.id} className="submission-card">
              <div className="submission-main">
                <div className="submission-song-info">
                  <h3>"{submission.song_title}" by {submission.artist_name}</h3>
                  {submission.album_name && (
                    <p className="album-info">Album: {submission.album_name}</p>
                  )}
                  {submission.submission_reason && (
                    <p className="submission-reason">
                      <strong>Reason:</strong> {submission.submission_reason.slice(0, 100)}
                      {submission.submission_reason.length > 100 && '...'}
                    </p>
                  )}
                </div>
                
                <div className="submission-meta">
                  {getStatusBadge(submission.status)}
                  {submission.existing_song_id && (
                    <span className="existing-badge">Already in playlist</span>
                  )}
                  <span className="submission-date">{formatDate(submission.created_at)}</span>
                </div>
              </div>

              <div className="submission-actions">
                <button
                  className="btn-secondary"
                  onClick={() => viewSubmissionDetails(submission)}
                >
                  View Details
                </button>
                
                {submission.status === 'pending' && (
                  <>
                    <button
                      className="btn-success"
                      onClick={() => updateSubmissionStatus(submission.id, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => updateSubmissionStatus(submission.id, 'rejected')}
                    >
                      Reject
                    </button>
                    {submission.existing_song_id && (
                      <button
                        className="btn-primary"
                        onClick={() => updateSubmissionStatus(submission.id, 'resolved', 'Song already exists in playlist')}
                      >
                        Mark as Resolved
                      </button>
                    )}
                  </>
                )}
                
                {(submission.status === 'approved' || submission.status === 'rejected') && (
                  <button
                    className="btn-primary"
                    onClick={() => updateSubmissionStatus(submission.id, 'resolved')}
                  >
                    Mark as Resolved
                  </button>
                )}
                
                <button
                  className="btn-danger-outline"
                  onClick={() => deleteSubmission(submission.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Submission Details Modal */}
      {showModal && selectedSubmission && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content submission-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Submission Details</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="submission-detail-section">
                <h3>Song Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <strong>Title:</strong> {selectedSubmission.song_title}
                  </div>
                  <div className="detail-item">
                    <strong>Artist:</strong> {selectedSubmission.artist_name}
                  </div>
                  {selectedSubmission.album_name && (
                    <div className="detail-item">
                      <strong>Album:</strong> {selectedSubmission.album_name}
                    </div>
                  )}
                  {selectedSubmission.release_year && (
                    <div className="detail-item">
                      <strong>Year:</strong> {selectedSubmission.release_year}
                    </div>
                  )}
                </div>
              </div>

              {(selectedSubmission.submission_reason || selectedSubmission.lyrics_excerpt || selectedSubmission.youtube_url) && (
                <div className="submission-detail-section">
                  <h3>Additional Information</h3>
                  {selectedSubmission.submission_reason && (
                    <div className="detail-item">
                      <strong>Why it should be included:</strong>
                      <p>{selectedSubmission.submission_reason}</p>
                    </div>
                  )}
                  {selectedSubmission.lyrics_excerpt && (
                    <div className="detail-item">
                      <strong>Key Lyrics:</strong>
                      <p className="lyrics-excerpt">{selectedSubmission.lyrics_excerpt}</p>
                    </div>
                  )}
                  {selectedSubmission.youtube_url && (
                    <div className="detail-item">
                      <strong>YouTube Link:</strong>
                      <a href={selectedSubmission.youtube_url} target="_blank" rel="noopener noreferrer">
                        {selectedSubmission.youtube_url}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {(selectedSubmission.submitter_name || selectedSubmission.submitter_email) && (
                <div className="submission-detail-section">
                  <h3>Submitter Information</h3>
                  {selectedSubmission.submitter_name && (
                    <div className="detail-item">
                      <strong>Name:</strong> {selectedSubmission.submitter_name}
                    </div>
                  )}
                  {selectedSubmission.submitter_email && (
                    <div className="detail-item">
                      <strong>Email:</strong> {selectedSubmission.submitter_email}
                    </div>
                  )}
                </div>
              )}

              {selectedSubmission.existing_song_id && (
                <div className="submission-detail-section existing-song-notice">
                  <h3>⚠️ Song Already Exists</h3>
                  <p>This song is already in our playlist:</p>
                  <p><strong>"{selectedSubmission.existing_song_title}"</strong></p>
                  {selectedSubmission.existing_song_spotify_url && (
                    <a href={selectedSubmission.existing_song_spotify_url} target="_blank" rel="noopener noreferrer">
                      View on Spotify
                    </a>
                  )}
                </div>
              )}

              <div className="submission-detail-section">
                <h3>Status Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <strong>Status:</strong> {getStatusBadge(selectedSubmission.status)}
                  </div>
                  <div className="detail-item">
                    <strong>Submitted:</strong> {formatDate(selectedSubmission.created_at)}
                  </div>
                  {selectedSubmission.updated_at !== selectedSubmission.created_at && (
                    <div className="detail-item">
                      <strong>Updated:</strong> {formatDate(selectedSubmission.updated_at)}
                    </div>
                  )}
                  {selectedSubmission.resolved_at && (
                    <div className="detail-item">
                      <strong>Resolved:</strong> {formatDate(selectedSubmission.resolved_at)}
                    </div>
                  )}
                  {selectedSubmission.resolved_by && (
                    <div className="detail-item">
                      <strong>Resolved by:</strong> {selectedSubmission.resolved_by}
                    </div>
                  )}
                </div>
                {selectedSubmission.admin_notes && (
                  <div className="detail-item">
                    <strong>Admin Notes:</strong>
                    <p>{selectedSubmission.admin_notes}</p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="modal-footer">
              {selectedSubmission.status === 'pending' && (
                <>
                  <button
                    className="btn-success"
                    onClick={() => updateSubmissionStatus(selectedSubmission.id, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-danger"
                    onClick={() => updateSubmissionStatus(selectedSubmission.id, 'rejected')}
                  >
                    Reject
                  </button>
                  {selectedSubmission.existing_song_id && (
                    <button
                      className="btn-primary"
                      onClick={() => updateSubmissionStatus(selectedSubmission.id, 'resolved', 'Song already exists in playlist')}
                    >
                      Mark as Resolved
                    </button>
                  )}
                </>
              )}
              
              {(selectedSubmission.status === 'approved' || selectedSubmission.status === 'rejected') && (
                <button
                  className="btn-primary"
                  onClick={() => updateSubmissionStatus(selectedSubmission.id, 'resolved')}
                >
                  Mark as Resolved
                </button>
              )}
              
              <button className="btn-secondary" onClick={() => setShowModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SubmissionsManager;