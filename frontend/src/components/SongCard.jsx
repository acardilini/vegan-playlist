import { useNavigate } from 'react-router-dom';
import MoodBadge from './MoodBadge';

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
