import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';
import YouTubeEmbed from '../components/YouTubeEmbed';

function SongDetailPage() {
  const { songId } = useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState(null);
  const [similarSongs, setSimilarSongs] = useState([]);
  const [youtubeVideo, setYoutubeVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSongData = async () => {
      try {
        setLoading(true);
        const [songData, similarData, youtubeData] = await Promise.all([
          spotifyService.getSong(songId),
          spotifyService.getSimilarSongs(songId, 6).catch(err => {
            console.warn('Could not load similar songs:', err);
            return { similar_songs: [] };
          }),
          fetch(`http://localhost:5000/api/youtube/songs/${songId}/video/primary`)
            .then(res => res.json())
            .catch(err => {
              console.warn('Could not load YouTube video:', err);
              return { success: true, video: null };
            })
        ]);

        setSong(songData);
        setSimilarSongs(similarData.similar_songs || []);
        setYoutubeVideo(youtubeData.success ? youtubeData.video : null);
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
        {/* Main Song Info Section - New Layout */}
        <div className="song-hero">
          <div className="hero-top-section">
            <div className="artwork-and-info-column">
              <div className="song-artwork-large">
                <img
                  src={getArtwork()}
                  alt={`${song.title} artwork`}
                />

                {/* Explicit badge overlay */}
                {song.explicit && (
                  <div className="explicit-overlay">
                    <span className="explicit-badge-overlay">EXPLICIT</span>
                  </div>
                )}

                <div className="artwork-overlay">
                  <button className="play-preview-button" onClick={handlePlayPreview}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Song Title, Artist, Album directly under image */}
              <div className="song-primary-info">
                <h1 className="song-title-large">{song.title}</h1>
                <h2 className="song-artist-large">
                  {Array.isArray(song.artists) ? (
                    song.artists.map(artist => artist.name).join(', ')
                  ) : (
                    song.artists
                  )}
                </h2>

                {song.album_name && (
                  <p className="song-album-large">
                    {song.album_name}
                  </p>
                )}
              </div>
            </div>

            {/* Lyrics Highlights - Next to artwork column */}
            {song.lyrics_highlights && (
              <div className="lyrics-highlights-section">
                <h4 className="lyrics-highlights-title">
                  💭 Lyric Highlights
                </h4>
                <div className="lyrics-highlights-content">
                  <div className="lyrics-quote-wrapper">
                    <span className="quote-icon">"</span>
                    <div className="lyrics-text">
                      {song.lyrics_highlights.split('\n').map((line, index) => (
                        line.trim() && (
                          <div key={index} className="lyrics-highlight-line">
                            {line.startsWith('- ') || line.startsWith('• ') ? (
                              <span className="highlight-bullet">{line}</span>
                            ) : (
                              <span className="highlight-quote">{line}</span>
                            )}
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                </div>
                <small className="lyrics-highlights-disclaimer">
                  Brief excerpts for analytical purposes
                </small>
              </div>
            )}
          </div>

        {/* Remaining Song Information - Below the main section */}
        <div className="song-info-main">

            <div className="meta-and-actions">
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
              </div>

              <div className="external-links-compact">
                {song.spotify_url && (
                  <a href={song.spotify_url} target="_blank" rel="noopener noreferrer" className="spotify-link-compact">
                    Open in Spotify
                  </a>
                )}
                {song.lyrics_url && (
                  <a href={song.lyrics_url} target="_blank" rel="noopener noreferrer" className="lyrics-link-compact">
                    {song.lyrics_source === 'genius' && 'View Lyrics on Genius'}
                    {song.lyrics_source === 'bandcamp' && 'View Lyrics on Bandcamp'}
                    {song.lyrics_source === 'other' && 'View Lyrics'}
                    {!song.lyrics_source && 'View Lyrics'}
                  </a>
                )}
                {song.preview_url && (
                  <button onClick={handlePlayPreview} className="preview-link-compact">
                    🎵 Play Preview
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* YouTube Video Section */}
        <div className="video-section">
          <h3>Music Video</h3>
          <YouTubeEmbed
            videoId={youtubeVideo?.youtube_id}
            title={`${song.title} by ${Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}`}
            fallbackMessage="No music video available for this song"
          />
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
          {(song.acousticness || song.instrumentalness || song.speechiness) && (
            <div className="audio-features">
              <h3>Audio Characteristics</h3>
              <div className="features-grid">
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

export default SongDetailPage;
