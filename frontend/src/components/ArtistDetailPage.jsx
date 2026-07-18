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

  // Group songs by album, newest release first; songs without an album
  // collect under "Other songs" at the end.
  const OTHER = 'Other songs';
  const groupsByAlbum = new Map();
  songs.forEach((song) => {
    const key = song.album_name || OTHER;
    if (!groupsByAlbum.has(key)) {
      groupsByAlbum.set(key, { name: key, releaseDate: null, cover: null, songs: [] });
    }
    const group = groupsByAlbum.get(key);
    group.songs.push(song);
    if (!group.releaseDate && song.release_date) group.releaseDate = song.release_date;
    if (!group.cover) group.cover = getSongArtwork(song);
  });
  const albumGroups = [...groupsByAlbum.values()].sort((a, b) => {
    if (a.name === OTHER) return 1;
    if (b.name === OTHER) return -1;
    const aDate = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
    const bDate = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
    return bDate - aDate;
  });

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
            {artist.website_url && (
              <a
                href={artist.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="overlay-btn"
              >
                {artist.website_url.includes('bandcamp.com') ? 'Bandcamp' : 'Website'}
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
                <span className="stat-box-label">Spotify followers</span>
                <span className="stat-box-value">{formatNumber(artist.followers)}</span>
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
        {albumGroups.map((group) => (
          <div key={group.name} className="album-group">
            <div className="album-header">
              <div className="album-cover">
                {group.cover && (
                  <img src={group.cover} alt="" />
                )}
              </div>
              <div className="album-header-info">
                <span className="album-title">{group.name}</span>
                <span className="album-meta">
                  {group.releaseDate && (
                    <>{new Date(group.releaseDate).getFullYear()} · </>
                  )}
                  {group.songs.length} song{group.songs.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <div className="songs-list">
              {group.songs.map((song, index) => (
                <div
                  key={song.id}
                  className="song-item"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open song ${song.title}`}
                  onClick={() => handleSongClick(song.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSongClick(song.id);
                    }
                  }}
                >
                  <span className="song-index">{index + 1}</span>

                  <div className="song-info">
                    <h3 className="song-title">{song.title}</h3>
                  </div>

                  <div className="song-stats">
                    <span className="duration">{formatDuration(song.duration_ms)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default ArtistDetailPage;
