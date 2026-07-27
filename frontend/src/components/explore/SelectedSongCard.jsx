import { Link } from 'react-router-dom';

// Docked in the rail rather than anchored to the point: a popover covers the dot's
// neighbours, which are exactly the songs being compared (spec §5.2).
function SelectedSongCard({ song, colourLabel, colourValue }) {
  if (!song) {
    return <p className="explore-hint">Click a song to see what it is.</p>;
  }
  return (
    <div className="explore-song-card">
      {song.art && <img className="explore-song-art" src={song.art} alt="" />}
      <div className="explore-song-title">{song.title}</div>
      <div className="explore-song-meta">
        {song.artist}{song.year ? ` · ${song.year}` : ''}
      </div>
      {colourValue && (
        <div className="explore-song-meta">{colourLabel}: {colourValue}</div>
      )}
      <Link className="explore-song-link" to={`/song/${song.id}`}>View song →</Link>
    </div>
  );
}

export default SelectedSongCard;
