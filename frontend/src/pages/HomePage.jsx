import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';
import SearchAndFilter from '../components/SearchAndFilter';
import SongCard from '../components/SongCard';
import PaginationControls from '../components/PaginationControls';
import AddToPlaylistModal from '../components/AddToPlaylistModal';

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
      </div>
    </section>
  );
}

function HeroArea() {
  return (
    <div className="hero-area">
      <div className="hero-content">
        <div className="welcome-and-stats">
          <div className="welcome-text">
            Welcome to a searchable database of vegan, animal rights, and animal liberation songs.
          </div>
          <StatsSection />
        </div>
      </div>
    </div>
  );
}

function FeaturedSongs() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchFeaturedSongs = async () => {
      try {
        setLoading(true);
        const fetchedSongs = await spotifyService.getFeaturedSongs(4);

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

  const handleAddToPlaylist = (song) => {
    setSelectedSong(song);
    setShowAddToPlaylistModal(true);
  };

  const handleAddToPlaylistSuccess = (message) => {
    setMessage(message);
    setTimeout(() => setMessage(''), 3000);
  };
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
        {message && (
          <div className="success-message">✅ {message}</div>
        )}
      </div>
      <div className="songs-grid">
        {songs.map((song) => (
          <SongCard
            key={song.id}
            song={song}
            songId={song.id}
            onAddToPlaylist={handleAddToPlaylist}
          />
        ))}
      </div>

      {showAddToPlaylistModal && selectedSong && (
        <AddToPlaylistModal
          song={selectedSong}
          onClose={() => setShowAddToPlaylistModal(false)}
          onSuccess={handleAddToPlaylistSuccess}
        />
      )}
    </section>
  );
}

function SearchSection({ initialSearchQuery = '' }) {
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true); // Start with loading true to load initial songs
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(true); // Start with true to show results immediately
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [message, setMessage] = useState('');

  // Load initial songs when component mounts
  useEffect(() => {
    const loadInitialSongs = async () => {
      try {
        setLoading(true);
        // Load first 20 songs with default sorting (popularity)
        const results = await spotifyService.searchSongs({
          q: initialSearchQuery, // Use initial query if provided
          page: 1,
          limit: 20,
          sort_by: 'popularity'
        });
        setSearchResults(results);
        setHasSearched(true);
      } catch (err) {
        console.error('Error loading initial songs:', err);
        setError('Failed to load songs');
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    };

    loadInitialSongs();
  }, []); // Run only on mount, not when initialSearchQuery changes

  const handleResults = useCallback((results) => {
    // Store the full API response object including pagination info
    setSearchResults(results);
    setHasSearched(true);
  }, []);

  const handleLoading = useCallback((isLoading) => {
    setLoading(isLoading);
  }, []);

  const handleError = useCallback((errorMessage) => {
    setError(errorMessage);
    setHasSearched(true);
  }, []);

  const handleAddToPlaylist = (song) => {
    setSelectedSong(song);
    setShowAddToPlaylistModal(true);
  };

  const handleAddToPlaylistSuccess = (message) => {
    setMessage(message);
    setTimeout(() => setMessage(''), 3000); // Clear message after 3 seconds
  };

  return (
    <section className="search-section">
      <div className="search-section-content">
        <h2>Browse Our Vegan Music Collection</h2>
        <p>Explore our curated collection of vegan-themed songs, or use search and filters to find exactly what you're looking for.</p>

        {message && (
          <div className="success-message">✅ {message}</div>
        )}

        <SearchAndFilter
          onResults={handleResults}
          onLoading={handleLoading}
          onError={handleError}
          currentPage={currentPage}
          onPageReset={() => setCurrentPage(1)}
          initialQuery={initialSearchQuery}
        />

        {/* Song Results */}
        {hasSearched && (
          <div className="home-search-results">
            {loading && <div className="loading">🎵 Loading songs...</div>}
            {error && <div className="error-message">❌ {error}</div>}
            {!loading && !error && (!searchResults || searchResults.songs?.length === 0) && (
              <div className="no-results">No songs found. Try different filters or search terms.</div>
            )}
            {!loading && !error && searchResults && searchResults.songs?.length > 0 && (
              <div className="search-results-container">
                <h3>
                  {searchResults.filters_applied?.query ||
                   Object.values(searchResults.filters_applied || {}).some(filter =>
                     filter && (Array.isArray(filter) ? filter.length > 0 : filter !== 'popularity')
                   ) ? (
                    <>
                      {searchResults.pagination.total} songs found
                      {searchResults.filters_applied?.query && (
                        <span> for "{searchResults.filters_applied.query}"</span>
                      )}
                    </>
                  ) : (
                    <>Showing {searchResults.pagination.total} songs</>
                  )}
                </h3>

                {/* Applied filters summary */}
                {Object.values(searchResults.filters_applied || {}).some(filter =>
                  filter && (Array.isArray(filter) ? filter.length > 0 : filter !== 'popularity')
                ) && (
                  <div className="applied-filters">
                    <span>Filters applied:</span>
                    {searchResults.filters_applied.vegan_focus && searchResults.filters_applied.vegan_focus.length > 0 && (
                      <span className="applied-filter">
                        Focus: {Array.isArray(searchResults.filters_applied.vegan_focus)
                          ? searchResults.filters_applied.vegan_focus.join(', ')
                          : searchResults.filters_applied.vegan_focus}
                      </span>
                    )}
                    {searchResults.filters_applied.advocacy_style && searchResults.filters_applied.advocacy_style.length > 0 && (
                      <span className="applied-filter">
                        Style: {Array.isArray(searchResults.filters_applied.advocacy_style)
                          ? searchResults.filters_applied.advocacy_style.join(', ')
                          : searchResults.filters_applied.advocacy_style}
                      </span>
                    )}
                    {searchResults.filters_applied.genres && searchResults.filters_applied.genres.length > 0 && (
                      <span className="applied-filter">
                        Genre: {Array.isArray(searchResults.filters_applied.genres)
                          ? searchResults.filters_applied.genres.join(', ')
                          : searchResults.filters_applied.genres}
                      </span>
                    )}
                    {searchResults.filters_applied.year_range && (searchResults.filters_applied.year_range.from || searchResults.filters_applied.year_range.to) && (
                      <span className="applied-filter">
                        Year: {searchResults.filters_applied.year_range.from || '?'} - {searchResults.filters_applied.year_range.to || '?'}
                      </span>
                    )}
                  </div>
                )}

                <div className="songs-grid">
                  {searchResults.songs.map((song) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      songId={song.id}
                      onAddToPlaylist={handleAddToPlaylist}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {searchResults.pagination.pages > 1 && (
                  <PaginationControls
                    currentPage={searchResults.pagination.page}
                    totalPages={searchResults.pagination.pages}
                    onPageChange={setCurrentPage}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {showAddToPlaylistModal && selectedSong && (
          <AddToPlaylistModal
            song={selectedSong}
            onClose={() => setShowAddToPlaylistModal(false)}
            onSuccess={handleAddToPlaylistSuccess}
          />
        )}
      </div>
    </section>
  );
}

function HomePage() {
  const location = useLocation();

  // Extract search query from URL parameters
  const searchParams = new URLSearchParams(location.search);
  const initialSearchQuery = searchParams.get('q') || '';

  return (
    <>
      <HeroArea />
      <FeaturedSongs />
      <SearchSection initialSearchQuery={initialSearchQuery} />
    </>
  );
}

export default HomePage;
