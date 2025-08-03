import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ArtistSearchAndFilter from './ArtistSearchAndFilter';
import { spotifyService } from '../api/spotifyService';

function ArtistSearchResults() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const initialQuery = searchParams.get('q') || '';

  const handleResults = (searchResults) => {
    setResults(searchResults);
    setError(null);
  };

  const handleLoading = (isLoading) => {
    setLoading(isLoading);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setResults(null);
  };

  const handleArtistClick = (artistId) => {
    navigate(`/artist/${artistId}`);
  };

  const getArtistImage = (artist) => {
    if (artist.images && artist.images.length > 0) {
      const mediumImage = artist.images.find(img => img.width >= 200 && img.width <= 400);
      return mediumImage ? mediumImage.url : artist.images[0].url;
    }
    return "https://via.placeholder.com/200x200/1DB954/000000?text=♪";
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
            
            {results.filters_applied && Object.values(results.filters_applied).some(v => v && v !== 'song_count') && (
              <div className="applied-filters">
                <h3>Applied Filters:</h3>
                <div className="filter-tags">
                  {results.filters_applied.query && (
                    <span className="filter-tag">Search: "{results.filters_applied.query}"</span>
                  )}
                  {results.filters_applied.genres && (
                    <span className="filter-tag">Genres: {results.filters_applied.genres.join(', ')}</span>
                  )}
                  {results.filters_applied.min_songs > 1 && (
                    <span className="filter-tag">Min Songs: {results.filters_applied.min_songs}</span>
                  )}
                  {(results.filters_applied.min_followers || results.filters_applied.max_followers) && (
                    <span className="filter-tag">
                      Followers: {results.filters_applied.min_followers || '0'} - {results.filters_applied.max_followers || '∞'}
                    </span>
                  )}
                  {(results.filters_applied.min_popularity || results.filters_applied.max_popularity) && (
                    <span className="filter-tag">
                      Popularity: {results.filters_applied.min_popularity || '0'} - {results.filters_applied.max_popularity || '100'}
                    </span>
                  )}
                  {(results.filters_applied.year_range?.from || results.filters_applied.year_range?.to) && (
                    <span className="filter-tag">
                      Years: {results.filters_applied.year_range.from || 'Any'} - {results.filters_applied.year_range.to || 'Present'}
                    </span>
                  )}
                </div>
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
                    <img
                      src={getArtistImage(artist)}
                      alt={`${artist.name} photo`}
                    />
                    <div className="artist-overlay">
                      <div className="view-artist-button">
                        View Artist
                      </div>
                    </div>
                  </div>
                  
                  <div className="artist-info">
                    <h3 className="artist-name">{artist.name}</h3>
                    
                    <div className="artist-stats">
                      <span className="song-count">{artist.song_count} songs</span>
                      {artist.followers && (
                        <span className="followers">{formatFollowers(artist.followers)} followers</span>
                      )}
                      {artist.popularity > 0 && (
                        <span className="popularity">{artist.popularity}% Spotify popularity</span>
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

          {/* Pagination would go here if needed */}
          {results.pagination.pages > 1 && (
            <div className="pagination">
              <p>
                Page {results.pagination.page} of {results.pagination.pages} 
                ({results.pagination.total} total artists)
              </p>
            </div>
          )}
        </div>
      )}

      {loading && !results && (
        <div className="loading-message">
          <p>🎵 Searching for artists...</p>
        </div>
      )}
    </div>
  );
}

export default ArtistSearchResults;