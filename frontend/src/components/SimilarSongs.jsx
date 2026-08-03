import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';

function SongGrid({ songs }) {
  const navigate = useNavigate();
  return (
    <div className="similar-songs-grid">
      {songs.map((song) => (
        <div
          key={song.id}
          className="similar-song-card"
          role="button"
          tabIndex={0}
          aria-label={`Open song ${song.title}`}
          onClick={() => navigate(`/song/${song.id}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              navigate(`/song/${song.id}`);
            }
          }}
        >
          <div className="similar-artwork">
            {song.album_images?.[0]?.url && <img src={song.album_images[0].url} alt="" />}
          </div>
          <div className="similar-info">
            <h3 className="similar-title">{song.title}</h3>
            <p className="similar-artist">
              {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// Two tabs when the song has embeddings; the honest genre panel when it has none. A failed
// request omits the section rather than showing a broken panel.
function SimilarSongs({ songId }) {
  const [data, setData] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Reset so a song-to-song navigation shows the loading state instead of the previous
    // song's recommendations while the new fetch is in flight. `cancelled` (below) still
    // guards against a slow response for an old song overwriting a newer one.
    setData(null);
    setActive(null);
    spotifyService.getSimilarSongs(songId, 6)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setActive(d.tabs?.[0]?.key || null);
      })
      .catch((err) => {
        console.warn('Could not load similar songs:', err);
        if (!cancelled) setData(null);
      });
    return () => { cancelled = true; };
  }, [songId]);

  if (!data) return null;

  const tabs = data.tabs || [];
  const current = tabs.find((t) => t.key === active) || tabs[0] || null;

  if (tabs.length === 0) {
    if (!data.fallback) return null;
    return (
      <section className="detail-section">
        <h2>You might also like</h2>
        <p className="similar-note">{data.fallback.label}</p>
        <SongGrid songs={data.fallback.songs} />
      </section>
    );
  }

  return (
    <section className="detail-section">
      <h2>You might also like</h2>
      <div className="similar-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === current.key}
            className={`similar-tab ${t.key === current.key ? 'active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <SongGrid songs={current.songs} />
    </section>
  );
}

export default SimilarSongs;
