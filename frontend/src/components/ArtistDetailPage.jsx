import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';

function ArtistDetailPage() {
  const { artistId } = useParams();
  const navigate = useNavigate();
  const [artistData, setArtistData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchArtistData = async () => {
      try {
        setLoading(true);
        const data = await spotifyService.getArtist(artistId);
        setArtistData(data);
      } catch (err) {
        console.error('Error fetching artist:', err);
        setError('Failed to load artist details');
      } finally {
        setLoading(false);
      }
    };

    if (artistId) {
      fetchArtistData();
    }
  }, [artistId]);

  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatNumber = (num) => {
    if (!num) return 'Unknown';
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const getArtistImage = () => {
    if (artistData?.artist.images && artistData.artist.images.length > 0) {
      const largeImage = artistData.artist.images.find(img => img.width >= 400);
      return largeImage ? largeImage.url : artistData.artist.images[0].url;
    }
    return "https://via.placeholder.com/400x400/1DB954/000000?text=♪";
  };

  const getSongArtwork = (song) => {
    if (song.album_images && song.album_images.length > 0) {
      const smallImage = song.album_images.find(img => img.width <= 100);
      return smallImage ? smallImage.url : song.album_images[0].url;
    }
    return "https://via.placeholder.com/64x64/1DB954/000000?text=♪";
  };

  const handleSongClick = (songId) => {
    navigate(`/song/${songId}`);
  };

  const CategoryBadges = ({ categories, colorClass }) => {
    if (!categories || categories.length === 0) return null;
    
    return (
      <div className="category-badges">
        {categories.map((category, index) => (
          <span key={index} className={`category-badge ${colorClass}`}>
            {category}
          </span>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="artist-detail-container loading">
        <div className="loading-content">
          <h2>Loading artist details...</h2>
          <p>🎵</p>
        </div>
      </div>
    );
  }

  if (error || !artistData) {
    return (
      <div className="artist-detail-container error">
        <h2>Artist not found</h2>
        <p>{error || 'The artist you\'re looking for doesn\'t exist.'}</p>
        <button className="back-button" onClick={() => navigate(-1)}>
          ← Go Back
        </button>
      </div>
    );
  }

  const { artist, songs, stats } = artistData;

  return (
    <div className="artist-detail-container">
      <div className="artist-detail-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div className="header-actions">
          <button 
            className="share-button"
            onClick={() => navigator.clipboard.writeText(window.location.href)}
          >
            Share Artist
          </button>
        </div>
      </div>
      
      <div className="artist-detail-content">
        {/* Artist Hero Section */}
        <div className="artist-hero">
          <div className="artist-artwork-large">
            <img 
              src={getArtistImage()}
              alt={`${artist.name} photo`}
            />
            <div className="artwork-overlay">
              {artist.spotify_url && (
                <a 
                  href={artist.spotify_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="spotify-button"
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
                  </svg>
                  Open in Spotify
                </a>
              )}
            </div>
          </div>
          
          <div className="artist-info-main">
            <h1 className="artist-name">{artist.name}</h1>
            
            <div className="artist-stats-grid">
              <div className="stat-item">
                <span className="stat-label">Songs</span>
                <span className="stat-value">{stats.total_songs}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Albums</span>
                <span className="stat-value">{stats.total_albums}</span>
              </div>
              {artist.followers && (
                <div className="stat-item">
                  <span className="stat-label">Followers</span>
                  <span className="stat-value">{formatNumber(artist.followers)}</span>
                </div>
              )}
              {artist.popularity > 0 && (
                <div className="stat-item" title="Spotify popularity score (0-100) based on recent play counts">
                  <span className="stat-label">Spotify Popularity</span>
                  <span className="stat-value">{artist.popularity}%</span>
                </div>
              )}
            </div>

            {artist.genres && artist.genres.length > 0 && (
              <div className="artist-genres">
                <h3>Genres</h3>
                <div className="genres-list">
                  {artist.genres.map((genre, index) => (
                    <span key={index} className="genre-badge">{genre}</span>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Bio and Advocacy Notes */}
        <div className="artist-description-grid">
          {artist.bio && (
            <div className="artist-bio">
              <h3>Biography</h3>
              <p>{artist.bio}</p>
            </div>
          )}
          
          {artist.vegan_advocacy_notes && (
            <div className="vegan-advocacy">
              <h3>Vegan Advocacy</h3>
              <p>{artist.vegan_advocacy_notes}</p>
            </div>
          )}
        </div>

        {/* Songs List */}
        <div className="artist-songs">
          <h3>Songs ({songs.length})</h3>
          <div className="songs-list">
            {songs.map((song, index) => (
              <div 
                key={song.id} 
                className="song-item"
                onClick={() => handleSongClick(song.id)}
              >
                <div className="song-index">
                  {index + 1}
                </div>
                
                <div className="song-artwork">
                  <img 
                    src={getSongArtwork(song)}
                    alt={`${song.title} artwork`}
                  />
                </div>
                
                <div className="song-info">
                  <h4 className="song-title">{song.title}</h4>
                  <div className="song-meta">
                    <span className="album-name">{song.album_name}</span>
                    {song.release_date && (
                      <span className="release-year">
                        • {new Date(song.release_date).getFullYear()}
                      </span>
                    )}
                  </div>
                  
                  {/* Vegan Categories */}
                  <div className="song-categories">
                    <CategoryBadges categories={song.vegan_focus} colorClass="vegan-focus" />
                    <CategoryBadges categories={song.advocacy_style} colorClass="advocacy-style" />
                  </div>
                </div>
                
                <div className="song-stats">
                  <span className="duration">{formatDuration(song.duration_ms)}</span>
                  {song.popularity > 0 && (
                    <span className="popularity">{song.popularity}%</span>
                  )}
                </div>
                
                <div className="song-actions">
                  {song.spotify_url && (
                    <a 
                      href={song.spotify_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="spotify-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ♪
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ArtistDetailPage;