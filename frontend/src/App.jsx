import './App.css'
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { spotifyService } from './api/spotifyService';
import MoodBadge from './components/MoodBadge';
import SearchResults from './components/SearchResults';
import ArtistSearchResults from './components/ArtistSearchResults';
import ArtistDetailPage from './components/ArtistDetailPage';
import AdminInterface from './components/AdminInterface';
import SearchAndFilter from './components/SearchAndFilter';


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
        <li className={`nav-item ${isActive('/search') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/search', 'Search'); }}>
            Search
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


function SongCard({ song, songId }) {
  const navigate = useNavigate();

  const handleSongClick = () => {
    navigate(`/song/${songId}`);
  };

  const handlePlayClick = (e) => {
    e.stopPropagation();
    alert(`Playing "${song.title}" (functionality coming soon!)`);
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
        <div className="play-button" onClick={handlePlayClick}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
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

  // Rest of component stays the same...
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
      </div>
      <div className="songs-grid">
        {songs.map((song) => (
          <SongCard key={song.id} song={song} songId={song.id} />
        ))}
      </div>
    </section>
  );
}



function SearchSection() {
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleResults = useCallback((results) => {
    // Extract songs array from the API response object
    const songs = results.songs || [];
    setSearchResults(songs);
    setHasSearched(true);
  }, []);

  const handleLoading = useCallback((isLoading) => {
    setLoading(isLoading);
  }, []);

  const handleError = useCallback((errorMessage) => {
    setError(errorMessage);
    setHasSearched(true);
  }, []);

  return (
    <section className="search-section">
      <div className="search-section-content">
        <h2>Find Your Perfect Vegan Song</h2>
        <SearchAndFilter 
          onResults={handleResults}
          onLoading={handleLoading}
          onError={handleError}
        />
        
        {/* Search Results */}
        {hasSearched && (
          <div className="home-search-results">
            {loading && <div className="loading">🎵 Searching...</div>}
            {error && <div className="error-message">❌ {error}</div>}
            {!loading && !error && searchResults.length === 0 && (
              <div className="no-results">No songs found. Try different filters or search terms.</div>
            )}
            {!loading && !error && searchResults.length > 0 && (
              <div className="search-results-container">
                <h3>Search Results ({searchResults.length} songs)</h3>
                <div className="songs-grid">
                  {searchResults.slice(0, 8).map((song) => (
                    <SongCard key={song.id} song={song} songId={song.id} />
                  ))}
                </div>
                {searchResults.length > 8 && (
                  <div className="view-all-results">
                    <p>Showing first 8 results. <a href="/search">View all {searchResults.length} results</a></p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}


function HomePage() {
  return (
    <>
      <HeroArea />
      <FeaturedSongs />
      <SearchSection />
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
  
  // Sample playlist data
  const samplePlaylists = [
    {
      id: 1,
      name: "Animal Liberation Anthems",
      description: "Powerful songs directly advocating for animal rights and liberation",
      songCount: 45,
      creator: "Admin",
      tags: ["Direct", "Animal Rights"],
      image: null
    },
    {
      id: 2,
      name: "Vegan Hip Hop",
      description: "Hip hop tracks promoting plant-based living and consciousness",
      songCount: 23,
      creator: "User Contributed",
      tags: ["Hip Hop", "Educational"],
      image: null
    },
    {
      id: 3,
      name: "Environmental Wake-Up Call",
      description: "Songs addressing climate change and environmental destruction",
      songCount: 34,
      creator: "Admin",
      tags: ["Environment", "Climate"],
      image: null
    },
    {
      id: 4,
      name: "Gentle Advocacy",
      description: "Subtle, story-based songs that promote compassion for animals",
      songCount: 28,
      creator: "User Contributed",
      tags: ["Subtle", "Storytelling"],
      image: null
    }
  ];

  const handlePlaylistClick = (playlistId) => {
    alert(`Playlist page for ID ${playlistId} coming soon!`);
  };

  const handleCreatePlaylist = () => {
    alert("Create new playlist functionality coming soon!");
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
      
      <div className="playlists-grid">
        {samplePlaylists.map((playlist) => (
          <div 
            key={playlist.id} 
            className="playlist-card"
            onClick={() => handlePlaylistClick(playlist.id)}
          >
            <div className="playlist-image">
              <img 
                src={playlist.image || "https://via.placeholder.com/200x200/1DB954/000000?text=♪"} 
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
              <p className="playlist-song-count">{playlist.songCount} songs</p>
              <p className="playlist-description">{playlist.description}</p>
              <p className="playlist-creator">Created by {playlist.creator}</p>
              <div className="playlist-tags">
                {playlist.tags.map((tag, index) => (
                  <span key={index} className="playlist-tag">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
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