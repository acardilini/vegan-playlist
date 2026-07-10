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

  // null → striped placeholder (never a blank box, never an external fallback)
  const getArtistImage = () => {
    if (artistData?.artist.images && artistData.artist.images.length > 0) {
      const largeImage = artistData.artist.images.find(img => img.width >= 400);
      return largeImage ? largeImage.url : artistData.artist.images[0].url;
    }
    return null;
  };

  const getSongArtwork = (song) => {
    if (song.album_images && song.album_images.length > 0) {
      const smallImage = song.album_images.find(img => img.width <= 100);
      return smallImage ? smallImage.url : song.album_images[0].url;
    }
    return null;
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
          <p>Loading artist details…</p>
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
          ← Go back
        </button>
      </div>
    );
  }

  const { artist, songs, stats } = artistData;

  return (
    <div className="artist-detail-container">
      {/* Photo hero: overlay controls up top, name/genres/stats in the scrim */}
      <div className="artist-hero-cover">
        {getArtistImage() && (
          <img src={getArtistImage()} alt={`${artist.name} photo`} />
        )}

        <div className="artist-hero-top">
          <button className="overlay-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <div className="header-actions">
            {artist.spotify_url && (
              <a
                href={artist.spotify_url}
                target="_blank"
                rel="noopener noreferrer"
                className="overlay-btn"
              >
                Open in Spotify
              </a>
            )}
            <button
              className="overlay-btn"
              onClick={() => navigator.clipboard.writeText(window.location.href)}
            >
              Share artist
            </button>
          </div>
        </div>

        <div className="artist-hero-scrim">
          <h1>{artist.name}</h1>

          {artist.genres && artist.genres.length > 0 && (
            <div className="artist-hero-genres">
              {artist.genres.map((genre, index) => (
                <span key={index} className="genre-badge">{genre}</span>
              ))}
            </div>
          )}

          <div className="artist-hero-stats">
            <div className="stat-box">
              <span className="stat-box-label">Songs</span>
              <span className="stat-box-value">{stats.total_songs}</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">Albums</span>
              <span className="stat-box-value">{stats.total_albums}</span>
            </div>
            {artist.followers && (
              <div className="stat-box">
                <span className="stat-box-label">Followers</span>
                <span className="stat-box-value">{formatNumber(artist.followers)}</span>
              </div>
            )}
            {artist.popularity > 0 && (
              <div className="stat-box" title="Spotify popularity score (0-100) based on recent play counts">
                <span className="stat-box-label">Spotify popularity</span>
                <span className="stat-box-value">{artist.popularity}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {artist.bio && (
        <section className="detail-section">
          <h2>Biography</h2>
          <div className="review-content">
            <p>{artist.bio}</p>
          </div>
        </section>
      )}

      {artist.vegan_advocacy_notes && (
        <section className="detail-section">
          <h2>Vegan advocacy</h2>
          <div className="review-content">
            <p>{artist.vegan_advocacy_notes}</p>
          </div>
        </section>
      )}

      <section className="detail-section artist-songs">
        <h2>Songs ({songs.length})</h2>
        <div className="songs-list">
          {songs.map((song, index) => (
            <div
              key={song.id}
              className="song-item"
              onClick={() => handleSongClick(song.id)}
            >
              <span className="song-index">{index + 1}</span>

              <div className="song-artwork">
                {getSongArtwork(song) && (
                  <img
                    src={getSongArtwork(song)}
                    alt={`${song.title} artwork`}
                  />
                )}
              </div>

              <div className="song-info">
                <h4 className="song-title">{song.title}</h4>
                <div className="song-meta">
                  <span className="album-name">{song.album_name}</span>
                  {song.release_date && (
                    <span className="release-year">
                      {' · '}{new Date(song.release_date).getFullYear()}
                    </span>
                  )}
                </div>

                <div className="song-categories">
                  <CategoryBadges categories={song.vegan_focus} colorClass="vegan-focus" />
                  <CategoryBadges categories={song.advocacy_style} colorClass="advocacy-style" />
                </div>
              </div>

              <div className="song-stats">
                <span className="duration">{formatDuration(song.duration_ms)}</span>
                {song.popularity > 0 && (
                  <div className="popularity-bar">
                    <div className="popularity-track">
                      <div
                        className="popularity-fill"
                        style={{ width: `${song.popularity}%` }}
                      />
                    </div>
                    <span className="popularity-value">{song.popularity}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default ArtistDetailPage;
