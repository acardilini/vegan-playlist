import './App.css'
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { spotifyService } from './api/spotifyService';
import MoodBadge from './components/MoodBadge';
import SearchResults from './components/SearchResults';
import ArtistSearchResults from './components/ArtistSearchResults';
import ArtistDetailPage from './components/ArtistDetailPage';
import AdminInterface from './components/AdminInterface';
import SearchAndFilter from './components/SearchAndFilter';
import { playlistService } from './api/playlistService';

function PaginationControls({ currentPage, totalPages, onPageChange }) {
  const generatePageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 7;
    
    if (totalPages <= maxVisiblePages) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show truncated pagination
      pages.push(1);
      
      if (currentPage > 4) {
        pages.push('...');
      }
      
      // Show pages around current page
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) {
          pages.push(i);
        }
      }
      
      if (currentPage < totalPages - 3) {
        pages.push('...');
      }
      
      if (!pages.includes(totalPages)) {
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  return (
    <div className="pagination">
      <div className="pagination-info">
        Page {currentPage} of {totalPages}
      </div>
      
      <div className="pagination-controls">
        {/* Previous button */}
        <button 
          className={`pagination-btn ${currentPage === 1 ? 'disabled' : ''}`}
          onClick={() => currentPage > 1 && onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        >
          ← Previous
        </button>
        
        {/* Page numbers */}
        {generatePageNumbers().map((page, index) => (
          <button
            key={index}
            className={`pagination-btn ${page === currentPage ? 'active' : ''} ${page === '...' ? 'ellipsis' : ''}`}
            onClick={() => typeof page === 'number' && onPageChange(page)}
            disabled={page === '...' || page === currentPage}
          >
            {page}
          </button>
        ))}
        
        {/* Next button */}
        <button 
          className={`pagination-btn ${currentPage === totalPages ? 'disabled' : ''}`}
          onClick={() => currentPage < totalPages && onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          Next →
        </button>
      </div>
    </div>
  );
}


function NavigationMenu() {
  const navigate = useNavigate();
  const location = window.location;

  const handleNavClick = (path, section) => {
    navigate(path);
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <nav className="navigation-menu">
      <ul>
        <li className={`nav-item ${isActive('/') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/', 'Home'); }}>
            Home
          </a>
        </li>
        <li className={`nav-item ${isActive('/artists') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/artists', 'Artists'); }}>
            Artists
          </a>
        </li>
        <li className={`nav-item ${isActive('/playlists') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/playlists', 'Playlists'); }}>
            Playlists
          </a>
        </li>
        <li className={`nav-item ${isActive('/about') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/about', 'About'); }}>
            About
          </a>
        </li>
        <li className={`nav-item ${isActive('/admin') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/admin', 'Admin'); }}>
            Admin
          </a>
        </li>
      </ul>
    </nav>
  );
}

function DescriptionSection() {
  return (
    <section className="description-section">
      <div className="description-content">
        <p>
          Welcome to a searchable database of vegan, animal rights, and animal liberation songs.
        </p>
      </div>
    </section>
  );
}

function StatsSection() {
  const [stats, setStats] = useState({ songs: 0, artists: 0, albums: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const fetchedStats = await spotifyService.getStats();
        setStats(fetchedStats);
      } catch (err) {
        console.error('Error loading stats:', err);
        // Keep default stats if API fails
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const handleStatClick = (statType) => {
    console.log('Stat clicked:', statType);
    alert(`Show all ${statType.toLowerCase()} (functionality coming soon!)`);
  };

  return (
    <section className="stats-section">
      <div className="stats-container">
        <div className="stat-item" onClick={() => handleStatClick('Songs')}>
          <div className="stat-number">{loading ? '...' : `${stats.songs}+`}</div>
          <div className="stat-label">Songs</div>
        </div>
        <div className="stat-item" onClick={() => handleStatClick('Artists')}>
          <div className="stat-number">{loading ? '...' : `${stats.artists}+`}</div>
          <div className="stat-label">Artists</div>
        </div>
        <div className="stat-item" onClick={() => handleStatClick('Hours')}>
          <div className="stat-number">40+</div>
          <div className="stat-label">Hours</div>
        </div>
        <div className="stat-item" onClick={() => handleStatClick('Years Curated')}>
          <div className="stat-number">7</div>
          <div className="stat-label">Years Curated</div>
        </div>
      </div>
    </section>
  );
}

function HeroArea() {
  return (
    <div className="hero-area">
      <div className="hero-content">
        <DescriptionSection />
        <StatsSection />
      </div>
    </div>
  );
}


function SongDetailPage() {
  const { songId } = useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState(null);
  const [similarSongs, setSimilarSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSongData = async () => {
      try {
        setLoading(true);
        const [songData, similarData] = await Promise.all([
          spotifyService.getSong(songId),
          spotifyService.getSimilarSongs(songId, 6).catch(err => {
            console.warn('Could not load similar songs:', err);
            return { similar_songs: [] };
          })
        ]);
        
        setSong(songData);
        setSimilarSongs(similarData.similar_songs || []);
      } catch (err) {
        console.error('Error fetching song:', err);
        setError('Failed to load song details');
      } finally {
        setLoading(false);
      }
    };

    if (songId) {
      fetchSongData();
    }
  }, [songId]);

  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getArtwork = () => {
    if (song?.album_images && song.album_images.length > 0) {
      const largeImage = song.album_images.find(img => img.width >= 500);
      return largeImage ? largeImage.url : song.album_images[0].url;
    }
    return "https://via.placeholder.com/400x400/1DB954/000000?text=♪";
  };

  const handlePlayPreview = () => {
    if (song?.preview_url) {
      window.open(song.preview_url, '_blank');
    } else if (song?.spotify_url) {
      window.open(song.spotify_url, '_blank');
    } else {
      alert('No preview available for this song');
    }
  };

  const AudioFeatureBar = ({ label, value, color = '#1DB954' }) => {
    const percentage = Math.round(value * 100);
    return (
      <div className="audio-feature-bar">
        <div className="feature-label">
          <span>{label}</span>
          <span>{percentage}%</span>
        </div>
        <div className="feature-bar-bg">
          <div 
            className="feature-bar-fill" 
            style={{ width: `${percentage}%`, backgroundColor: color }}
          />
        </div>
      </div>
    );
  };

  const CategoryBadges = ({ categories, title, colorClass }) => {
    if (!categories || categories.length === 0) return null;
    
    return (
      <div className="category-group">
        <h4>{title}</h4>
        <div className="category-badges">
          {categories.map((category, index) => (
            <span key={index} className={`category-badge ${colorClass}`}>
              {category}
            </span>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="song-detail-container loading">
        <div className="loading-content">
          <h2>Loading song details...</h2>
          <p>🎵</p>
        </div>
      </div>
    );
  }

  if (error || !song) {
    return (
      <div className="song-detail-container error">
        <h2>Song not found</h2>
        <p>{error || 'The song you\'re looking for doesn\'t exist.'}</p>
        <button className="back-button" onClick={() => navigate(-1)}>
          ← Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="song-detail-container">
      <div className="song-detail-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div className="header-actions">
          <button 
            className="share-button"
            onClick={() => navigator.clipboard.writeText(window.location.href)}
          >
            Share
          </button>
        </div>
      </div>
      
      <div className="song-detail-content">
        {/* Main Song Info Section */}
        <div className="song-hero">
          <div className="song-artwork-large">
            <img 
              src={getArtwork()}
              alt={`${song.title} artwork`}
            />
            <div className="artwork-overlay">
              <button className="play-preview-button" onClick={handlePlayPreview}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div className="song-info-main">
            <h1 className="song-title">{song.title}</h1>
            <h2 className="song-artist">
              {Array.isArray(song.artists) ? (
                song.artists.map(artist => artist.name).join(', ')
              ) : (
                song.artists
              )}
            </h2>
            
            {song.album_name && (
              <p className="song-album">
                <strong>Album:</strong> {song.album_name}
              </p>
            )}
            
            <div className="song-meta-grid">
              {song.release_date && (
                <div className="meta-item">
                  <span className="meta-label">Year</span>
                  <span className="meta-value">{new Date(song.release_date).getFullYear()}</span>
                </div>
              )}
              <div className="meta-item">
                <span className="meta-label">Duration</span>
                <span className="meta-value">{formatDuration(song.duration_ms)}</span>
              </div>
              {song.popularity > 0 && (
                <div className="meta-item">
                  <span className="meta-label">Popularity</span>
                  <span className="meta-value">{song.popularity}%</span>
                </div>
              )}
              {song.explicit && (
                <div className="meta-item">
                  <span className="explicit-badge">Explicit</span>
                </div>
              )}
            </div>

            <div className="external-links">
              {song.spotify_url && (
                <a href={song.spotify_url} target="_blank" rel="noopener noreferrer" className="spotify-link">
                  <span>Open in Spotify</span>
                </a>
              )}
              {song.preview_url && (
                <button onClick={handlePlayPreview} className="preview-link">
                  🎵 Play Preview
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Grid Layout for Main Sections */}
        <div className="song-sections-grid">
          {/* Vegan Categorization Section */}
          <div className="song-categories">
            <h3>Vegan Advocacy Analysis</h3>
            <div className="categories-grid">
              <CategoryBadges 
                categories={song.vegan_focus} 
                title="Vegan Focus" 
                colorClass="vegan-focus"
              />
              <CategoryBadges 
                categories={song.animal_category} 
                title="Animal Category" 
                colorClass="animal-category"
              />
              <CategoryBadges 
                categories={song.advocacy_style} 
                title="Advocacy Style" 
                colorClass="advocacy-style"
              />
              <CategoryBadges 
                categories={song.advocacy_issues} 
                title="Advocacy Issues" 
                colorClass="advocacy-issues"
              />
              <CategoryBadges 
                categories={song.lyrical_explicitness} 
                title="Lyrical Approach" 
                colorClass="lyrical-explicitness"
              />
            </div>
          </div>

          {/* Audio Features Section */}
          {(song.energy || song.danceability || song.valence) && (
            <div className="audio-features">
              <h3>Audio Characteristics</h3>
              <div className="features-grid">
                {song.energy && (
                  <AudioFeatureBar 
                    label="Energy" 
                    value={song.energy} 
                    color="#FF6B6B"
                  />
                )}
                {song.danceability && (
                  <AudioFeatureBar 
                    label="Danceability" 
                    value={song.danceability} 
                    color="#4ECDC4"
                  />
                )}
                {song.valence && (
                  <AudioFeatureBar 
                    label="Positivity" 
                    value={song.valence} 
                    color="#FFD93D"
                  />
                )}
                {song.acousticness && (
                  <AudioFeatureBar 
                    label="Acoustic" 
                    value={song.acousticness} 
                    color="#95E1D3"
                  />
                )}
                {song.instrumentalness && (
                  <AudioFeatureBar 
                    label="Instrumental" 
                    value={song.instrumentalness} 
                    color="#A8E6CF"
                  />
                )}
                {song.speechiness && (
                  <AudioFeatureBar 
                    label="Speechiness" 
                    value={song.speechiness} 
                    color="#FFAAA5"
                  />
                )}
              </div>
              
              {/* Additional technical details */}
              <div className="technical-details">
                <h4>Technical Details</h4>
                <div className="tech-grid">
                  {song.tempo && (
                    <div className="tech-item">
                      <span>Tempo</span>
                      <span>{Math.round(song.tempo)} BPM</span>
                    </div>
                  )}
                  {song.key !== null && song.key !== undefined && (
                    <div className="tech-item">
                      <span>Key</span>
                      <span>{['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'][song.key]}</span>
                    </div>
                  )}
                  {song.mode !== null && song.mode !== undefined && (
                    <div className="tech-item">
                      <span>Mode</span>
                      <span>{song.mode === 1 ? 'Major' : 'Minor'}</span>
                    </div>
                  )}
                  {song.time_signature && (
                    <div className="tech-item">
                      <span>Time Signature</span>
                      <span>{song.time_signature}/4</span>
                    </div>
                  )}
                  {song.loudness && (
                    <div className="tech-item">
                      <span>Loudness</span>
                      <span>{song.loudness.toFixed(1)} dB</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Review Section (if available) - Full Width */}
        {song.your_review && (
          <div className="song-review song-section-full-width">
            <h3>Review & Analysis</h3>
            <div className="review-content">
              <p>{song.your_review}</p>
            </div>
          </div>
        )}

        {/* Similar Songs Section - Full Width */}
        {similarSongs.length > 0 && (
          <div className="similar-songs song-section-full-width">
            <h3>You Might Also Like</h3>
            <div className="similar-songs-grid">
              {similarSongs.map((similarSong) => (
                <div 
                  key={similarSong.id} 
                  className="similar-song-card"
                  onClick={() => navigate(`/song/${similarSong.id}`)}
                >
                  <div className="similar-artwork">
                    <img 
                      src={
                        similarSong.album_images?.[0]?.url || 
                        "https://via.placeholder.com/80x80/1DB954/000000?text=♪"
                      }
                      alt={`${similarSong.title} artwork`}
                    />
                    <div className="similar-play-overlay">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                  </div>
                  
                  <div className="similar-info">
                    <h4 className="similar-title">{similarSong.title}</h4>
                    <p className="similar-artist">
                      {Array.isArray(similarSong.artists) 
                        ? similarSong.artists.join(', ') 
                        : similarSong.artists}
                    </p>
                    
                    {/* Show why it's similar */}
                    <div className="similarity-reasons">
                      {similarSong.vegan_focus && similarSong.vegan_focus.some(focus => 
                        song.vegan_focus?.includes(focus)
                      ) && (
                        <span className="similarity-tag vegan-focus">Similar Focus</span>
                      )}
                      {similarSong.advocacy_style && similarSong.advocacy_style.some(style => 
                        song.advocacy_style?.includes(style)
                      ) && (
                        <span className="similarity-tag advocacy-style">Similar Style</span>
                      )}
                      {(Math.abs((similarSong.energy || 0) - (song.energy || 0)) <= 0.3) && (
                        <span className="similarity-tag audio-feature">Similar Energy</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function SongCard({ song, songId, showAddToPlaylist = true, onAddToPlaylist }) {
  const navigate = useNavigate();

  const handleSongClick = () => {
    navigate(`/song/${songId}`);
  };

  const handlePlayClick = (e) => {
    e.stopPropagation();
    alert(`Playing "${song.title}" (functionality coming soon!)`);
  };

  const handleAddToPlaylistClick = (e) => {
    e.stopPropagation();
    if (onAddToPlaylist) {
      onAddToPlaylist(song);
    }
  };

  // Format duration from milliseconds
  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format playlist add date
  const formatPlaylistAddDate = (dateString) => {
    if (!dateString) return null;
    
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) {
      return `Added ${diffDays} days ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `Added ${months} month${months > 1 ? 's' : ''} ago`;
    } else {
      const years = Math.floor(diffDays / 365);
      return `Added ${years} year${years > 1 ? 's' : ''} ago`;
    }
  };

  // Get album artwork
  const getArtwork = () => {
    if (song.album_images && song.album_images.length > 0) {
      const mediumImage = song.album_images.find(img => img.width === 300);
      return mediumImage ? mediumImage.url : song.album_images[0].url;
    }
    return "https://via.placeholder.com/150x150/1DB954/000000?text=♪";
  };

  // Get primary genre for display
  const getPrimaryGenre = () => {
    // SIMPLIFIED: Use artist genres only
    if (song.artist_genres && song.artist_genres.length > 0) {
      const flatGenres = song.artist_genres.flat();
      return flatGenres[0] || null;
    }
    
    return null;
  };

  // SIMPLIFIED: Calculate parent genre from artist genres directly
  const getParentGenre = () => {
    if (!song.artist_genres || song.artist_genres.length === 0) return null;
    
    const genreMapping = {
      'metal': ['metalcore', 'deathcore', 'mathcore', 'groove metal', 'death metal', 'black metal', 'thrash metal', 'doom metal', 'progressive metal', 'nu metal', 'melodic death metal', 'sludge metal', 'stoner metal', 'grindcore', 'heavy metal', 'alternative metal', 'industrial metal', 'speed metal', 'rap metal', 'djent'],
      'punk': ['punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk'],
      'hardcore': ['hardcore', 'melodic hardcore', 'post-hardcore', 'crossover hardcore', 'screamo', 'midwest emo'],
      'rock': ['blues rock', 'hard rock', 'alternative rock', 'indie rock', 'classic rock', 'progressive rock', 'psychedelic rock', 'garage rock', 'gothic rock', 'industrial rock', 'art rock', 'acid rock', 'grunge', 'post-grunge', 'britpop', 'madchester', 'krautrock', 'noise rock', 'neo-psychedelic', 'folk rock', 'celtic rock', 'brazilian rock'],
      'folk': ['folk punk', 'anti-folk', 'indie folk', 'folk rock', 'acoustic folk', 'contemporary folk', 'folk', 'traditional folk', 'americana', 'celtic', 'singer-songwriter', 'country blues'],
      'blues': ['blues', 'blues rock', 'electric blues', 'acoustic blues', 'delta blues'],
      'pop': ['pop', 'indie pop', 'electropop', 'synthpop', 'power pop', 'dream pop', 'jangle pop', 'swedish pop', 'german pop', 'new wave', 'pop soul'],
      'electronic': ['electronic', 'ambient', 'techno', 'house', 'drum and bass', 'dubstep', 'edm', 'industrial', 'ebm', 'darkwave', 'coldwave', 'cold wave', 'downtempo', 'trip hop', 'glitch', 'witch house', 'footwork', 'bassline', 'riddim', 'minimalism', 'neoclassical'],
      'hip-hop': ['hip hop', 'rap', 'conscious hip hop', 'alternative hip hop', 'underground hip hop', 'east coast hip hop', 'experimental hip hop', 'hardcore hip hop', 'old school hip hop', 'gangster rap', 'horrorcore', 'grime', 'uk grime'],
      'reggae': ['reggae', 'ska', 'dub', 'roots reggae', 'nz reggae', 'lovers rock', 'ragga', 'dancehall', 'rocksteady'],
      'jazz': ['free jazz', 'hard bop'],
      'soul': ['philly soul', 'pop soul', 'gospel', 'gospel r&b']
    };
    
    // Find parent genre for the first artist genre
    const flatGenres = song.artist_genres.flat();
    for (const genre of flatGenres) {
      for (const [parent, subgenres] of Object.entries(genreMapping)) {
        if (subgenres.includes(genre.toLowerCase())) {
          return parent;
        }
      }
    }
    return 'other';
  };

  return (
    <div className="song-card" onClick={handleSongClick}>
      <div className="song-artwork">
        <div className="song-overlay-buttons">
          <div className="play-button" onClick={handlePlayClick}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          {showAddToPlaylist && onAddToPlaylist && (
            <div className="add-to-playlist-button" onClick={handleAddToPlaylistClick} title="Add to Playlist">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14,10H2V12H14V10M14,6H2V8H14V6M2,16H10V14H2V16M21.5,11.5L23,13L16,20L11.5,15.5L13,14L16,17L21.5,11.5Z"/>
              </svg>
            </div>
          )}
        </div>
        <img 
          src={getArtwork()}
          alt={`${song.title} artwork`}
        />
        
        {/* Mood badge overlay */}
        <div className="mood-badge-overlay">
          <MoodBadge song={song} size="small" />
        </div>
      </div>
      
      <div className="song-info">
        <h3 className="song-title">{song.title}</h3>
        <p className="song-artist">
          {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
        </p>
        
        {/* Show genre information if available */}
        {(getPrimaryGenre() || getParentGenre()) && (
          <div className="song-genre-info">
            {getParentGenre() && (
              <span className="song-parent-genre">{getParentGenre()}</span>
            )}
            {getPrimaryGenre() && (
              <span className="song-genre">{getPrimaryGenre()}</span>
            )}
          </div>
        )}
        
        {/* Enhanced metadata with audio features */}
        <div className="song-features">
          {song.energy && (
            <span className="feature-badge energy">
              ⚡ {Math.round(song.energy * 100)}%
            </span>
          )}
          {song.danceability && (
            <span className="feature-badge danceability">
              💃 {Math.round(song.danceability * 100)}%
            </span>
          )}
          {song.valence && (
            <span className="feature-badge valence">
              😊 {Math.round(song.valence * 100)}%
            </span>
          )}
          {song.popularity > 20 && (
            <span className="feature-badge popularity">
              🔥 {song.popularity}% popular
            </span>
          )}
        </div>
        
        <div className="song-meta">
          <span className="song-year">
            {song.release_date ? new Date(song.release_date).getFullYear() : 'Unknown'}
          </span>
          <span className="song-duration">{formatDuration(song.duration_ms)}</span>
          {song.playlist_added_at && (
            <span className="song-added">{formatPlaylistAddDate(song.playlist_added_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function FeaturedSongs() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchFeaturedSongs = async () => {
      try {
        setLoading(true);
        const fetchedSongs = await spotifyService.getFeaturedSongs(4);
        
        // DEBUG: Log the raw data from API
        console.log('Raw API response:', fetchedSongs);
        console.log('First song structure:', fetchedSongs[0]);
        
        setSongs(fetchedSongs);
      } catch (err) {
        setError('Failed to load featured songs');
        console.error('Error loading featured songs:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedSongs();
  }, []);

  const handleAddToPlaylist = (song) => {
    setSelectedSong(song);
    setShowAddToPlaylistModal(true);
  };

  const handleAddToPlaylistSuccess = (message) => {
    setMessage(message);
    setTimeout(() => setMessage(''), 3000);
  };
  if (loading) {
    return (
      <section className="featured-songs">
        <div className="section-header">
          <h2>Featured Songs</h2>
          <p>Loading your vegan-themed music...</p>
        </div>
        <div className="loading-placeholder">
          <p>🎵 Loading songs...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="featured-songs">
        <div className="section-header">
          <h2>Featured Songs</h2>
          <p>Discover powerful vegan-themed music</p>
        </div>
        <div className="error-message">
          <p>❌ {error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="featured-songs">
      <div className="section-header">
        <h2>Featured Songs</h2>
        <p>Discover powerful vegan-themed music</p>
        {message && (
          <div className="success-message">✅ {message}</div>
        )}
      </div>
      <div className="songs-grid">
        {songs.map((song) => (
          <SongCard 
            key={song.id} 
            song={song} 
            songId={song.id} 
            onAddToPlaylist={handleAddToPlaylist}
          />
        ))}
      </div>
      
      {showAddToPlaylistModal && selectedSong && (
        <AddToPlaylistModal
          song={selectedSong}
          onClose={() => setShowAddToPlaylistModal(false)}
          onSuccess={handleAddToPlaylistSuccess}
        />
      )}
    </section>
  );
}



function SearchSection({ initialSearchQuery = '' }) {
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [message, setMessage] = useState('');

  const handleResults = useCallback((results) => {
    // Store the full API response object including pagination info
    setSearchResults(results);
    setHasSearched(true);
  }, []);

  const handleLoading = useCallback((isLoading) => {
    setLoading(isLoading);
  }, []);

  const handleError = useCallback((errorMessage) => {
    setError(errorMessage);
    setHasSearched(true);
  }, []);

  const handleAddToPlaylist = (song) => {
    setSelectedSong(song);
    setShowAddToPlaylistModal(true);
  };

  const handleAddToPlaylistSuccess = (message) => {
    setMessage(message);
    setTimeout(() => setMessage(''), 3000); // Clear message after 3 seconds
  };

  return (
    <section className="search-section">
      <div className="search-section-content">
        <h2>Find Your Perfect Vegan Song</h2>
        
        {message && (
          <div className="success-message">✅ {message}</div>
        )}
        
        <SearchAndFilter 
          onResults={handleResults}
          onLoading={handleLoading}
          onError={handleError}
          currentPage={currentPage}
          onPageReset={() => setCurrentPage(1)}
          initialQuery={initialSearchQuery}
        />
        
        {/* Search Results */}
        {hasSearched && (
          <div className="home-search-results">
            {loading && <div className="loading">🎵 Searching...</div>}
            {error && <div className="error-message">❌ {error}</div>}
            {!loading && !error && (!searchResults || searchResults.songs?.length === 0) && (
              <div className="no-results">No songs found. Try different filters or search terms.</div>
            )}
            {!loading && !error && searchResults && searchResults.songs?.length > 0 && (
              <div className="search-results-container">
                <h3>
                  {searchResults.pagination.total} songs found
                  {searchResults.filters_applied?.query && (
                    <span> for "{searchResults.filters_applied.query}"</span>
                  )}
                </h3>
                
                {/* Applied filters summary */}
                {Object.values(searchResults.filters_applied || {}).some(filter => 
                  filter && (Array.isArray(filter) ? filter.length > 0 : filter !== 'popularity')
                ) && (
                  <div className="applied-filters">
                    <span>Filters applied:</span>
                    {searchResults.filters_applied.vegan_focus && searchResults.filters_applied.vegan_focus.length > 0 && (
                      <span className="applied-filter">
                        Focus: {searchResults.filters_applied.vegan_focus.join(', ')}
                      </span>
                    )}
                    {searchResults.filters_applied.advocacy_style && searchResults.filters_applied.advocacy_style.length > 0 && (
                      <span className="applied-filter">
                        Style: {searchResults.filters_applied.advocacy_style.join(', ')}
                      </span>
                    )}
                    {searchResults.filters_applied.genres && searchResults.filters_applied.genres.length > 0 && (
                      <span className="applied-filter">
                        Genre: {searchResults.filters_applied.genres.join(', ')}
                      </span>
                    )}
                    {searchResults.filters_applied.year_range && (searchResults.filters_applied.year_range.from || searchResults.filters_applied.year_range.to) && (
                      <span className="applied-filter">
                        Year: {searchResults.filters_applied.year_range.from || '?'} - {searchResults.filters_applied.year_range.to || '?'}
                      </span>
                    )}
                  </div>
                )}
                
                <div className="songs-grid">
                  {searchResults.songs.map((song) => (
                    <SongCard 
                      key={song.id} 
                      song={song} 
                      songId={song.id} 
                      onAddToPlaylist={handleAddToPlaylist}
                    />
                  ))}
                </div>
                
                {/* Pagination */}
                {searchResults.pagination.pages > 1 && (
                  <PaginationControls 
                    currentPage={searchResults.pagination.page}
                    totalPages={searchResults.pagination.pages}
                    onPageChange={setCurrentPage}
                  />
                )}
              </div>
            )}
          </div>
        )}
        
        {showAddToPlaylistModal && selectedSong && (
          <AddToPlaylistModal
            song={selectedSong}
            onClose={() => setShowAddToPlaylistModal(false)}
            onSuccess={handleAddToPlaylistSuccess}
          />
        )}
      </div>
    </section>
  );
}


function HomePage() {
  const location = useLocation();
  
  // Extract search query from URL parameters
  const searchParams = new URLSearchParams(location.search);
  const initialSearchQuery = searchParams.get('q') || '';
  
  return (
    <>
      <HeroArea />
      <FeaturedSongs />
      <SearchSection initialSearchQuery={initialSearchQuery} />
    </>
  );
}


function ArtistsPage() {
  const navigate = useNavigate();
  
  // Sample artist data - will come from backend later
  const sampleArtists = [
    {
      id: 1,
      name: "The Smiths",
      songCount: 3,
      description: "British rock band known for their influential music and outspoken animal rights advocacy.",
      genres: ["Alternative Rock", "Indie Pop"],
      image: null
    },
    {
      id: 2,
      name: "UB40",
      songCount: 2,
      description: "British reggae and pop band with strong social justice themes.",
      genres: ["Reggae", "Pop"],
      image: null
    },
    {
      id: 3,
      name: "Prince Ea",
      songCount: 4,
      description: "American spoken word artist and activist promoting veganism and environmental awareness.",
      genres: ["Hip Hop", "Spoken Word"],
      image: null
    },
    {
      id: 4,
      name: "Moby",
      songCount: 8,
      description: "Electronic music pioneer and long-time vegan advocate.",
      genres: ["Electronic", "Ambient"],
      image: null
    },
    {
      id: 5,
      name: "Rise Against",
      songCount: 6,
      description: "Punk rock band with strong animal rights and environmental messages.",
      genres: ["Punk Rock", "Hardcore"],
      image: null
    },
    {
      id: 6,
      name: "Earth Crisis",
      songCount: 5,
      description: "Hardcore band known for their straight edge and animal liberation lyrics.",
      genres: ["Hardcore", "Metalcore"],
      image: null
    }
  ];

  const handleArtistClick = (artistId) => {
    alert(`Artist page for ID ${artistId} coming soon!`);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Artists</h1>
        <p>Explore musicians advocating for animal rights and veganism</p>
      </div>
      
      <div className="artists-grid">
        {sampleArtists.map((artist) => (
          <div 
            key={artist.id} 
            className="artist-card"
            onClick={() => handleArtistClick(artist.id)}
          >
            <div className="artist-image">
              <img 
                src={artist.image || "https://via.placeholder.com/200x200/1DB954/000000?text=" + artist.name.charAt(0)} 
                alt={`${artist.name}`}
              />
            </div>
            <div className="artist-info">
              <h3>{artist.name}</h3>
              <p className="artist-song-count">{artist.songCount} songs in playlist</p>
              <p className="artist-description">{artist.description}</p>
              <div className="artist-genres">
                {artist.genres.map((genre, index) => (
                  <span key={index} className="genre-tag">{genre}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function PlaylistsPage() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pagination, setPagination] = useState(null);

  // Load playlists on component mount
  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const response = await playlistService.getPlaylists();
      setPlaylists(response.playlists);
      setPagination(response.pagination);
    } catch (error) {
      console.error('Error loading playlists:', error);
      setError('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  };

  const handlePlaylistClick = (playlistId) => {
    navigate(`/playlist/${playlistId}`);
  };

  const handleCreatePlaylist = () => {
    setShowCreateModal(true);
  };

  const handleCreatePlaylistSubmit = async (playlistData) => {
    try {
      await playlistService.createPlaylist(playlistData);
      setShowCreateModal(false);
      loadPlaylists(); // Refresh the list
    } catch (error) {
      console.error('Error creating playlist:', error);
      alert('Failed to create playlist');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Playlists</h1>
        <p>Curated collections of vegan-themed music</p>
        <button className="create-button" onClick={handleCreatePlaylist}>
          Create New Playlist
        </button>
      </div>
      
      {loading && (
        <div className="loading">🎵 Loading playlists...</div>
      )}
      
      {error && (
        <div className="error-message">❌ {error}</div>
      )}
      
      {!loading && !error && playlists.length === 0 && (
        <div className="no-results">
          <h3>No playlists found</h3>
          <p>Be the first to create a playlist!</p>
        </div>
      )}
      
      {!loading && !error && playlists.length > 0 && (
        <div className="playlists-grid">
          {playlists.map((playlist) => (
            <div 
              key={playlist.id} 
              className="playlist-card"
              onClick={() => handlePlaylistClick(playlist.id)}
            >
              <div className="playlist-image">
                <img 
                  src="https://via.placeholder.com/200x200/1DB954/000000?text=♪"
                  alt={playlist.name}
                />
                <div className="playlist-overlay">
                  <div className="play-button">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
              </div>
              <div className="playlist-info">
                <h3>{playlist.name}</h3>
                <p className="playlist-song-count">{playlist.song_count} songs</p>
                <p className="playlist-description">{playlist.description || 'No description'}</p>
                <p className="playlist-creator">Created by {playlist.creator}</p>
                <p className="playlist-date">
                  {new Date(playlist.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {showCreateModal && (
        <CreatePlaylistModal 
          onSubmit={handleCreatePlaylistSubmit}
          onCancel={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

function CreatePlaylistModal({ onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creator, setCreator] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        creator: creator.trim() || 'Anonymous',
        is_public: isPublic
      });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Create New Playlist</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="playlist-name">Playlist Name *</label>
            <input
              id="playlist-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter playlist name"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="playlist-description">Description</label>
            <textarea
              id="playlist-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your playlist (optional)"
              rows="3"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="playlist-creator">Creator Name</label>
            <input
              id="playlist-creator"
              type="text"
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              placeholder="Your name (optional)"
            />
          </div>
          
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Make playlist public
            </label>
          </div>
          
          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="cancel-button">
              Cancel
            </button>
            <button type="submit" className="submit-button">
              Create Playlist
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PlaylistDetailPage() {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadPlaylist();
  }, [playlistId]);

  const loadPlaylist = async () => {
    try {
      setLoading(true);
      const response = await playlistService.getPlaylist(playlistId);
      setPlaylist(response.playlist);
      setSongs(response.songs);
    } catch (error) {
      console.error('Error loading playlist:', error);
      setError('Failed to load playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleSongClick = (songId) => {
    navigate(`/song/${songId}`);
  };

  const handleRemoveSong = async (songId, songTitle) => {
    if (!confirm(`Remove "${songTitle}" from this playlist?`)) return;
    
    try {
      await playlistService.removeSongFromPlaylist(playlistId, songId);
      setMessage(`Removed "${songTitle}" from playlist`);
      setTimeout(() => setMessage(''), 3000);
      loadPlaylist(); // Refresh the playlist
    } catch (error) {
      console.error('Error removing song:', error);
      setMessage('Failed to remove song from playlist');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">🎵 Loading playlist...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="error-message">❌ {error}</div>
        <button onClick={() => navigate('/playlists')} className="back-button">
          Back to Playlists
        </button>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="page-container">
        <div className="no-results">
          <h3>Playlist not found</h3>
          <button onClick={() => navigate('/playlists')} className="back-button">
            Back to Playlists
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="playlist-header">
        <button onClick={() => navigate('/playlists')} className="back-button">
          ← Back to Playlists
        </button>
        
        <div className="playlist-info-header">
          <div className="playlist-image-large">
            <img 
              src="https://via.placeholder.com/300x300/1DB954/000000?text=♪"
              alt={playlist.name}
            />
          </div>
          
          <div className="playlist-details">
            <h1>{playlist.name}</h1>
            <p className="playlist-description">{playlist.description || 'No description'}</p>
            {message && (
              <div className="success-message">✅ {message}</div>
            )}
            <div className="playlist-meta">
              <span className="playlist-creator">Created by {playlist.creator}</span>
              <span className="playlist-date">
                {new Date(playlist.created_at).toLocaleDateString()}
              </span>
              <span className="playlist-song-count">{songs.length} songs</span>
            </div>
          </div>
        </div>
      </div>

      <div className="playlist-songs">
        <h2>Songs</h2>
        {songs.length === 0 ? (
          <div className="no-results">
            <p>This playlist is empty.</p>
          </div>
        ) : (
          <div className="songs-list">
            {songs.map((song, index) => (
              <div 
                key={song.id} 
                className="song-item"
                onClick={() => handleSongClick(song.id)}
              >
                <div className="song-position">{index + 1}</div>
                <div className="song-artwork">
                  <img 
                    src={song.album_images?.[2]?.url || "https://via.placeholder.com/64x64/1DB954/000000?text=♪"}
                    alt={song.title}
                  />
                </div>
                <div className="song-info">
                  <div className="song-title">{song.title}</div>
                  <div className="song-artist">
                    {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
                  </div>
                  {song.album_name && (
                    <div className="song-album">{song.album_name}</div>
                  )}
                </div>
                <div className="song-duration">{formatDuration(song.duration_ms)}</div>
                <button 
                  className="remove-song-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveSong(song.id, song.title);
                  }}
                  title="Remove from playlist"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddToPlaylistModal({ song, onClose, onSuccess }) {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const response = await playlistService.getPlaylists(1, 100); // Get more playlists
      setPlaylists(response.playlists);
    } catch (error) {
      console.error('Error loading playlists:', error);
      setError('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPlaylist) return;

    try {
      setSubmitting(true);
      await playlistService.addSongToPlaylist(selectedPlaylist, song.id);
      onSuccess(`Added "${song.title}" to playlist!`);
      onClose();
    } catch (error) {
      console.error('Error adding song to playlist:', error);
      setError(error.message.includes('already exists') 
        ? 'Song is already in this playlist' 
        : 'Failed to add song to playlist'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Add to Playlist</h2>
        <div className="song-preview">
          <img 
            src={song.album_images?.[2]?.url || "https://via.placeholder.com/64x64/1DB954/000000?text=♪"}
            alt={song.title}
            className="song-preview-image"
          />
          <div className="song-preview-info">
            <div className="song-preview-title">{song.title}</div>
            <div className="song-preview-artist">
              {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
            </div>
          </div>
        </div>

        {loading && <div className="loading">Loading playlists...</div>}
        
        {error && <div className="error-message">❌ {error}</div>}
        
        {!loading && !error && (
          <>
            {playlists.length === 0 ? (
              <div className="no-playlists">
                <p>You don't have any playlists yet.</p>
                <button 
                  onClick={() => {
                    onClose();
                    // You could add navigation to create playlist here
                  }}
                  className="create-playlist-link"
                >
                  Create your first playlist
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="playlist-select">Select Playlist:</label>
                  <select
                    id="playlist-select"
                    value={selectedPlaylist}
                    onChange={(e) => setSelectedPlaylist(e.target.value)}
                    required
                  >
                    <option value="">Choose a playlist...</option>
                    {playlists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name} ({playlist.song_count} songs)
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="modal-actions">
                  <button type="button" onClick={onClose} className="cancel-button">
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="submit-button" 
                    disabled={!selectedPlaylist || submitting}
                  >
                    {submitting ? 'Adding...' : 'Add to Playlist'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}


function AboutPage() {
  return (
    <div className="page-container">
      <div className="about-content">
        <div className="about-header">
          <h1>About The Vegan Playlist</h1>
          <p className="about-subtitle">
            7 years of curating music that advocates for animals, the environment, and compassionate living
          </p>
        </div>
        
        <div className="about-sections">
          <section className="about-section">
            <h2>Our Mission</h2>
            <p>
              The Vegan Playlist is a comprehensive database of songs with vegan, animal rights, 
              and animal liberation themes. We believe music has the power to inspire change and 
              raise awareness about the treatment of animals and environmental issues.
            </p>
          </section>
          
          <section className="about-section">
            <h2>What We Include</h2>
            <p>
              Our collection spans multiple genres and decades, featuring songs that:
            </p>
            <ul>
              <li>Directly advocate for animal rights and liberation</li>
              <li>Promote plant-based living and veganism</li>
              <li>Address environmental issues related to animal agriculture</li>
              <li>Share stories of compassion and empathy for animals</li>
              <li>Critique factory farming and animal exploitation</li>
            </ul>
          </section>
          
          <section className="about-section">
            <h2>Our Approach</h2>
            <p>
              Each song in our database is carefully analyzed and categorized by:
            </p>
            <ul>
              <li><strong>Advocacy Style:</strong> Direct, educational, subtle, or storytelling</li>
              <li><strong>Animal Focus:</strong> All animals, farm animals, or specific species</li>
              <li><strong>Themes:</strong> Animal rights, environment, health, ethics</li>
              <li><strong>Musical Genre:</strong> Rock, hip hop, punk, electronic, and more</li>
            </ul>
          </section>
          
          <section className="about-section">
            <h2>Get Involved</h2>
            <p>
              We welcome song suggestions from the community! If you know of a song with 
              vegan or animal rights themes that we haven't included, please let us know. 
              Together, we can build the most comprehensive collection of advocacy music.
            </p>
          </section>
          
          <div className="about-stats">
            <div className="stat-highlight">
              <span className="stat-number">650+</span>
              <span className="stat-label">Songs Curated</span>
            </div>
            <div className="stat-highlight">
              <span className="stat-number">7</span>
              <span className="stat-label">Years of Research</span>
            </div>
            <div className="stat-highlight">
              <span className="stat-number">200+</span>
              <span className="stat-label">Artists Featured</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function App() {
  return (
    <Router>
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <h1>The Vegan Playlist</h1>
            <NavigationMenu />
          </div>
        </header>
        
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/song/:songId" element={<SongDetailPage />} />
          <Route path="/artists" element={<ArtistSearchResults />} />
          <Route path="/artist/:artistId" element={<ArtistDetailPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/playlist/:playlistId" element={<PlaylistDetailPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/admin" element={<AdminInterface />} />
        </Routes>
        
        <footer className="app-footer">
          <p>&copy; {new Date().getFullYear()} The Vegan Playlist</p>
        </footer>
      </div>
    </Router>
  );
}

export default App