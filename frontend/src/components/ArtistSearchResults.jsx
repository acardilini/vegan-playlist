import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ArtistSearchAndFilter from './ArtistSearchAndFilter';
import { spotifyService } from '../api/spotifyService';

function ArtistSearchResults() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentSearchParams, setCurrentSearchParams] = useState(null);

  const initialQuery = searchParams.get('q') || '';

  const handleResults = (searchResults, searchParams) => {
    setResults(searchResults);
    setError(null);
    if (searchParams) {
      setCurrentSearchParams(searchParams);
      setCurrentPage(searchParams.page || 1);
    }
  };

  const handleLoading = (isLoading) => {
    setLoading(isLoading);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setResults(null);
  };

  const handlePageChange = async (newPage) => {
    if (!currentSearchParams || newPage === currentPage) return;
    
    try {
      setLoading(true);
      const searchParams = { ...currentSearchParams, page: newPage };
      const results = await spotifyService.searchArtists(searchParams);
      setResults(results);
      setCurrentPage(newPage);
      setError(null);
    } catch (error) {
      console.error('Page change error:', error);
      setError('Failed to load page: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleArtistClick = (artistId) => {
    navigate(`/artist/${artistId}`);
  };

  // null → striped placeholder (never a blank box, never an external fallback)
  const getArtistImage = (artist) => {
    if (artist.images && artist.images.length > 0) {
      const mediumImage = artist.images.find(img => img.width >= 200 && img.width <= 400);
      return mediumImage ? mediumImage.url : artist.images[0].url;
    }
    return null;
  };

  const formatFollowers = (followers) => {
    if (!followers) return 'Unknown';
    if (followers >= 1000000) {
      return `${(followers / 1000000).toFixed(1)}M`;
    } else if (followers >= 1000) {
      return `${(followers / 1000).toFixed(1)}K`;
    }
    return followers.toString();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Artists</h1>
        <p>Discover vegan advocacy artists and their songs</p>
      </div>

      <ArtistSearchAndFilter
        onResults={handleResults}
        onLoading={handleLoading}
        onError={handleError}
        initialQuery={initialQuery}
      />

      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}

      {results && (
        <div className="search-results">
          <div className="results-header">
            <h2>
              {results.artists.length > 0 
                ? `Found ${results.pagination.total} artists` 
                : 'No artists found'
              }
            </h2>
            
            {results.filters_applied && (
              results.filters_applied.query ||
              (results.filters_applied.genres && results.filters_applied.genres.length > 0) ||
              results.filters_applied.min_songs > 1 ||
              results.filters_applied.min_followers || results.filters_applied.max_followers ||
              results.filters_applied.min_popularity || results.filters_applied.max_popularity ||
              results.filters_applied.year_range?.from || results.filters_applied.year_range?.to
            ) && (
              <div className="applied-filters">
                <span>Filters applied:</span>
                {results.filters_applied.query && (
                  <span className="applied-filter">Search: "{results.filters_applied.query}"</span>
                )}
                {results.filters_applied.genres && (
                  <span className="applied-filter">
                    Genres: {Array.isArray(results.filters_applied.genres)
                      ? results.filters_applied.genres.join(', ')
                      : results.filters_applied.genres
                    }
                  </span>
                )}
                {results.filters_applied.min_songs > 1 && (
                  <span className="applied-filter">Min songs: {results.filters_applied.min_songs}</span>
                )}
                {(results.filters_applied.min_followers || results.filters_applied.max_followers) && (
                  <span className="applied-filter">
                    Followers: {results.filters_applied.min_followers || '0'} - {results.filters_applied.max_followers || '∞'}
                  </span>
                )}
                {(results.filters_applied.min_popularity || results.filters_applied.max_popularity) && (
                  <span className="applied-filter">
                    Popularity: {results.filters_applied.min_popularity || '0'} - {results.filters_applied.max_popularity || '100'}
                  </span>
                )}
                {(results.filters_applied.year_range?.from || results.filters_applied.year_range?.to) && (
                  <span className="applied-filter">
                    Years: {results.filters_applied.year_range.from || 'Any'} - {results.filters_applied.year_range.to || 'Present'}
                  </span>
                )}
              </div>
            )}
          </div>

          {results.artists.length > 0 && (
            <div className="artists-grid">
              {results.artists.map((artist) => (
                <div
                  key={artist.id}
                  className="artist-card"
                  onClick={() => handleArtistClick(artist.id)}
                >
                  <div className="artist-image">
                    {getArtistImage(artist) ? (
                      <img
                        src={getArtistImage(artist)}
                        alt={`${artist.name} photo`}
                      />
                    ) : (
                      <span className="artist-image-placeholder">photo</span>
                    )}
                  </div>
                  
                  <div className="artist-info">
                    <h3 className="artist-name">{artist.name}</h3>
                    
                    <div className="artist-stats">
                      <span className="song-count">{artist.song_count} songs</span>
                      {artist.followers && (
                        <span className="followers">{formatFollowers(artist.followers)} followers</span>
                      )}
                      {artist.popularity > 0 && (
                        <span className="popularity">{artist.popularity}% popular</span>
                      )}
                    </div>

                    {artist.genres && artist.genres.length > 0 && (
                      <div className="artist-genres">
                        {artist.genres.slice(0, 3).map((genre, index) => (
                          <span key={index} className="genre-tag">{genre}</span>
                        ))}
                        {artist.genres.length > 3 && (
                          <span className="genre-tag more">+{artist.genres.length - 3} more</span>
                        )}
                      </div>
                    )}

                    {artist.bio && (
                      <p className="artist-bio">
                        {artist.bio.length > 150 
                          ? `${artist.bio.substring(0, 150)}...` 
                          : artist.bio
                        }
                      </p>
                    )}

                    {artist.vegan_advocacy_notes && (
                      <div className="advocacy-preview">
                        <strong>Vegan Advocacy:</strong>
                        <p>
                          {artist.vegan_advocacy_notes.length > 100
                            ? `${artist.vegan_advocacy_notes.substring(0, 100)}...`
                            : artist.vegan_advocacy_notes
                          }
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.pagination.pages > 1 && (
            <div className="pagination">
              <div className="pagination-info">
                <p>
                  Page {results.pagination.page} of {results.pagination.pages} 
                  ({results.pagination.total} total artists)
                </p>
              </div>
              
              <div className="pagination-controls">
                <button 
                  className="pagination-btn" 
                  onClick={() => handlePageChange(1)} 
                  disabled={results.pagination.page === 1}
                >
                  &laquo; First
                </button>
                
                <button 
                  className="pagination-btn" 
                  onClick={() => handlePageChange(results.pagination.page - 1)} 
                  disabled={results.pagination.page === 1}
                >
                  &lsaquo; Previous
                </button>
                
                <span className="page-numbers">
                  {(() => {
                    const current = results.pagination.page;
                    const total = results.pagination.pages;
                    const pages = [];
                    
                    let start = Math.max(1, current - 2);
                    let end = Math.min(total, current + 2);
                    
                    if (end - start < 4) {
                      if (start === 1) {
                        end = Math.min(total, start + 4);
                      } else {
                        start = Math.max(1, end - 4);
                      }
                    }
                    
                    for (let i = start; i <= end; i++) {
                      pages.push(
                        <button
                          key={i}
                          className={`pagination-btn ${i === current ? 'active' : ''}`}
                          onClick={() => handlePageChange(i)}
                        >
                          {i}
                        </button>
                      );
                    }
                    
                    return pages;
                  })()}
                </span>
                
                <button 
                  className="pagination-btn" 
                  onClick={() => handlePageChange(results.pagination.page + 1)} 
                  disabled={results.pagination.page === results.pagination.pages}
                >
                  Next &rsaquo;
                </button>
                
                <button 
                  className="pagination-btn" 
                  onClick={() => handlePageChange(results.pagination.pages)} 
                  disabled={results.pagination.page === results.pagination.pages}
                >
                  Last &raquo;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && !results && (
        <div className="loading-message">
          <p>Searching for artists…</p>
        </div>
      )}
    </div>
  );
}

export default ArtistSearchResults;