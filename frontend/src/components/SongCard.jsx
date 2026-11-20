import { useNavigate } from 'react-router-dom';
import MoodBadge from './MoodBadge';
import GENRE_HIERARCHY from '../../../backend/data/genre_hierarchy.json';
import { cardParentGenre } from '../utils/genreHierarchy';

function SongCard({ song, songId }) {
  const navigate = useNavigate();

  const handleSongClick = () => {
    navigate(`/song/${songId}`);
  };

  // Format duration from milliseconds
  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Get album artwork (null → striped placeholder, never a blank box)
  const getArtwork = () => {
    if (song.album_images && song.album_images.length > 0) {
      const mediumImage = song.album_images.find(img => img.width === 300);
      return mediumImage ? mediumImage.url : song.album_images[0].url;
    }
    return null;
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

  // Parent genre from the artist's genres, against the shared hierarchy.
  const getParentGenre = () => cardParentGenre(GENRE_HIERARCHY, song.artist_genres);

  return (
    <div
      className="song-card"
      role="button"
      tabIndex={0}
      aria-label={`Open song ${song.title}`}
      onClick={handleSongClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSongClick();
        }
      }}
    >
      <div className="song-artwork">
        {getArtwork() ? (
          <img
            src={getArtwork()}
            alt=""
          />
        ) : (
          <div className="artwork-placeholder" aria-hidden="true">
            <span>album cover</span>
          </div>
        )}

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

        <div className="song-meta">
          <span className="song-year">
            {song.release_date ? new Date(song.release_date).getFullYear() : 'Unknown'}
          </span>
          <span className="song-duration">{formatDuration(song.duration_ms)}</span>
        </div>
      </div>
    </div>
  );
}

export default SongCard;
