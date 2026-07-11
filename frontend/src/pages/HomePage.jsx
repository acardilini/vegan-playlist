import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';
import SearchAndFilter from '../components/SearchAndFilter';
import SongCard from '../components/SongCard';
import PaginationControls from '../components/PaginationControls';
import { roundedStat } from '../utils/stats';

function HeroArea() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    spotifyService.getStats()
      .then(setStats)
      .catch((err) => console.error('Error loading stats:', err));
  }, []);

  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>A searchable database of vegan &amp; animal-liberation songs</h1>
        <p>
          {stats ? `${roundedStat(stats.songs)} songs` : 'Songs'}, tagged by
          theme, genre, artist, and date.
        </p>
      </div>
      <div className="hero-stats">
        <div className="stat-badge">
          <span className="stat-value">{roundedStat(stats?.songs)}</span>
          <span className="stat-label">Songs</span>
        </div>
        <div className="stat-badge">
          <span className="stat-value">{roundedStat(stats?.artists)}</span>
          <span className="stat-label">Artists</span>
        </div>
        <div className="stat-badge">
          <span className="stat-value">40+</span>
          <span className="stat-label">Hours</span>
        </div>
      </div>
    </section>
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
        const fetchedSongs = await spotifyService.getFeaturedSongs(4);
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

  if (loading) {
    return (
      <section className="featured-songs">
        <div className="section-header">
          <h2>Featured songs</h2>
        </div>
        <div className="loading-placeholder">
          <p>Loading songs…</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="featured-songs">
        <div className="section-header">
          <h2>Featured songs</h2>
        </div>
        <div className="error-message">
          <p>{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="featured-songs">
      <div className="section-header">
        <h2>Featured songs</h2>
      </div>
      <div className="songs-grid">
        {songs.map((song) => (
          <SongCard
            key={song.id}
            song={song}
            songId={song.id}
          />
        ))}
      </div>
    </section>
  );
}

// True only when a filter value is genuinely active (empty arrays, empty
// strings, default sort, and blank year_range objects don't count)
function isActiveFilterValue(value) {
  if (!value || value === 'popularity') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(Boolean);
  return true;
}

function SearchSection({ initialSearchQuery = '' }) {
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true); // Start with loading true to load initial songs
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(true); // Start with true to show results immediately
  const [currentPage, setCurrentPage] = useState(1);

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

  return (
    <section className="search-section">
      <div className="search-section-content">
        <div className="section-header centered">
          <h2>Browse the collection</h2>
          <p>Search by title, artist, or use filters to narrow by genre and theme.</p>
        </div>

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
            {loading && <div className="loading">Loading songs…</div>}
            {error && <div className="error-message">{error}</div>}
            {!loading && !error && (!searchResults || searchResults.songs?.length === 0) && (
              <div className="no-results">No songs found. Try different filters or search terms.</div>
            )}
            {!loading && !error && searchResults && searchResults.songs?.length > 0 && (
              <div className="search-results-container">
                <h3>
                  {searchResults.filters_applied?.query ||
                   Object.values(searchResults.filters_applied || {}).some(isActiveFilterValue) ? (
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
                {Object.values(searchResults.filters_applied || {}).some(isActiveFilterValue) && (
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
