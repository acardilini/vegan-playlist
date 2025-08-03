import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import SearchAndFilter from './SearchAndFilter';

function SearchResults() {
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [initialQuery, setInitialQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  // Extract query parameter from URL on component mount
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const queryParam = urlParams.get('q');
    if (queryParam) {
      setInitialQuery(queryParam);
    }
  }, [location.search]);

  const formatDuration = (durationMs) => {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getArtwork = (song) => {
    if (song.album_images && song.album_images.length > 0) {
      const mediumImage = song.album_images.find(img => img.width === 300);
      return mediumImage ? mediumImage.url : song.album_images[0].url;
    }
    return "https://via.placeholder.com/150x150/1DB954/000000?text=♪";
  };

  const handleSongClick = (songId) => {
    navigate(`/song/${songId}`);
  };

  const handlePlayClick = (e, song) => {
    e.stopPropagation();
    alert(`Playing "${song.title}" (functionality coming soon!)`);
  };

  const ResultsGrid = ({ songs }) => (
    <div className="search-results-grid">
      {songs.map((song) => (
        <div key={song.id} className="search-result-card" onClick={() => handleSongClick(song.id)}>
          <div className="result-artwork">
            <div className="play-button" onClick={(e) => handlePlayClick(e, song)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <img 
              src={getArtwork(song)}
              alt={`${song.title} artwork`}
            />
          </div>
          
          <div className="result-info">
            <h3 className="result-title">{song.title}</h3>
            <p className="result-artist">
              {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
            </p>
            
            {song.album_name && (
              <p className="result-album">{song.album_name}</p>
            )}
            
            {/* Category badges */}
            <div className="result-categories">
              {song.vegan_focus && song.vegan_focus.map(focus => (
                <span key={focus} className="category-badge vegan-focus">{focus}</span>
              ))}
              {song.advocacy_style && song.advocacy_style.map(style => (
                <span key={style} className="category-badge advocacy-style">{style}</span>
              ))}
            </div>
            
            {/* Audio features */}
            <div className="result-features">
              {song.energy && (
                <span className="feature-indicator">
                  ⚡ {Math.round(song.energy * 100)}%
                </span>
              )}
              {song.danceability && (
                <span className="feature-indicator">
                  💃 {Math.round(song.danceability * 100)}%
                </span>
              )}
              {song.valence && (
                <span className="feature-indicator">
                  😊 {Math.round(song.valence * 100)}%
                </span>
              )}
            </div>
            
            <div className="result-meta">
              <span className="result-year">
                {song.release_date ? new Date(song.release_date).getFullYear() : 'Unknown'}
              </span>
              <span className="result-duration">{formatDuration(song.duration_ms)}</span>
              {song.popularity > 0 && (
                <span className="result-popularity">🔥 {song.popularity}%</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="search-page">
      <div className="search-header">
        <h1>Search & Discover</h1>
        <p>Find vegan-themed music by title, artist, advocacy style, or theme</p>
      </div>

      <SearchAndFilter
        onResults={setSearchResults}
        onLoading={setLoading}
        onError={setError}
        initialQuery={initialQuery}
      />

      {error && (
        <div className="search-error">
          <p>❌ {error}</p>
        </div>
      )}

      {searchResults && (
        <div className="search-results">
          <div className="results-header">
            <h2>
              {searchResults.pagination.total} songs found
              {searchResults.filters_applied.query && (
                <span> for "{searchResults.filters_applied.query}"</span>
              )}
            </h2>
            
            {/* Applied filters summary */}
            {Object.values(searchResults.filters_applied).some(filter => 
              filter && (Array.isArray(filter) ? filter.length > 0 : filter !== 'popularity')
            ) && (
              <div className="applied-filters">
                <span>Filters applied:</span>
                {searchResults.filters_applied.vegan_focus && searchResults.filters_applied.vegan_focus.length > 0 && (
                  <span className="applied-filter">
                    Focus: {searchResults.filters_applied.vegan_focus.join(', ')}
                  </span>
                )}
                {searchResults.filters_applied.advocacy_style && searchResults.filters_applied.advocacy_style.length > 0 && (
                  <span className="applied-filter">
                    Style: {searchResults.filters_applied.advocacy_style.join(', ')}
                  </span>
                )}
                {searchResults.filters_applied.genres && searchResults.filters_applied.genres.length > 0 && (
                  <span className="applied-filter">
                    Genre: {searchResults.filters_applied.genres.join(', ')}
                  </span>
                )}
                {searchResults.filters_applied.year_range && (searchResults.filters_applied.year_range.from || searchResults.filters_applied.year_range.to) && (
                  <span className="applied-filter">
                    Year: {searchResults.filters_applied.year_range.from || '?'} - {searchResults.filters_applied.year_range.to || '?'}
                  </span>
                )}
              </div>
            )}
          </div>

          {searchResults.songs.length > 0 ? (
            <>
              <ResultsGrid songs={searchResults.songs} />
              
              {/* Pagination */}
              {searchResults.pagination.pages > 1 && (
                <div className="pagination">
                  <span>
                    Page {searchResults.pagination.page} of {searchResults.pagination.pages}
                  </span>
                  {/* TODO: Add pagination controls */}
                </div>
              )}
            </>
          ) : (
            <div className="no-results">
              <h3>No songs found</h3>
              <p>Try adjusting your search terms or filters to find more results.</p>
            </div>
          )}
        </div>
      )}

      {loading && !searchResults && (
        <div className="initial-loading">
          <p>🎵 Loading initial results...</p>
        </div>
      )}
    </div>
  );
}

export default SearchResults;