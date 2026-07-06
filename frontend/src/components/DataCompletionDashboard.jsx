import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5000/api';

function DataCompletionDashboard() {
  const [completionStats, setCompletionStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [prioritySongs, setPrioritySongs] = useState([]);

  useEffect(() => {
    loadCompletionStats();
  }, []);

  const loadCompletionStats = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch completion statistics from our audit script
      const response = await fetch(`${API_BASE}/admin/completion-stats`, {
        headers: {
          'X-Admin-Password': import.meta.env.VITE_ADMIN_PASSWORD
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load completion stats');
      }

      const data = await response.json();
      setCompletionStats(data);

    } catch (err) {
      console.error('Error loading completion stats:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const getCompletionColor = (percentage) => {
    if (percentage >= 80) return '#1DB954'; // Green
    if (percentage >= 50) return '#FFD93D'; // Yellow  
    if (percentage >= 20) return '#FF6B6B'; // Orange
    return '#dc3545'; // Red
  };

  const CompletionBar = ({ label, completed, total, priority = false }) => {
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const color = getCompletionColor(percentage);

    return (
      <div className={`completion-bar ${priority ? 'priority' : ''}`}>
        <div className="completion-bar-header">
          <span className="completion-label">{label}</span>
          <span className="completion-stats">
            {completed}/{total} ({percentage}%)
          </span>
        </div>
        <div className="completion-bar-track">
          <div 
            className="completion-bar-fill"
            style={{ 
              width: `${percentage}%`, 
              backgroundColor: color 
            }}
          />
        </div>
        {priority && percentage < 100 && (
          <div className="priority-indicator">
            🎯 High Priority
          </div>
        )}
      </div>
    );
  };

  const StatCard = ({ title, value, subtitle, icon, color = 'var(--color-accent-primary)' }) => (
    <div className="stat-card">
      <div className="stat-icon" style={{ color }}>
        {icon}
      </div>
      <div className="stat-content">
        <h3 className="stat-value">{value}</h3>
        <p className="stat-title">{title}</p>
        {subtitle && <p className="stat-subtitle">{subtitle}</p>}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Loading completion dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <div className="error-icon">⚠️</div>
        <h3>Failed to Load Dashboard</h3>
        <p>{error}</p>
        <button onClick={loadCompletionStats} className="retry-button">
          🔄 Retry
        </button>
      </div>
    );
  }

  if (!completionStats) {
    return (
      <div className="dashboard-placeholder">
        <p>No completion data available</p>
      </div>
    );
  }

  const totalSongs = completionStats.total || 691; // Fallback to our known count

  return (
    <div className="data-completion-dashboard">
      <div className="dashboard-header">
        <h2>📊 Database Completion Dashboard</h2>
        <p className="dashboard-subtitle">
          Track your progress filling out the vegan music database
        </p>
        <button onClick={loadCompletionStats} className="refresh-button">
          🔄 Refresh Data
        </button>
      </div>

      {/* Key Stats Overview */}
      <div className="stats-grid">
        <StatCard
          title="Total Songs"
          value={totalSongs.toLocaleString()}
          subtitle="In database"
          icon="🎵"
        />
        <StatCard
          title="YouTube Videos"
          value={`${completionStats.youtube?.percentage || 0}%`}
          subtitle={`${completionStats.youtube?.completed || 0} videos added`}
          icon="🎥"
          color="#ff0000"
        />
        <StatCard
          title="Vegan Categories"
          value={`${completionStats.vegan?.vegan_focus?.percentage || 0}%`}
          subtitle="Ready for your coding"
          icon="🌱"
          color="#4ECDC4"
        />
        <StatCard
          title="Lyrics Completion"
          value={`${completionStats.content?.lyrics_url?.percentage || 0}%`}
          subtitle={`${completionStats.content?.lyrics_url?.completed || 0} songs with lyrics URLs`}
          icon="📝"
          color="#9B59B6"
        />
      </div>

      {/* Priority Areas */}
      <div className="priority-section">
        <h3>🎯 Priority Areas</h3>
        <div className="priority-grid">
          <CompletionBar
            label="Lyrics URLs (Critical Priority)"
            completed={completionStats.content?.lyrics_url?.completed || 0}
            total={totalSongs}
            priority={true}
          />
          <CompletionBar
            label="Lyrics Highlights (Critical Priority)"
            completed={completionStats.content?.lyrics_highlights?.completed || 0}
            total={totalSongs}
            priority={true}
          />
          <CompletionBar
            label="YouTube Videos (Most Urgent)"
            completed={completionStats.youtube?.completed || 0}
            total={totalSongs}
            priority={true}
          />
          <CompletionBar
            label="Vegan Focus Categories"
            completed={completionStats.vegan?.vegan_focus?.completed || 0}
            total={totalSongs}
            priority={true}
          />
          <CompletionBar
            label="Animal Categories"
            completed={completionStats.vegan?.animal_category?.completed || 0}
            total={totalSongs}
            priority={true}
          />
        </div>
      </div>

      {/* Basic Metadata Completion */}
      <div className="completion-section">
        <h3>📋 Basic Metadata</h3>
        <div className="completion-grid">
          <CompletionBar 
            label="Song Titles" 
            completed={completionStats.metadata?.title?.completed || totalSongs} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Duration" 
            completed={completionStats.metadata?.duration_ms?.completed || totalSongs} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Popularity Score" 
            completed={completionStats.metadata?.popularity?.completed || 486} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Genre" 
            completed={completionStats.metadata?.genre?.completed || 528} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Track Numbers" 
            completed={completionStats.metadata?.track_number?.completed || 23} 
            total={totalSongs} 
          />
        </div>
      </div>

      {/* Audio Features */}
      <div className="completion-section">
        <h3>🎵 Audio Features</h3>
        <div className="completion-grid">
          <CompletionBar 
            label="Energy" 
            completed={completionStats.audio?.energy?.completed || totalSongs} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Danceability" 
            completed={completionStats.audio?.danceability?.completed || totalSongs} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Valence" 
            completed={completionStats.audio?.valence?.completed || totalSongs} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Acousticness" 
            completed={completionStats.audio?.acousticness?.completed || 0} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Speechiness" 
            completed={completionStats.audio?.speechiness?.completed || 0} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Tempo" 
            completed={completionStats.audio?.tempo?.completed || 0} 
            total={totalSongs} 
          />
        </div>
      </div>

      {/* Lyrics Analysis (Priority Section) */}
      <div className="completion-section lyrics-priority">
        <h3>📝 Lyrics Completion Status (HIGH PRIORITY)</h3>
        <div className="completion-grid">
          <CompletionBar 
            label="Lyrics URLs" 
            completed={completionStats.content?.lyrics_url?.completed || 0} 
            total={totalSongs} 
            priority={true}
          />
          <CompletionBar 
            label="Lyrics Highlights" 
            completed={completionStats.content?.lyrics_highlights?.completed || 0} 
            total={totalSongs} 
            priority={true}
          />
          <CompletionBar 
            label="Full Lyrics Text" 
            completed={completionStats.content?.lyrics?.completed || 0} 
            total={totalSongs} 
          />
        </div>
        <div className="lyrics-summary">
          <div className="lyrics-stat-card">
            <h4>📊 Lyrics Progress Summary</h4>
            <p><strong>URLs:</strong> {completionStats.content?.lyrics_url?.completed || 0} of {totalSongs} songs ({completionStats.content?.lyrics_url?.percentage || 0}%)</p>
            <p><strong>Highlights:</strong> {completionStats.content?.lyrics_highlights?.completed || 0} of {totalSongs} songs ({completionStats.content?.lyrics_highlights?.percentage || 0}%)</p>
            <p><strong>Missing:</strong> {totalSongs - (completionStats.content?.lyrics_url?.completed || 0)} songs still need lyrics URLs</p>
            <div className="lyrics-priority-note">
              🎯 <strong>Priority Action:</strong> Focus on adding lyrics URLs and highlights - this is critical for vegan music analysis
            </div>
          </div>
        </div>
      </div>

      {/* Content & Reviews */}
      <div className="completion-section">
        <h3>📋 Content & Reviews</h3>
        <div className="completion-grid">
          <CompletionBar 
            label="Your Reviews" 
            completed={completionStats.content?.your_review?.completed || 0} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Ratings" 
            completed={completionStats.content?.rating?.completed || 0} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Internal Notes" 
            completed={completionStats.content?.notes?.completed || 0} 
            total={totalSongs} 
          />
          <CompletionBar 
            label="Inclusion Notes" 
            completed={completionStats.content?.inclusion_notes?.completed || 0} 
            total={totalSongs} 
          />
        </div>
      </div>

      {/* Action Recommendations */}
      <div className="recommendations-section">
        <h3>💡 Recommended Next Steps</h3>
        <div className="recommendations-list">
          <div className="recommendation-item urgent">
            <div className="rec-icon">📝</div>
            <div className="rec-content">
              <h4>Add Lyrics URLs (HIGHEST PRIORITY)</h4>
              <p>{totalSongs - (completionStats.content?.lyrics_url?.completed || 0)} songs need lyrics URLs. This is critical for vegan music analysis and content understanding.</p>
              <span className="rec-progress">Progress: {completionStats.content?.lyrics_url?.percentage || 0}%</span>
            </div>
          </div>
          
          <div className="recommendation-item urgent">
            <div className="rec-icon">🎯</div>
            <div className="rec-content">
              <h4>Create Lyrics Highlights (HIGHEST PRIORITY)</h4>
              <p>{totalSongs - (completionStats.content?.lyrics_highlights?.completed || 0)} songs need vegan-themed lyrics highlights. Essential for categorization.</p>
              <span className="rec-progress">Progress: {completionStats.content?.lyrics_highlights?.percentage || 0}%</span>
            </div>
          </div>
          
          <div className="recommendation-item urgent">
            <div className="rec-icon">🎥</div>
            <div className="rec-content">
              <h4>Continue Adding YouTube Videos</h4>
              <p>{completionStats.youtube?.missing || 682} songs still need videos. Use the YouTube Video Manager to batch process them.</p>
              <span className="rec-progress">Progress: {completionStats.youtube?.percentage || 1}%</span>
            </div>
          </div>
          
          <div className="recommendation-item important">
            <div className="rec-icon">🌱</div>
            <div className="rec-content">
              <h4>Prepare for Vegan Categorization</h4>
              <p>All {totalSongs} songs need vegan focus coding. Set up your thematic framework first.</p>
              <span className="rec-progress">Progress: {completionStats.vegan?.vegan_focus?.percentage || 0}%</span>
            </div>
          </div>

          <div className="recommendation-item moderate">
            <div className="rec-icon">🎼</div>
            <div className="rec-content">
              <h4>Fill Missing Genre Data</h4>
              <p>{totalSongs - (completionStats.metadata?.genre?.completed || 528)} songs missing genre information. Consider bulk editing similar tracks.</p>
              <span className="rec-progress">Progress: {completionStats.metadata?.genre?.percentage || 76}%</span>
            </div>
          </div>

          <div className="recommendation-item moderate">
            <div className="rec-icon">⭐</div>
            <div className="rec-content">
              <h4>Add Track Numbers</h4>
              <p>{totalSongs - (completionStats.metadata?.track_number?.completed || 23)} songs missing track numbers. Low priority but helps with organization.</p>
              <span className="rec-progress">Progress: {completionStats.metadata?.track_number?.percentage || 3}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <h3>🚀 Quick Actions</h3>
        <div className="action-buttons">
          <button 
            className="action-btn primary"
            onClick={() => window.location.hash = '#admin/lyrics-manager'}
          >
            📝 Add Lyrics (PRIORITY)
          </button>
          <button 
            className="action-btn primary"
            onClick={() => window.location.hash = '#admin/youtube-videos'}
          >
            🎥 Add YouTube Videos
          </button>
          <button 
            className="action-btn secondary"
            onClick={() => window.location.hash = '#admin/manage-songs'}
          >
            📝 Edit Song Categories
          </button>
          <button 
            className="action-btn secondary"
            onClick={() => window.location.hash = '#admin/manage-songs'}
          >
            📊 Bulk Edit Songs
          </button>
        </div>
      </div>
      
      <style jsx>{`
        .lyrics-priority {
          background: linear-gradient(135deg, #2c2c2c 0%, #1a1a1a 100%);
          border: 2px solid #9B59B6;
          border-radius: 12px;
          padding: 24px;
          margin: 20px 0;
        }
        
        .lyrics-priority h3 {
          color: #E8B5FF;
          font-weight: bold;
          text-align: center;
          margin-bottom: 20px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        
        .lyrics-summary {
          margin-top: 20px;
        }
        
        .lyrics-stat-card {
          background: linear-gradient(135deg, #333333 0%, #2a2a2a 100%);
          padding: 20px;
          border-radius: 8px;
          border-left: 4px solid #9B59B6;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .lyrics-stat-card h4 {
          color: #E8B5FF;
          margin-bottom: 12px;
          font-weight: 600;
        }
        
        .lyrics-stat-card p {
          margin: 8px 0;
          color: #E0E0E0;
          font-weight: 500;
        }
        
        .lyrics-priority-note {
          background: #9B59B6;
          color: white;
          padding: 12px;
          border-radius: 6px;
          margin-top: 12px;
          font-weight: 500;
        }
        
        .completion-bar.priority {
          border: 2px solid #9B59B6;
          background: linear-gradient(135deg, #333333 0%, #2a2a2a 100%);
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 12px;
        }
        
        .completion-bar.priority .completion-label {
          color: #FFFFFF;
          font-weight: 600;
          font-size: 14px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        
        .completion-bar.priority .completion-stats {
          color: #E8B5FF;
          font-weight: 500;
        }
        
        .priority-grid .completion-bar.priority {
          box-shadow: 0 2px 8px rgba(155, 89, 182, 0.2);
        }
        
        .priority-section h3 {
          color: #FFFFFF;
          font-weight: 700;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        
        .completion-section.lyrics-priority .completion-grid .completion-bar {
          background: linear-gradient(135deg, #333333 0%, #2a2a2a 100%);
          border: 1px solid #9B59B6;
          padding: 12px;
          margin-bottom: 8px;
          border-radius: 6px;
        }
        
        .completion-section.lyrics-priority .completion-label {
          color: #FFFFFF;
          font-weight: 600;
          text-shadow: 0 1px 1px rgba(0,0,0,0.3);
        }
        
        .completion-section.lyrics-priority .completion-stats {
          color: #E8B5FF;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}

export default DataCompletionDashboard;