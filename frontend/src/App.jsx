import './App.css'
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';




function NavigationMenu() {
  const handleNavClick = (section) => {
    console.log('Navigation clicked:', section);
    alert(`${section} page coming soon!`);
  };

  return (
    <nav className="navigation-menu">
      <ul>
        <li className="nav-item active">
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('Browse Songs'); }}>
            Browse Songs
          </a>
        </li>
        <li className="nav-item">
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('Artists'); }}>
            Artists
          </a>
        </li>
        <li className="nav-item">
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('Playlists'); }}>
            Playlists
          </a>
        </li>
        <li className="nav-item">
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('About'); }}>
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
  const handleStatClick = (statType) => {
    console.log('Stat clicked:', statType);
    alert(`Show all ${statType.toLowerCase()} (functionality coming soon!)`);
  };

  return (
    <section className="stats-section">
      <div className="stats-container">
        <div className="stat-item" onClick={() => handleStatClick('Songs')}>
          <div className="stat-number">650+</div>
          <div className="stat-label">Songs</div>
        </div>
        <div className="stat-item" onClick={() => handleStatClick('Artists')}>
          <div className="stat-number">200+</div>
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

  return (
    <div className="song-card" onClick={handleSongClick}>
      <div className="song-artwork">
        <div className="play-button" onClick={handlePlayClick}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
        <img 
          src={song.artwork || "https://via.placeholder.com/150x150/1DB954/000000?text=♪"} 
          alt={`${song.title} artwork`}
        />
      </div>
      <div className="song-info">
        <h3 className="song-title">{song.title}</h3>
        <p className="song-artist">{song.artist}</p>
        <div className="song-tags">
          {song.tags.map((tag, index) => (
            <span key={index} className="song-tag">{tag}</span>
          ))}
        </div>
        <div className="song-meta">
          <span className="song-year">{song.year}</span>
          <span className="song-duration">{song.duration}</span>
        </div>
      </div>
    </div>
  );
}

function FeaturedSongs() {
  const sampleSongs = [
    {
      id: 1,
      title: "Meat Is Murder",
      artist: "The Smiths",
      year: "1985",
      duration: "6:06",
      tags: ["Animal Rights", "Alternative Rock"],
      artwork: null
    },
    {
      id: 2,
      title: "Food for Thought",
      artist: "UB40",
      year: "1980", 
      duration: "4:05",
      tags: ["Reggae", "Social Justice"],
      artwork: null
    },
    {
      id: 3,
      title: "Eating Animals",
      artist: "Andy Hurley",
      year: "2012",
      duration: "3:42",
      tags: ["Punk", "Direct"],
      artwork: null
    },
    {
      id: 4,
      title: "Go Vegan",
      artist: "Prince Ea",
      year: "2017",
      duration: "4:18",
      tags: ["Hip Hop", "Educational"],
      artwork: null
    }
  ];

  return (
    <section className="featured-songs">
      <div className="section-header">
        <h2>Featured Songs</h2>
        <p>Discover powerful vegan-themed music</p>
      </div>
      <div className="songs-grid">
        {sampleSongs.map((song) => (
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
        </Routes>
        
        <footer className="app-footer">
          <p>&copy; {new Date().getFullYear()} The Vegan Playlist</p>
        </footer>
      </div>
    </Router>
  );
}

export default App