import { Link } from 'react-router-dom';

// Docked in the rail rather than anchored to the point: a popover covers the dot's
// neighbours, which are exactly the songs being compared (spec §5.2).
function SelectedSongCard({ song, colourLabel, colourValue, onClear }) {
  if (!song) {
    return <p className="explore-hint">Click a song to see what it is.</p>;
  }
  return (
    <div className="explore-song-card">
      {song.art && <img className="explore-song-art" src={song.art} alt="" />}
      <div className="explore-song-cardhead">
        <div className="explore-song-title">{song.title}</div>
        {/* Selecting a song is reversible: without this the rail can only ever be swapped
            for another song, never emptied, and the ring stays on the map. Escape does the
            same thing from the keyboard. */}
        <button
          type="button"
          className="explore-song-clear"
          onClick={onClear}
          aria-label="Clear the selected song"
          title="Clear"
        >
          ×
        </button>
      </div>
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
