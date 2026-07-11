import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';
import { roundedStat } from '../utils/stats';

function AboutPage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    spotifyService.getStats()
      .then(setStats)
      .catch((err) => console.error('Error loading stats:', err));
  }, []);

  return (
    <div className="page-container">
      <div className="about-container">
        <div className="page-header">
          <h1>About The Vegan Playlist</h1>
          <p className="about-subtitle">
            7 years of curating music that speaks to animals, the environment,
            and compassionate living.
          </p>
        </div>

        <section className="about-section">
          <h2>Our mission</h2>
          <p>
            The Vegan Playlist is a searchable database of songs with vegan,
            animal-rights, animal-liberation, care, and appreciation themes. We
            believe music can shift how people think about the treatment of
            animals.
          </p>
        </section>

        <section className="about-section">
          <h2>What we include</h2>
          <ul>
            <li>Songs that directly advocate for animal rights and liberation</li>
            <li>Songs that promote plant-based living and veganism</li>
            <li>Songs addressing environmental issues tied to animal agriculture</li>
            <li>Songs of compassion and empathy for animals</li>
            <li>Songs that critique animal exploitation</li>
          </ul>
        </section>

        <section className="about-section">
          <h2>Our approach</h2>
          <ul>
            <li><strong>Advocacy style:</strong> direct, educational, subtle, or storytelling</li>
            <li><strong>Animal focus:</strong> all animals, domain (e.g. factory farming), or specific species</li>
            <li><strong>Themes:</strong> animal rights, health, ethics</li>
            <li><strong>Musical genre:</strong> rock, hip-hop, punk, electronic, and more</li>
          </ul>
        </section>

        <section className="about-section">
          <h2>Get involved</h2>
          <p>
            Know a song with vegan, animal-rights/liberation, or animal-appreciation
            themes we’re missing? Suggest it — together we can build the most
            complete collection of animal advocacy music.
          </p>
          <div>
            <Link to="/submit" className="btn btn-secondary">Submit a song</Link>
          </div>
        </section>

        <div className="about-stats">
          <div className="stat-badge">
            <span className="stat-value">{roundedStat(stats?.songs)}</span>
            <span className="stat-label">Songs curated</span>
          </div>
          <div className="stat-badge">
            <span className="stat-value">7</span>
            <span className="stat-label">Years of research</span>
          </div>
          <div className="stat-badge">
            <span className="stat-value">{roundedStat(stats?.artists)}</span>
            <span className="stat-label">Artists featured</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutPage;
