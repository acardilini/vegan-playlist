import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';
import YouTubeEmbed from '../components/YouTubeEmbed';
import LyricalAnalysis from '../components/LyricalAnalysis';

function SongDetailPage() {
  const { songId } = useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState(null);
  const [similarSongs, setSimilarSongs] = useState([]);
  const [youtubeVideo, setYoutubeVideo] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSongData = async () => {
      try {
        setLoading(true);
        const [songData, similarData, youtubeData, analysisData] = await Promise.all([
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
            }),
          spotifyService.getAnalysis(songId),
        ]);

        setSong(songData);
        setSimilarSongs(similarData.similar_songs || []);
        setYoutubeVideo(youtubeData.success ? youtubeData.video : null);
        setAnalysis(analysisData);
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

  // null → striped placeholder (never a blank box, never an external fallback)
  const getArtwork = () => {
    if (song?.album_images && song.album_images.length > 0) {
      const largeImage = song.album_images.find(img => img.width >= 500);
      return largeImage ? largeImage.url : song.album_images[0].url;
    }
    return null;
  };

  const lyricsLinkLabel = () => {
    if (song.lyrics_source === 'genius') return 'View lyrics on Genius';
    if (song.lyrics_source === 'bandcamp') return 'View lyrics on Bandcamp';
    return 'View lyrics';
  };

  if (loading) {
    return (
      <div className="song-detail-container loading">
        <div className="loading-content">
          <p>Loading song details…</p>
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
          ← Go back
        </button>
      </div>
    );
  }

  const artistNames = Array.isArray(song.artists)
    ? song.artists.map(artist => (artist && artist.name) || artist).join(', ')
    : song.artists;

  const nonEnglish = (song.language || []).some((l) => l.trim().toLowerCase() !== 'english');

  return (
    <div className="song-detail-container">
      <div className="song-detail-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <button
          className="share-button"
          onClick={() => navigator.clipboard.writeText(window.location.href)}
        >
          Share
        </button>
      </div>

      {/* Cover hero: artwork with scrim holding title, meta, and actions */}
      <div className="song-hero-cover">
        {getArtwork() && (
          <img src={getArtwork()} alt={`${song.title} artwork`} />
        )}
        {song.explicit && (
          <span className="explicit-badge-overlay">Explicit</span>
        )}
        <div className="song-hero-scrim">
          <div className="song-hero-titles">
            <h1>{song.title}</h1>
            <span className="song-hero-artist">{artistNames}</span>
            {song.album_name && (
              <span className="song-hero-album">{song.album_name}</span>
            )}
          </div>

          <div className="song-hero-stats">
            {song.release_date && (
              <div className="stat-cell">
                <span className="stat-cell-label">Year</span>
                <span className="stat-cell-value">
                  {new Date(song.release_date).getFullYear()}
                </span>
              </div>
            )}
            <div className="stat-cell">
              <span className="stat-cell-label">Duration</span>
              <span className="stat-cell-value">{formatDuration(song.duration_ms)}</span>
            </div>
            {song.language?.length > 0 && (
              <div className="stat-cell">
                <span className="stat-cell-label">Sung in</span>
                <span className="stat-cell-value">{song.language.join(', ')}</span>
              </div>
            )}
          </div>

          {(song.spotify_url || song.lyrics_url) && (
            <div className="song-hero-actions">
              {song.spotify_url && (
                <a
                  href={song.spotify_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                >
                  Open in Spotify
                </a>
              )}
              {song.lyrics_url && (
                <a
                  href={song.lyrics_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                >
                  {lyricsLinkLabel()}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <section className="detail-section video-section">
        <h2>Music video</h2>
        <YouTubeEmbed
          videoId={youtubeVideo?.youtube_id}
          title={`${song.title} by ${artistNames}`}
          fallbackMessage="No music video available for this song"
        />
      </section>

      {song.lyrics_highlights && (
        <section className="detail-section">
          <h2>Key lyrics</h2>
          <div className="lyrics-quote">
            {song.lyrics_highlights.split('\n').map((line, index) => (
              line.trim() && (
                <p key={index} className="lyrics-highlight-line">
                  {line}
                </p>
              )
            ))}
          </div>
          <span className="section-note">
            {nonEnglish
              ? 'Brief excerpts, with English translation, for analytical purposes'
              : 'Brief excerpts for analytical purposes'}
          </span>
        </section>
      )}

      {analysis && (
        <section className="detail-section">
          <h2>Lyrical analysis</h2>
          <LyricalAnalysis analysis={analysis} />
        </section>
      )}

      {song.your_review && (
        <section className="detail-section">
          <h2>Review &amp; analysis</h2>
          <div className="review-content">
            <p>{song.your_review}</p>
          </div>
        </section>
      )}

      {similarSongs.length > 0 && (
        <section className="detail-section">
          <h2>You might also like</h2>
          <div className="similar-songs-grid">
            {similarSongs.map((similarSong) => (
              <div
                key={similarSong.id}
                className="similar-song-card"
                role="button"
                tabIndex={0}
                aria-label={`Open song ${similarSong.title}`}
                onClick={() => navigate(`/song/${similarSong.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/song/${similarSong.id}`);
                  }
                }}
              >
                <div className="similar-artwork">
                  {similarSong.album_images?.[0]?.url && (
                    <img
                      src={similarSong.album_images[0].url}
                      alt=""
                    />
                  )}
                </div>

                <div className="similar-info">
                  <h3 className="similar-title">{similarSong.title}</h3>
                  <p className="similar-artist">
                    {Array.isArray(similarSong.artists)
                      ? similarSong.artists.join(', ')
                      : similarSong.artists}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default SongDetailPage;
