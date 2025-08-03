import { useState, useEffect, useCallback } from 'react';
import { spotifyService } from '../api/spotifyService';

function ArtistSearchAndFilter({ onResults, onLoading, onError, initialQuery = '' }) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [filters, setFilters] = useState({
    genres: [],
    min_songs: 1,
    min_followers: '',
    max_followers: '',
    min_popularity: '',
    max_popularity: '',
    year_from: '',
    year_to: '',
    sort_by: 'song_count'
  });
  const [filterOptions, setFilterOptions] = useState({});
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Update search query when initialQuery changes
  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) {
      setSearchQuery(initialQuery);
    }
  }, [initialQuery]);

  // Load filter options on component mount
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const options = await spotifyService.getFilterOptions();
        setFilterOptions(options);
      } catch (error) {
        console.error('Error loading filter options:', error);
      }
    };
    loadFilterOptions();
  }, []);

  // Debounced search function
  const performSearch = useCallback(async (searchParams) => {
    try {
      setLoading(true);
      onLoading(true);
      
      const results = await spotifyService.searchArtists(searchParams);
      onResults(results);
    } catch (error) {
      console.error('Artist search error:', error);
      onError('Failed to search artists');
    } finally {
      setLoading(false);
      onLoading(false);
    }
  }, [onResults, onLoading, onError]);

  // Debounce search
  useEffect(() => {
    const searchParams = {
      q: searchQuery,
      ...filters,
      page: 1,
      limit: 20
    };

    const timeoutId = setTimeout(() => {
      performSearch(searchParams);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, filters, performSearch]);

  const handleFilterChange = (filterType, value, checked) => {
    setFilters(prev => {
      if (Array.isArray(prev[filterType])) {
        if (checked) {
          return { ...prev, [filterType]: [...prev[filterType], value] };
        } else {
          return { ...prev, [filterType]: prev[filterType].filter(v => v !== value) };
        }
      } else {
        return { ...prev, [filterType]: value };
      }
    });
  };

  const clearAllFilters = () => {
    setFilters({
      genres: [],
      min_songs: 1,
      min_followers: '',
      max_followers: '',
      min_popularity: '',
      max_popularity: '',
      year_from: '',
      year_to: '',
      sort_by: 'song_count'
    });
    setSearchQuery('');
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (searchQuery) count++;
    if (filters.genres.length > 0) count++;
    if (filters.min_songs > 1) count++;
    if (filters.min_followers !== '') count++;
    if (filters.max_followers !== '') count++;
    if (filters.min_popularity !== '') count++;
    if (filters.max_popularity !== '') count++;
    if (filters.year_from !== '') count++;
    if (filters.year_to !== '') count++;
    return count;
  };

  const FilterSection = ({ title, filterKey, options, type = 'checkbox', searchable = false }) => {
    const [searchTerm, setSearchTerm] = useState('');
    
    if (!options || options.length === 0) return null;

    const filteredOptions = searchable && searchTerm
      ? options.filter(option => 
          option.value.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : options;

    return (
      <div className="filter-section">
        <h4 className="filter-title">{title}</h4>
        
        {searchable && options.length > 10 && (
          <div className="filter-search">
            <input
              type="text"
              placeholder={`Search ${title.toLowerCase()}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="filter-search-input"
            />
          </div>
        )}
        
        <div className={`filter-options ${searchable ? 'scrollable' : ''}`}>
          {type === 'checkbox' && filteredOptions.map(option => (
            <label key={option.value} className="filter-option">
              <input
                type="checkbox"
                checked={filters[filterKey].includes(option.value)}
                onChange={(e) => handleFilterChange(filterKey, option.value, e.target.checked)}
              />
              <span className="filter-label">
                {option.value}
                <span className="filter-count">({option.count})</span>
              </span>
            </label>
          ))}
        </div>
        
        {searchable && searchTerm && filteredOptions.length === 0 && (
          <div className="no-filter-results">
            No {title.toLowerCase()} found matching "{searchTerm}"
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="search-and-filter">
      {/* Search Bar */}
      <div className="search-container">
        <input
          type="text"
          className="search-input"
          placeholder="Search artists by name, bio, or advocacy notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button 
          className={`filter-toggle ${isFiltersOpen ? 'active' : ''}`}
          onClick={() => setIsFiltersOpen(!isFiltersOpen)}
        >
          Filters {getActiveFilterCount() > 0 && (
            <span className="filter-badge">{getActiveFilterCount()}</span>
          )}
        </button>
        {getActiveFilterCount() > 0 && (
          <button className="clear-filters" onClick={clearAllFilters}>
            Clear All
          </button>
        )}
      </div>

      {/* Sort Options */}
      <div className="sort-container">
        <label>Sort by:</label>
        <select
          value={filters.sort_by}
          onChange={(e) => handleFilterChange('sort_by', e.target.value)}
        >
          <option value="song_count">Song Count</option>
          <option value="name">Name</option>
          <option value="popularity">Popularity</option>
          <option value="followers">Followers</option>
        </select>
      </div>

      {/* Filters Panel */}
      {isFiltersOpen && (
        <div className="filters-panel">
          <div className="filters-grid">
            {/* Genres Filter */}
            <FilterSection
              title="Genres"
              filterKey="genres"
              options={filterOptions.genres}
              searchable={true}
            />

            {/* Minimum Songs Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Minimum Songs</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="Min songs"
                  value={filters.min_songs}
                  onChange={(e) => handleFilterChange('min_songs', parseInt(e.target.value) || 1)}
                  min="1"
                  max="50"
                />
              </div>
            </div>

            {/* Followers Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Spotify Followers</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="Min followers"
                  value={filters.min_followers}
                  onChange={(e) => handleFilterChange('min_followers', e.target.value)}
                  min="0"
                />
                <span>to</span>
                <input
                  type="number"
                  placeholder="Max followers"
                  value={filters.max_followers}
                  onChange={(e) => handleFilterChange('max_followers', e.target.value)}
                  min="0"
                />
              </div>
            </div>

            {/* Popularity Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Spotify Popularity (0-100)</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="Min popularity"
                  value={filters.min_popularity}
                  onChange={(e) => handleFilterChange('min_popularity', e.target.value)}
                  min="0"
                  max="100"
                />
                <span>to</span>
                <input
                  type="number"
                  placeholder="Max popularity"
                  value={filters.max_popularity}
                  onChange={(e) => handleFilterChange('max_popularity', e.target.value)}
                  min="0"
                  max="100"
                />
              </div>
            </div>

            {/* Release Year Range Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Active Years (Song Releases)</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="From year"
                  value={filters.year_from}
                  onChange={(e) => handleFilterChange('year_from', e.target.value)}
                  min="1900"
                  max={new Date().getFullYear()}
                />
                <span>to</span>
                <input
                  type="number"
                  placeholder="To year"
                  value={filters.year_to}
                  onChange={(e) => handleFilterChange('year_to', e.target.value)}
                  min="1900"
                  max={new Date().getFullYear()}
                />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default ArtistSearchAndFilter;