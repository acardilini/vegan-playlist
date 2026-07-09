import { useState } from 'react';
import YouTubeVideoManager from './YouTubeVideoManager';
import DataCompletionDashboard from './DataCompletionDashboard';
import LyricsLookupManager from './LyricsLookupManager';
import BulkCategorizationWorkflow from './BulkCategorizationWorkflow';
import SubmissionsManager from './SubmissionsManager';
import DuplicateManager from './DuplicateManager';
import ArtistsManager from './ArtistsManager';
import StagingQueue from './StagingQueue';
import ManageSongsTab from './ManageSongsTab';
import ManagePlaylistsTab from './ManagePlaylistsTab';
import { ADMIN_PASSWORD } from '../api/adminApi';

const CONTENT_TABS = [
  ['manage-songs', '🎵 Songs'],
  ['staging', 'Staging'],
  ['manage-playlists', '📋 Playlists'],
  ['manage-artists', '🎤 Artists'],
  ['song-submissions', '📥 Submissions'],
  ['dashboard', '📊 Analytics'],
];

const DATA_TABS = [
  ['youtube-videos', '🎥 YouTube'],
  ['lyrics-manager', '📝 Lyrics'],
  ['bulk-categorization', '🏷️ Categories'],
  ['duplicate-manager', '🔍 Cleanup'],
];

function AdminInterface() {
  const [activeTab, setActiveTab] = useState('manage-songs');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [message, setMessage] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setMessage('Admin access granted');
      setTimeout(() => setMessage(''), 3000);
    } else {
      setMessage('Invalid admin password');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const tabButton = ([key, label]) => (
    <button
      key={key}
      className={`admin-tab ${activeTab === key ? 'active' : ''}`}
      onClick={() => setActiveTab(key)}
      style={{
        padding: '8px 16px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        backgroundColor: activeTab === key ? '#007bff' : '#fff',
        color: activeTab === key ? '#fff' : '#333',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500'
      }}
    >
      {label}
    </button>
  );

  if (!isAuthenticated) {
    return (
      <div className="admin-login">
        <div className="admin-login-container">
          <h2>Admin Access Required</h2>
          <p>Please enter the admin password to access the admin dashboard.</p>

          {message && (
            <div className={`admin-message ${message.includes('Invalid') ? 'error' : 'success'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleLogin} className="admin-login-form">
            <input
              type="password"
              className="admin-password-input"
              placeholder="Admin password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              required
            />
            <button type="submit" className="admin-login-btn">
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-interface">
      <div className="admin-header">
        <div className="admin-title">
          <h1>Admin Dashboard</h1>
          <p>Manage songs, playlists, and categorizations</p>
        </div>
        <div className="admin-nav" style={{
          display: 'flex',
          flexDirection: 'row',
          gap: '20px',
          marginBottom: '20px',
          padding: '15px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #dee2e6'
        }}>
          <div className="nav-section" style={{ flex: '1', minWidth: '0' }}>
            <div className="nav-section-title" style={{
              fontSize: '14px',
              fontWeight: 'bold',
              color: '#495057',
              marginBottom: '8px',
              paddingBottom: '5px',
              borderBottom: '2px solid #e9ecef'
            }}>📚 Content Management</div>
            <div className="nav-buttons" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {CONTENT_TABS.map(tabButton)}
            </div>
          </div>

          <div className="nav-section" style={{ flex: '1', minWidth: '0' }}>
            <div className="nav-section-title" style={{
              fontSize: '14px',
              fontWeight: 'bold',
              color: '#495057',
              marginBottom: '8px',
              paddingBottom: '5px',
              borderBottom: '2px solid #e9ecef'
            }}>🛠️ Data Enhancement</div>
            <div className="nav-buttons" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {DATA_TABS.map(tabButton)}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className={`admin-message ${message.includes('Error') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      {activeTab === 'manage-songs' && <ManageSongsTab />}
      {activeTab === 'staging' && <StagingQueue />}
      {activeTab === 'manage-playlists' && <ManagePlaylistsTab />}
      {activeTab === 'manage-artists' && <ArtistsManager />}
      {activeTab === 'song-submissions' && <SubmissionsManager />}
      {activeTab === 'dashboard' && <DataCompletionDashboard />}
      {activeTab === 'youtube-videos' && <YouTubeVideoManager />}
      {activeTab === 'lyrics-manager' && <LyricsLookupManager />}
      {activeTab === 'bulk-categorization' && <BulkCategorizationWorkflow />}
      {activeTab === 'duplicate-manager' && <DuplicateManager />}
    </div>
  );
}

export default AdminInterface;
