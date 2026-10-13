import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';
import YouTubeEmbed from '../components/YouTubeEmbed';
import LyricalAnalysis from '../components/LyricalAnalysis';
import SimilarSongs from '../components/SimilarSongs';

// Label for the artist's own link (stored in bandcamp_url, which holds a Bandcamp OR a website URL).
function ownSiteLabel(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) return 'Listen on Bandcamp';
  } catch { /* fall through to the generic label */ }
  return 'Listen online';
}

const VIDEO_TYPE_LABELS = { official: 'Official video', live: 'Live', lyric: 'Lyric video', 'fan-made': 'Fan-made', other: 'Other' };

// One label per video, by type; two videos of the same type are numbered ("Official video 1", "Official video 2").
function videoLabels(videos) {
  const total = {};
  for (const v of videos) total[v.video_type] = (total[v.video_type] || 0) + 1;
  const seen = {};
  return videos.map((v) => {
    const base = VIDEO_TYPE_LABELS[v.video_type] || 'Video';
    seen[v.video_type] = (seen[v.video_type] || 0) + 1;
    return total[v.video_type] > 1 ? `${base} ${seen[v.video_type]}` : base;
  });
}

function SongDetailPage() {
  const { songId } = useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState(null);
  const [youtubeVideos, setYoutubeVideos] = useState([]);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSongData = async () => {
      try {
        setLoading(true);
        const [songData, youtubeData, analysisData] = await Promise.all([
          spotifyService.getSong(songId),
          fetch(`http://localhost:5000/api/youtube/songs/${songId}/videos`)
            .then(res => res.json())
            .catch(err => {
              console.warn('Could not load YouTube video:', err);
              return { success: true, videos: [] };
            }),
          spotifyService.getAnalysis(songId),
        ]);

        setSong(songData);
        setYoutubeVideos(youtubeData.success ? (youtubeData.videos || []) : []);
        setSelectedVideoId(null);
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
  const showSpotify = !!song.spotify_url && !song.spotify_dormant;
  // The route lists the primary video first, so it is the default; the visitor can pick another.
  const youtubeVideo = youtubeVideos.find((v) => v.id === selectedVideoId) || youtubeVideos[0] || null;
  const labels = videoLabels(youtubeVideos);

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

          {(song.bandcamp_url || song.soundcloud_url || showSpotify || song.lyrics_url) && (
            <div className="song-hero-actions">
              {/* The artist's own site leads; Spotify follows, and drops out when the curator marks it dormant. */}
              {song.bandcamp_url && (
                <a
                  href={song.bandcamp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  {ownSiteLabel(song.bandcamp_url)}
                </a>
              )}
              {song.soundcloud_url && (
                <a
                  href={song.soundcloud_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                >
                  Listen on SoundCloud
                </a>
              )}
              {showSpotify && (
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

      {(youtubeVideo?.youtube_id || song.no_video_display !== 'hide') && (
        <section className="detail-section video-section">
          <h2>Music video</h2>
          {youtubeVideos.length > 1 && (
            <div className="video-picker" role="group" aria-label="Choose a video">
              {youtubeVideos.map((v, i) => (
                <button key={v.id} type="button" title={v.video_title || undefined}
                  className={`btn btn-sm ${v.id === youtubeVideo.id ? 'btn-primary' : 'btn-secondary'}`}
                  aria-pressed={v.id === youtubeVideo.id} onClick={() => setSelectedVideoId(v.id)}>
                  {labels[i]}
                </button>
              ))}
            </div>
          )}
          {!youtubeVideo?.youtube_id && song.no_video_display === 'cover' && getArtwork() ? (
            <div className="video-cover-placeholder">
              <img src={getArtwork()} alt={`${song.title} artwork`} />
            </div>
          ) : (
            <YouTubeEmbed
              videoId={youtubeVideo?.youtube_id}
              title={`${song.title} by ${artistNames}`}
              fallbackMessage="No music video available for this song"
            />
          )}
        </section>
      )}

      {song.lyrics_highlights && (
        <section className="detail-section">
          <h2>Lyric highlights</h2>
          <div className="lyrics-quote">
            {song.lyrics_highlights.split(/\n{2,}/).map((passage, index) => (
              passage.trim() && (
                <p key={index} className="lyrics-highlight-line">
                  {passage.trim()}
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
          <h2>Song analysis</h2>
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

      <SimilarSongs songId={songId} />
    </div>
  );
}

export default SongDetailPage;
