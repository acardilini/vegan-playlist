import './App.css'
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { spotifyService } from './api/spotifyService';
import MoodBadge from './components/MoodBadge';


function NavigationMenu() {
  const navigate = useNavigate();
  const location = window.location;

  const handleNavClick = (path, section) => {
    navigate(path);
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <nav className="navigation-menu">
      <ul>
        <li className={`nav-item ${isActive('/') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/', 'Browse Songs'); }}>
            Browse Songs
          </a>
        </li>
        <li className={`nav-item ${isActive('/artists') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/artists', 'Artists'); }}>
            Artists
          </a>
        </li>
        <li className={`nav-item ${isActive('/playlists') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/playlists', 'Playlists'); }}>
            Playlists
          </a>
        </li>
        <li className={`nav-item ${isActive('/about') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/about', 'About'); }}>
            About
          </a>
        </li>
      </ul>
    </nav>
  );
}

function DescriptionSection() {
  return (
    <section className="description-section">
      <div className="description-content">
        <p>
          Welcome to a searchable database of vegan, animal rights, and animal liberation songs.
        </p>
      </div>
    </section>
  );
}

function StatsSection() {
  const [stats, setStats] = useState({ songs: 0, artists: 0, albums: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const fetchedStats = await spotifyService.getStats();
        setStats(fetchedStats);
      } catch (err) {
        console.error('Error loading stats:', err);
        // Keep default stats if API fails
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const handleStatClick = (statType) => {
    console.log('Stat clicked:', statType);
    alert(`Show all ${statType.toLowerCase()} (functionality coming soon!)`);
  };

  return (
    <section className="stats-section">
      <div className="stats-container">
        <div className="stat-item" onClick={() => handleStatClick('Songs')}>
          <div className="stat-number">{loading ? '...' : `${stats.songs}+`}</div>
          <div className="stat-label">Songs</div>
        </div>
        <div className="stat-item" onClick={() => handleStatClick('Artists')}>
          <div className="stat-number">{loading ? '...' : `${stats.artists}+`}</div>
          <div className="stat-label">Artists</div>
        </div>
        <div className="stat-item" onClick={() => handleStatClick('Hours')}>
          <div className="stat-number">40+</div>
          <div className="stat-label">Hours</div>
        </div>
        <div className="stat-item" onClick={() => handleStatClick('Years Curated')}>
          <div className="stat-number">7</div>
          <div className="stat-label">Years Curated</div>
        </div>
      </div>
    </section>
  );
}

function HeroArea() {
  return (
    <div className="hero-area">
      <div className="hero-content">
        <DescriptionSection />
        <StatsSection />
      </div>
    </div>
  );
}


function SongDetailPage() {
  const { songId } = useParams();
  const navigate = useNavigate();
  
  // For now, we'll find the song from our sample data
  const sampleSongs = [
    {
      id: 1,
      title: "Meat Is Murder",
      artist: "The Smiths",
      year: "1985",
      duration: "6:06",
      tags: ["Animal Rights", "Alternative Rock"],
      artwork: null,
      album: "Meat Is Murder",
      lyrics: "Heifer whines could be human cries / Closer comes the screaming knife...",
      description: "A powerful anti-meat anthem from The Smiths' 1985 album, directly addressing the ethics of meat consumption."
    },
    {
      id: 2,
      title: "Food for Thought",
      artist: "UB40",
      year: "1980", 
      duration: "4:05",
      tags: ["Reggae", "Social Justice"],
      artwork: null,
      album: "Signing Off",
      lyrics: "Ivory madonna dying in the dust / Waiting for the manna coming from the west...",
      description: "UB40's reggae classic addressing world hunger and social inequality."
    },
    {
      id: 3,
      title: "Eating Animals",
      artist: "Andy Hurley",
      year: "2012",
      duration: "3:42",
      tags: ["Punk", "Direct"],
      artwork: null,
      album: "Single",
      lyrics: "Stop eating animals / They have feelings too...",
      description: "A direct punk anthem advocating for animal rights and veganism."
    },
    {
      id: 4,
      title: "Go Vegan",
      artist: "Prince Ea",
      year: "2017",
      duration: "4:18",
      tags: ["Hip Hop", "Educational"],
      artwork: null,
      album: "Single",
      lyrics: "Plant-based living is the way to go / For the animals, planet, and your health, you know...",
      description: "An educational hip-hop track promoting the benefits of vegan living."
    }
  ];

  const song = sampleSongs.find(s => s.id === parseInt(songId));

  if (!song) {
    return (
      <div className="song-detail-container">
        <h2>Song not found</h2>
        <button onClick={() => navigate('/')}>Back to Home</button>
      </div>
    );
  }

  return (
    <div className="song-detail-container">
      <button className="back-button" onClick={() => navigate('/')}>
        ← Back to Home
      </button>
      
      <div className="song-detail-content">
        <div className="song-detail-artwork">
          <img 
            src={song.artwork || "https://via.placeholder.com/300x300/1DB954/000000?text=♪"} 
            alt={`${song.title} artwork`}
          />
          <button className="detail-play-button">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
        </div>
        
        <div className="song-detail-info">
          <h1>{song.title}</h1>
          <h2>{song.artist}</h2>
          <p className="song-album">Album: {song.album}</p>
          
          <div className="song-detail-tags">
            {song.tags.map((tag, index) => (
              <span key={index} className="song-tag">{tag}</span>
            ))}
          </div>
          
          <div className="song-detail-meta">
            <span>Year: {song.year}</span>
            <span>Duration: {song.duration}</span>
          </div>
          
          <div className="song-description">
            <h3>About This Song</h3>
            <p>{song.description}</p>
          </div>
          
          <div className="song-lyrics">
            <h3>Lyrics (Sample)</h3>
            <p className="lyrics-text">{song.lyrics}</p>
          </div>
        </div>
      </div>
    </div>
  );
}


function SongCard({ song, songId }) {
  const navigate = useNavigate();

  const handleSongClick = () => {
    navigate(`/song/${songId}`);
  };

  const handlePlayClick = (e) => {
    e.stopPropagation();
    alert(`Playing "${song.title}" (functionality coming soon!)`);
  };

  // Format duration from milliseconds
  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format playlist add date
  const formatPlaylistAddDate = (dateString) => {
    if (!dateString) return null;
    
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) {
      return `Added ${diffDays} days ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `Added ${months} month${months > 1 ? 's' : ''} ago`;
    } else {
      const years = Math.floor(diffDays / 365);
      return `Added ${years} year${years > 1 ? 's' : ''} ago`;
    }
  };

  // Get album artwork
  const getArtwork = () => {
    if (song.album_images && song.album_images.length > 0) {
      const mediumImage = song.album_images.find(img => img.width === 300);
      return mediumImage ? mediumImage.url : song.album_images[0].url;
    }
    return "https://via.placeholder.com/150x150/1DB954/000000?text=♪";
  };

  // Get primary genre for display
  const getPrimaryGenre = () => {
    if (song.artist_genres && song.artist_genres.length > 0) {
      const flatGenres = song.artist_genres.flat();
      return flatGenres[0] || null;
    }
    return null;
  };

  return (
    <div className="song-card" onClick={handleSongClick}>
      <div className="song-artwork">
        <div className="play-button" onClick={handlePlayClick}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
        <img 
          src={getArtwork()}
          alt={`${song.title} artwork`}
        />
        
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
        
        {/* Show primary genre if available */}
        {getPrimaryGenre() && (
          <p className="song-genre">{getPrimaryGenre()}</p>
        )}
        
        {/* Enhanced metadata with audio features */}
        <div className="song-features">
          {song.energy && (
            <span className="feature-badge energy">
              ⚡ {Math.round(song.energy * 100)}%
            </span>
          )}
          {song.danceability && (
            <span className="feature-badge danceability">
              💃 {Math.round(song.danceability * 100)}%
            </span>
          )}
          {song.valence && (
            <span className="feature-badge valence">
              😊 {Math.round(song.valence * 100)}%
            </span>
          )}
          {song.popularity > 20 && (
            <span className="feature-badge popularity">
              🔥 {song.popularity}% popular
            </span>
          )}
        </div>
        
        <div className="song-meta">
          <span className="song-year">
            {song.release_date ? new Date(song.release_date).getFullYear() : 'Unknown'}
          </span>
          <span className="song-duration">{formatDuration(song.duration_ms)}</span>
          {song.playlist_added_at && (
            <span className="song-added">{formatPlaylistAddDate(song.playlist_added_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function FeaturedSongs() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchFeaturedSongs = async () => {
      try {
        setLoading(true);
        const fetchedSongs = await spotifyService.getFeaturedSongs(8);
        
        // DEBUG: Log the raw data from API
        console.log('Raw API response:', fetchedSongs);
        console.log('First song structure:', fetchedSongs[0]);
        
        setSongs(fetchedSongs);
      } catch (err) {
        setError('Failed to load featured songs');
        console.error('Error loading featured songs:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedSongs();
  }, []);

  // Rest of component stays the same...
  if (loading) {
    return (
      <section className="featured-songs">
        <div className="section-header">
          <h2>Featured Songs</h2>
          <p>Loading your vegan-themed music...</p>
        </div>
        <div className="loading-placeholder">
          <p>🎵 Loading songs...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="featured-songs">
        <div className="section-header">
          <h2>Featured Songs</h2>
          <p>Discover powerful vegan-themed music</p>
        </div>
        <div className="error-message">
          <p>❌ {error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="featured-songs">
      <div className="section-header">
        <h2>Featured Songs</h2>
        <p>Discover powerful vegan-themed music</p>
      </div>
      <div className="songs-grid">
        {songs.map((song) => (
          <SongCard key={song.id} song={song} songId={song.id} />
        ))}
      </div>
    </section>
  );
}


function SearchBar() {
  const handleSearch = (e) => {
    e.preventDefault();
    const searchTerm = e.target.searchInput.value;
    console.log('Search submitted:', searchTerm);
    alert(`Searching for: "${searchTerm}" (functionality coming soon!)`);
  };

  const handleSearchChange = (e) => {
    console.log('Search input changed:', e.target.value);
  };

  return (
    <form className="search-container" onSubmit={handleSearch}>
      <input 
        type="text" 
        name="searchInput"
        className="search-input" 
        placeholder="Search for vegan songs, artists, or playlists..." 
        onChange={handleSearchChange}
      />
      <button type="submit" className="search-button">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </button>
    </form>
  );
}


function SearchSection() {
  return (
    <section className="search-section">
      <div className="search-section-content">
        <h2>Find Your Perfect Vegan Song</h2>
        <SearchBar />
      </div>
    </section>
  );
}


function HomePage() {
  return (
    <>
      <HeroArea />
      <FeaturedSongs />
      <SearchSection />
      <main>
        <section className="coming-soon">
          <p>Search functionality coming soon!</p>
        </section>
      </main>
    </>
  );
}


function ArtistsPage() {
  const navigate = useNavigate();
  
  // Sample artist data - will come from backend later
  const sampleArtists = [
    {
      id: 1,
      name: "The Smiths",
      songCount: 3,
      description: "British rock band known for their influential music and outspoken animal rights advocacy.",
      genres: ["Alternative Rock", "Indie Pop"],
      image: null
    },
    {
      id: 2,
      name: "UB40",
      songCount: 2,
      description: "British reggae and pop band with strong social justice themes.",
      genres: ["Reggae", "Pop"],
      image: null
    },
    {
      id: 3,
      name: "Prince Ea",
      songCount: 4,
      description: "American spoken word artist and activist promoting veganism and environmental awareness.",
      genres: ["Hip Hop", "Spoken Word"],
      image: null
    },
    {
      id: 4,
      name: "Moby",
      songCount: 8,
      description: "Electronic music pioneer and long-time vegan advocate.",
      genres: ["Electronic", "Ambient"],
      image: null
    },
    {
      id: 5,
      name: "Rise Against",
      songCount: 6,
      description: "Punk rock band with strong animal rights and environmental messages.",
      genres: ["Punk Rock", "Hardcore"],
      image: null
    },
    {
      id: 6,
      name: "Earth Crisis",
      songCount: 5,
      description: "Hardcore band known for their straight edge and animal liberation lyrics.",
      genres: ["Hardcore", "Metalcore"],
      image: null
    }
  ];

  const handleArtistClick = (artistId) => {
    alert(`Artist page for ID ${artistId} coming soon!`);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Artists</h1>
        <p>Explore musicians advocating for animal rights and veganism</p>
      </div>
      
      <div className="artists-grid">
        {sampleArtists.map((artist) => (
          <div 
            key={artist.id} 
            className="artist-card"
            onClick={() => handleArtistClick(artist.id)}
          >
            <div className="artist-image">
              <img 
                src={artist.image || "https://via.placeholder.com/200x200/1DB954/000000?text=" + artist.name.charAt(0)} 
                alt={`${artist.name}`}
              />
            </div>
            <div className="artist-info">
              <h3>{artist.name}</h3>
              <p className="artist-song-count">{artist.songCount} songs in playlist</p>
              <p className="artist-description">{artist.description}</p>
              <div className="artist-genres">
                {artist.genres.map((genre, index) => (
                  <span key={index} className="genre-tag">{genre}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function PlaylistsPage() {
  const navigate = useNavigate();
  
  // Sample playlist data
  const samplePlaylists = [
    {
      id: 1,
      name: "Animal Liberation Anthems",
      description: "Powerful songs directly advocating for animal rights and liberation",
      songCount: 45,
      creator: "Admin",
      tags: ["Direct", "Animal Rights"],
      image: null
    },
    {
      id: 2,
      name: "Vegan Hip Hop",
      description: "Hip hop tracks promoting plant-based living and consciousness",
      songCount: 23,
      creator: "User Contributed",
      tags: ["Hip Hop", "Educational"],
      image: null
    },
    {
      id: 3,
      name: "Environmental Wake-Up Call",
      description: "Songs addressing climate change and environmental destruction",
      songCount: 34,
      creator: "Admin",
      tags: ["Environment", "Climate"],
      image: null
    },
    {
      id: 4,
      name: "Gentle Advocacy",
      description: "Subtle, story-based songs that promote compassion for animals",
      songCount: 28,
      creator: "User Contributed",
      tags: ["Subtle", "Storytelling"],
      image: null
    }
  ];

  const handlePlaylistClick = (playlistId) => {
    alert(`Playlist page for ID ${playlistId} coming soon!`);
  };

  const handleCreatePlaylist = () => {
    alert("Create new playlist functionality coming soon!");
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Playlists</h1>
        <p>Curated collections of vegan-themed music</p>
        <button className="create-button" onClick={handleCreatePlaylist}>
          Create New Playlist
        </button>
      </div>
      
      <div className="playlists-grid">
        {samplePlaylists.map((playlist) => (
          <div 
            key={playlist.id} 
            className="playlist-card"
            onClick={() => handlePlaylistClick(playlist.id)}
          >
            <div className="playlist-image">
              <img 
                src={playlist.image || "https://via.placeholder.com/200x200/1DB954/000000?text=♪"} 
                alt={playlist.name}
              />
              <div className="playlist-overlay">
                <div className="play-button">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
            </div>
            <div className="playlist-info">
              <h3>{playlist.name}</h3>
              <p className="playlist-song-count">{playlist.songCount} songs</p>
              <p className="playlist-description">{playlist.description}</p>
              <p className="playlist-creator">Created by {playlist.creator}</p>
              <div className="playlist-tags">
                {playlist.tags.map((tag, index) => (
                  <span key={index} className="playlist-tag">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function AboutPage() {
  return (
    <div className="page-container">
      <div className="about-content">
        <div className="about-header">
          <h1>About The Vegan Playlist</h1>
          <p className="about-subtitle">
            7 years of curating music that advocates for animals, the environment, and compassionate living
          </p>
        </div>
        
        <div className="about-sections">
          <section className="about-section">
            <h2>Our Mission</h2>
            <p>
              The Vegan Playlist is a comprehensive database of songs with vegan, animal rights, 
              and animal liberation themes. We believe music has the power to inspire change and 
              raise awareness about the treatment of animals and environmental issues.
            </p>
          </section>
          
          <section className="about-section">
            <h2>What We Include</h2>
            <p>
              Our collection spans multiple genres and decades, featuring songs that:
            </p>
            <ul>
              <li>Directly advocate for animal rights and liberation</li>
              <li>Promote plant-based living and veganism</li>
              <li>Address environmental issues related to animal agriculture</li>
              <li>Share stories of compassion and empathy for animals</li>
              <li>Critique factory farming and animal exploitation</li>
            </ul>
          </section>
          
          <section className="about-section">
            <h2>Our Approach</h2>
            <p>
              Each song in our database is carefully analyzed and categorized by:
            </p>
            <ul>
              <li><strong>Advocacy Style:</strong> Direct, educational, subtle, or storytelling</li>
              <li><strong>Animal Focus:</strong> All animals, farm animals, or specific species</li>
              <li><strong>Themes:</strong> Animal rights, environment, health, ethics</li>
              <li><strong>Musical Genre:</strong> Rock, hip hop, punk, electronic, and more</li>
            </ul>
          </section>
          
          <section className="about-section">
            <h2>Get Involved</h2>
            <p>
              We welcome song suggestions from the community! If you know of a song with 
              vegan or animal rights themes that we haven't included, please let us know. 
              Together, we can build the most comprehensive collection of advocacy music.
            </p>
          </section>
          
          <div className="about-stats">
            <div className="stat-highlight">
              <span className="stat-number">650+</span>
              <span className="stat-label">Songs Curated</span>
            </div>
            <div className="stat-highlight">
              <span className="stat-number">7</span>
              <span className="stat-label">Years of Research</span>
            </div>
            <div className="stat-highlight">
              <span className="stat-number">200+</span>
              <span className="stat-label">Artists Featured</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function App() {
  return (
    <Router>
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <h1>The Vegan Playlist</h1>
            <NavigationMenu />
          </div>
        </header>
        
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/song/:songId" element={<SongDetailPage />} />
          <Route path="/artists" element={<ArtistsPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
        
        <footer className="app-footer">
          <p>&copy; {new Date().getFullYear()} The Vegan Playlist</p>
        </footer>
      </div>
    </Router>
  );
}

export default App