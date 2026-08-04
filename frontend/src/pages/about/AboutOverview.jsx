import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import MarkdownPage from '../../components/MarkdownPage';
import { spotifyService } from '../../api/spotifyService';
// The bundled fallback reads the SAME file the API serves — one file in git, so a copied
// fallback cannot drift. Verified 2026-08-04: Vite resolves this in both dev and build with
// no vite.config.js change.
import fallback from '../../../../backend/data/about.md?raw';

function AboutOverview() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    spotifyService.getStats()
      .then(setStats)
      .catch((err) => console.error('Error loading stats:', err));
  }, []);

  // About shows exact counts (curator request) — the home hero keeps rounded ones.
  const exact = (v) => (v ? v.toLocaleString() : '…');

  return (
    <div className="about-container">
      <MarkdownPage
        slug="about"
        fallback={fallback}
        tokens={{ songs: exact(stats?.songs), artists: exact(stats?.artists) }}
      />

      <div>
        <Link to="/submit" className="btn btn-secondary">Submit a song</Link>
      </div>

      <div className="about-stats">
        <div className="stat-badge">
          <span className="stat-value">{exact(stats?.songs)}</span>
          <span className="stat-label">Songs curated</span>
        </div>
        <div className="stat-badge">
          <span className="stat-value">2017</span>
          <span className="stat-label">Playlist started</span>
        </div>
        <div className="stat-badge">
          <span className="stat-value">{exact(stats?.artists)}</span>
          <span className="stat-label">Artists featured</span>
        </div>
      </div>
    </div>
  );
}

export default AboutOverview;
