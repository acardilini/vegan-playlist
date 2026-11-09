import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';

const MAX_ARTISTS = 5;

// A slim row of artists whose NAME matches the homepage search, above the song results.
// Renders nothing when the search is empty or no artist name matches, so topic searches look
// exactly as before. Name-only matching (the artist page search also reads bios and notes).
function ArtistsStrip({ query }) {
  const [artists, setArtists] = useState([]);
  const q = (query || '').trim();

  useEffect(() => {
    if (!q) { setArtists([]); return undefined; }
    let cancelled = false;
    spotifyService.searchArtists({ q, name_only: '1', limit: MAX_ARTISTS, sort_by: 'song_count' })
      .then((res) => { if (!cancelled) setArtists(res.artists || []); })
      .catch(() => { if (!cancelled) setArtists([]); }); // the strip is optional; never show an error for it
    return () => { cancelled = true; };
  }, [q]);

  if (!q || artists.length === 0) return null;

  return (
    <div className="artists-strip">
      <div className="artists-strip-head">
        <h4>Artists</h4>
        <Link to={`/artists?q=${encodeURIComponent(q)}`}>See all artists &rarr;</Link>
      </div>
      <div className="artists-strip-chips">
        {artists.map((a) => (
          <Link key={a.id} to={`/artist/${a.id}`} className="artists-strip-chip">
            {a.name}
            <small>{a.song_count} {Number(a.song_count) === 1 ? 'song' : 'songs'}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default ArtistsStrip;
