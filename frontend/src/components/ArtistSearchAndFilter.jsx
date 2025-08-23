import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { spotifyService } from '../api/spotifyService';

// Simple Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="filter-section" style={{ color: 'red', padding: '10px' }}>
          <h4>Genre Filter Error</h4>
          <p>Unable to load genre filters. Please refresh the page.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

function ArtistSearchAndFilter({ onResults, onLoading, onError, initialQuery = '' }) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [filters, setFilters] = useState({
    genres: [],
    parent_genres: [],
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
  const [expandedParents, setExpandedParents] = useState(new Set());
  const [genreSearchTerm, setGenreSearchTerm] = useState('');

  // Genre hierarchy mapping (moved to top level to prevent recreation)
  const GENRE_HIERARCHY = useMemo(() => ({
    'metal': ['metalcore', 'deathcore', 'mathcore', 'groove metal', 'death metal', 'black metal', 'thrash metal', 'doom metal', 'progressive metal', 'nu metal', 'melodic death metal', 'sludge metal', 'stoner metal', 'grindcore', 'heavy metal', 'alternative metal', 'industrial metal', 'speed metal', 'rap metal', 'djent'],
    'rock': ['blues rock', 'hard rock', 'alternative rock', 'indie rock', 'classic rock', 'progressive rock', 'psychedelic rock', 'garage rock', 'gothic rock', 'industrial rock', 'art rock', 'acid rock', 'grunge', 'post-grunge', 'britpop', 'madchester', 'krautrock', 'noise rock', 'neo-psychedelic', 'folk rock', 'celtic rock', 'brazilian rock'],
    'punk': ['punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk'],
    'hardcore': ['hardcore', 'melodic hardcore', 'post-hardcore', 'crossover hardcore', 'screamo', 'midwest emo'],
    'folk': ['folk punk', 'anti-folk', 'indie folk', 'folk rock', 'acoustic folk', 'contemporary folk', 'folk', 'traditional folk', 'americana', 'celtic', 'singer-songwriter', 'country blues'],
    'blues': ['blues', 'blues rock', 'electric blues', 'acoustic blues', 'delta blues'],
    'pop': ['pop', 'indie pop', 'electropop', 'synthpop', 'power pop', 'dream pop', 'jangle pop', 'swedish pop', 'german pop', 'new wave', 'pop soul'],
    'electronic': ['electronic', 'ambient', 'techno', 'house', 'drum and bass', 'dubstep', 'edm', 'industrial', 'ebm', 'darkwave', 'coldwave', 'cold wave', 'downtempo', 'trip hop', 'glitch', 'witch house', 'footwork', 'bassline', 'riddim', 'minimalism', 'neoclassical'],
    'hip-hop': ['hip hop', 'rap', 'conscious hip hop', 'alternative hip hop', 'underground hip hop', 'east coast hip hop', 'experimental hip hop', 'hardcore hip hop', 'old school hip hop', 'gangster rap', 'horrorcore', 'grime', 'uk grime'],
    'reggae': ['reggae', 'ska', 'dub', 'roots reggae', 'nz reggae', 'lovers rock', 'ragga', 'dancehall', 'rocksteady'],
    'jazz': ['free jazz', 'hard bop'],
    'soul': ['philly soul', 'pop soul', 'gospel', 'gospel r&b'],
    'other': ['christian', 'worship', 'children\'s music', 'musicals', 'soundtrack', 'comedy', 'spoken word', 'lullaby', 'deathrock', 'avant-garde', 'experimental', 'aor']
  }), []);

  // Update search query when initialQuery changes
  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) {
      setSearchQuery(initialQuery);
    }
  }, [initialQuery, searchQuery]);

  // Load filter options on component mount
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const options = await spotifyService.getArtistFilterOptions();
        setFilterOptions(options);
      } catch (error) {
        console.error('Error loading artist filter options:', error);
        // Set empty options to prevent crashes
        setFilterOptions({ parent_genres: [], genres: [], subgenres: [] });
      }
    };
    loadFilterOptions();
  }, []);

  // Stable performSearch function - removed from dependencies to prevent infinite loops
  const performSearch = useCallback(async (searchParams) => {
    try {
      setLoading(true);
      onLoading(true);
      
      const results = await spotifyService.searchArtists(searchParams);
      onResults(results, searchParams);
    } catch (error) {
      console.error('Artist search error:', error);
      onError('Failed to search artists: ' + error.message);
    } finally {
      setLoading(false);
      onLoading(false);
    }
  }, [onResults, onLoading, onError]);

  // Debounce search - REMOVED performSearch from dependencies to fix infinite re-renders
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
  }, [searchQuery, filters]); // performSearch removed from dependencies

  // Stable filter change handler
  const handleFilterChange = useCallback((filterType, value, checked) => {
    setFilters(prev => {
      if (Array.isArray(prev[filterType])) {
        if (checked) {
          // Prevent duplicates
          if (prev[filterType].includes(value)) return prev;
          return { ...prev, [filterType]: [...prev[filterType], value] };
        } else {
          return { ...prev, [filterType]: prev[filterType].filter(v => v !== value) };
        }
      } else {
        return { ...prev, [filterType]: value };
      }
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({
      genres: [],
      parent_genres: [],
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
  }, []);

  // Memoized active filter calculations to prevent unnecessary re-renders
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery) count++;
    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'sort_by') return;
      if (Array.isArray(value) && value.length > 0) count++;
      if (!Array.isArray(value) && value !== '' && value !== 1) count++;
    });
    return count;
  }, [searchQuery, filters]);

  const activeFilters = useMemo(() => {
    const activeFilters = [];
    
    // Add search query as filter
    if (searchQuery.trim()) {
      activeFilters.push({
        type: 'search',
        key: 'q',
        value: searchQuery,
        label: `Search: "${searchQuery}"`,
        displayValue: searchQuery
      });
    }
    
    // Add array filters
    const arrayFilterLabels = {
      genres: 'Genre',
      parent_genres: 'Genre Group'
    };
    
    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'sort_by') return;
      
      if (Array.isArray(value) && value.length > 0) {
        value.forEach(item => {
          activeFilters.push({
            type: 'filter',
            key,
            value: item,
            label: arrayFilterLabels[key] || key,
            displayValue: item.replace(/_/g, ' ')
          });
        });
      } else if (!Array.isArray(value) && value !== '' && (key !== 'min_songs' || value > 1)) {
        // Handle non-array filters
        let label, displayValue;
        switch (key) {
          case 'min_songs':
            label = 'Min Songs';
            displayValue = `${value}+`;
            break;
          case 'min_followers':
            label = 'Min Followers';
            displayValue = value.toLocaleString();
            break;
          case 'max_followers':
            label = 'Max Followers';
            displayValue = value.toLocaleString();
            break;
          case 'min_popularity':
            label = 'Min Popularity';
            displayValue = value;
            break;
          case 'max_popularity':
            label = 'Max Popularity';
            displayValue = value;
            break;
          case 'year_from':
            label = 'From Year';
            displayValue = value;
            break;
          case 'year_to':
            label = 'To Year';
            displayValue = value;
            break;
          default:
            label = key.replace(/_/g, ' ');
            displayValue = value;
        }
        
        activeFilters.push({
          type: 'filter',
          key,
          value,
          label,
          displayValue
        });
      }
    });
    
    return activeFilters;
  }, [searchQuery, filters]);

  const removeFilter = useCallback((filterToRemove) => {
    if (filterToRemove.type === 'search') {
      setSearchQuery('');
    } else if (filterToRemove.type === 'filter') {
      setFilters(prev => {
        const newFilters = { ...prev };
        
        if (Array.isArray(newFilters[filterToRemove.key])) {
          newFilters[filterToRemove.key] = newFilters[filterToRemove.key].filter(
            item => item !== filterToRemove.value
          );
        } else {
          if (filterToRemove.key === 'min_songs') {
            newFilters[filterToRemove.key] = 1;
          } else {
            newFilters[filterToRemove.key] = '';
          }
        }
        
        return newFilters;
      });
    }
  }, []);

  // Stable expansion toggle
  const toggleParentExpansion = useCallback((parentGenre) => {
    console.log('Toggling expansion for:', parentGenre);
    setExpandedParents(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(parentGenre)) {
        newExpanded.delete(parentGenre);
      } else {
        newExpanded.add(parentGenre);
      }
      return newExpanded;
    });
  }, []);

  // Stable parent genre change handler
  const handleParentGenreChange = useCallback((parentGenre, checked) => {
    console.log('Parent genre change:', parentGenre, checked);
    try {
      // Get all subgenres for this parent
      const subgenres = GENRE_HIERARCHY[parentGenre] || [];
      
      // Use a single state update to avoid race conditions
      setFilters(prev => {
        const newFilters = { ...prev };
        
        if (checked) {
          // Add parent genre if not already selected
          if (!newFilters.parent_genres.includes(parentGenre)) {
            newFilters.parent_genres = [...newFilters.parent_genres, parentGenre];
          }
          // Add all subgenres that aren't already selected
          const newSubgenres = subgenres.filter(subgenre => !newFilters.genres.includes(subgenre));
          if (newSubgenres.length > 0) {
            newFilters.genres = [...newFilters.genres, ...newSubgenres];
          }
        } else {
          // Remove parent genre
          newFilters.parent_genres = newFilters.parent_genres.filter(g => g !== parentGenre);
          // Remove all subgenres that belong to this parent
          newFilters.genres = newFilters.genres.filter(g => !subgenres.includes(g));
        }
        
        return newFilters;
      });
    } catch (error) {
      console.error('Error in handleParentGenreChange:', error);
      onError('Error updating parent genre selection');
    }
  }, [GENRE_HIERARCHY, onError]);

  // FIXED: Stable subgenre change handler with extensive logging and error handling
  const handleSubgenreChange = useCallback((subgenre, checked) => {
    console.log('=== SUBGENRE CHANGE START ===');
    console.log('Subgenre:', subgenre);
    console.log('Checked:', checked);
    
    try {
      // Validate inputs
      if (!subgenre || typeof subgenre !== 'string') {
        console.error('Invalid subgenre:', subgenre);
        onError('Invalid subgenre selection');
        return;
      }

      if (!GENRE_HIERARCHY || typeof GENRE_HIERARCHY !== 'object') {
        console.error('Invalid GENRE_HIERARCHY:', GENRE_HIERARCHY);
        onError('Genre hierarchy not loaded');
        return;
      }

      // Find parent genre for this subgenre with extensive logging
      console.log('Searching for parent genre...');
      const parentGenre = Object.keys(GENRE_HIERARCHY).find(parent => {
        const subgenres = GENRE_HIERARCHY[parent];
        console.log(`Checking parent ${parent}:`, subgenres);
        return Array.isArray(subgenres) && subgenres.includes(subgenre);
      });
      
      console.log('Found parent genre:', parentGenre);
      
      // Use a single state update with functional updates
      setFilters(prev => {
        console.log('Current filters.genres:', prev.genres);
        console.log('Current filters.parent_genres:', prev.parent_genres);
        console.log('Previous filters state:', prev);
        
        // Validate previous state
        if (!prev || !Array.isArray(prev.genres) || !Array.isArray(prev.parent_genres)) {
          console.error('Invalid previous state:', prev);
          return prev; // Don't update if state is invalid
        }

        const newFilters = { ...prev };
        
        // Update the subgenre selection
        if (checked) {
          if (!newFilters.genres.includes(subgenre)) {
            newFilters.genres = [...newFilters.genres, subgenre];
            console.log('Added subgenre, new genres:', newFilters.genres);
          }
        } else {
          newFilters.genres = newFilters.genres.filter(g => g !== subgenre);
          console.log('Removed subgenre, new genres:', newFilters.genres);
        }
        
        // Update parent genre status if we found one
        if (parentGenre) {
          const allSubgenres = GENRE_HIERARCHY[parentGenre] || [];
          const selectedSubgenres = newFilters.genres.filter(g => allSubgenres.includes(g));
          
          console.log('All subgenres for parent:', allSubgenres);
          console.log('Currently selected subgenres:', selectedSubgenres);
          
          if (checked && selectedSubgenres.length === allSubgenres.length) {
            // All subgenres are now selected, select the parent
            if (!newFilters.parent_genres.includes(parentGenre)) {
              newFilters.parent_genres = [...newFilters.parent_genres, parentGenre];
              console.log('Added parent genre, new parent_genres:', newFilters.parent_genres);
            }
          } else if (!checked || selectedSubgenres.length < allSubgenres.length) {
            // Not all subgenres selected, uncheck the parent
            newFilters.parent_genres = newFilters.parent_genres.filter(g => g !== parentGenre);
            console.log('Removed parent genre, new parent_genres:', newFilters.parent_genres);
          }
        }
        
        console.log('Final new filters:', newFilters);
        console.log('=== SUBGENRE CHANGE END ===');
        
        // Final validation before returning
        if (!newFilters || !Array.isArray(newFilters.genres) || !Array.isArray(newFilters.parent_genres)) {
          console.error('CRITICAL: Final filter state is invalid, keeping previous state');
          return prev;
        }
        
        return newFilters;
      });
    } catch (error) {
      console.error('=== ERROR in handleSubgenreChange ===');
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      console.error('Subgenre:', subgenre);
      console.error('Checked:', checked);
      console.error('GENRE_HIERARCHY:', GENRE_HIERARCHY);
      console.error('Current filters:', filters);
      onError(`Error updating subgenre selection: ${error.message}`);
    }
  }, [GENRE_HIERARCHY, onError]);

  // Memoized count functions
  const getParentGenreCount = useCallback((parentGenre) => {
    try {
      const parentOption = filterOptions.parent_genres?.find(p => p.value === parentGenre);
      return parentOption?.count || 0;
    } catch (error) {
      console.error('Error in getParentGenreCount:', error);
      return 0;
    }
  }, [filterOptions.parent_genres]);

  const getSubgenreCount = useCallback((subgenre) => {
    try {
      const subgenreOption = filterOptions.subgenres?.find(s => s.value === subgenre);
      return subgenreOption?.count || 0;
    } catch (error) {
      console.error('Error in getSubgenreCount:', error);
      return 0;
    }
  }, [filterOptions.subgenres]);

  // Memoized selection state functions
  const isParentSelected = useCallback((parentGenre) => {
    try {
      return Array.isArray(filters.parent_genres) && filters.parent_genres.includes(parentGenre);
    } catch (error) {
      console.error('Error in isParentSelected:', error);
      return false;
    }
  }, [filters.parent_genres]);

  const isSubgenreSelected = useCallback((subgenre) => {
    try {
      return Array.isArray(filters.genres) && filters.genres.includes(subgenre);
    } catch (error) {
      console.error('Error in isSubgenreSelected:', error);
      return false;
    }
  }, [filters.genres]);

  // FIXED: Convert to proper React component instead of memoized JSX
  const HierarchicalGenreFilter = () => {
    console.log('Rendering HierarchicalGenreFilter');
    
    try {
      // Get available parent genres from backend data or use defaults
      const parentGenres = filterOptions.parent_genres || 
        Object.keys(GENRE_HIERARCHY).map(genre => ({ value: genre, count: 0 }));

      console.log('Parent genres:', parentGenres);

      // Filter parent genres based on search
      const filteredParentGenres = parentGenres.filter(parent => {
        if (!genreSearchTerm) return true;
        
        // Search in parent genre name
        if (parent.value.toLowerCase().includes(genreSearchTerm.toLowerCase())) {
          return true;
        }
        
        // Search in subgenres
        const subgenres = GENRE_HIERARCHY[parent.value] || [];
        return subgenres.some(sub => 
          sub.toLowerCase().includes(genreSearchTerm.toLowerCase())
        );
      });

      return (
        <div className="filter-section hierarchical-genre-filter">
          <h4 className="filter-title">Genres</h4>
          
          <div className="filter-search">
            <input
              type="text"
              placeholder="Search genres..."
              value={genreSearchTerm}
              onChange={(e) => setGenreSearchTerm(e.target.value)}
              className="filter-search-input"
            />
          </div>

          <div className="filter-options scrollable">
            {filteredParentGenres.map(parentOption => {
              const parentGenre = parentOption.value;
              const subgenres = GENRE_HIERARCHY[parentGenre] || [];
              const isExpanded = expandedParents.has(parentGenre);

              // Filter subgenres based on search
              const filteredSubgenres = genreSearchTerm ?
                subgenres.filter(sub => sub.toLowerCase().includes(genreSearchTerm.toLowerCase())) :
                subgenres;

              return (
                <div key={parentGenre} className="genre-hierarchy-item">
                  <div className="parent-genre-row">
                    <button 
                      className="expand-toggle"
                      onClick={() => toggleParentExpansion(parentGenre)}
                      type="button"
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                    
                    <label className="filter-option parent-genre">
                      <input
                        type="checkbox"
                        checked={isParentSelected(parentGenre)}
                        onChange={(e) => handleParentGenreChange(parentGenre, e.target.checked)}
                      />
                      <span className="filter-label">
                        <strong>{parentGenre}</strong>
                        <span className="filter-count">({getParentGenreCount(parentGenre)})</span>
                      </span>
                    </label>
                  </div>

                  {isExpanded && (
                    <div className="subgenres-container">
                      {filteredSubgenres.map(subgenre => (
                        <label key={subgenre} className="filter-option subgenre">
                          <input
                            type="checkbox"
                            checked={isSubgenreSelected(subgenre)}
                            onChange={(e) => {
                              console.log('Subgenre checkbox clicked:', subgenre, e.target.checked);
                              handleSubgenreChange(subgenre, e.target.checked);
                            }}
                          />
                          <span className="filter-label">
                            {subgenre}
                            <span className="filter-count">({getSubgenreCount(subgenre)})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {genreSearchTerm && filteredParentGenres.length === 0 && (
            <div className="no-filter-results">
              No genres found matching "{genreSearchTerm}"
            </div>
          )}
        </div>
      );
    } catch (error) {
      console.error('Error in HierarchicalGenreFilter:', error);
      return (
        <div className="filter-section">
          <h4 className="filter-title">Genres</h4>
          <div className="no-filter-results" style={{color: 'red'}}>
            Error loading genres: {error.message}
          </div>
        </div>
      );
    }
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
          Filters {activeFilterCount > 0 && (
            <span className="filter-badge">{activeFilterCount}</span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button className="clear-filters" onClick={clearAllFilters}>
            Clear All
          </button>
        )}
      </div>

      {/* Active Filter Chips */}
      {activeFilters.length > 0 && (
        <div className="active-filters-container">
          <div className="active-filters-chips">
            {activeFilters.map((filter, index) => (
              <div key={`${filter.key}-${filter.value}-${index}`} className="filter-chip">
                <span className="filter-chip-label">{filter.label}:</span>
                <span className="filter-chip-value">{filter.displayValue}</span>
                <button 
                  className="filter-chip-remove"
                  onClick={() => removeFilter(filter)}
                  title={`Remove ${filter.label}: ${filter.displayValue}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
            {/* FIXED: Use as component instead of memoized JSX with error boundary */}
            <ErrorBoundary>
              <HierarchicalGenreFilter />
            </ErrorBoundary>

            {/* Minimum Songs Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Min Songs</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="1"
                  value={filters.min_songs}
                  onChange={(e) => handleFilterChange('min_songs', parseInt(e.target.value) || 1)}
                  min="1"
                  max="50"
                />
              </div>
            </div>

            {/* Followers Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Followers</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.min_followers}
                  onChange={(e) => handleFilterChange('min_followers', e.target.value)}
                  min="0"
                />
                <span>to</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.max_followers}
                  onChange={(e) => handleFilterChange('max_followers', e.target.value)}
                  min="0"
                />
              </div>
            </div>

            {/* Popularity Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Popularity</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="0"
                  value={filters.min_popularity}
                  onChange={(e) => handleFilterChange('min_popularity', e.target.value)}
                  min="0"
                  max="100"
                />
                <span>to</span>
                <input
                  type="number"
                  placeholder="100"
                  value={filters.max_popularity}
                  onChange={(e) => handleFilterChange('max_popularity', e.target.value)}
                  min="0"
                  max="100"
                />
              </div>
            </div>

            {/* Release Year Range Filter */}
            <div className="filter-section">
              <h4 className="filter-title">Active Years</h4>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="From"
                  value={filters.year_from}
                  onChange={(e) => handleFilterChange('year_from', e.target.value)}
                  min="1900"
                  max={new Date().getFullYear()}
                />
                <span>to</span>
                <input
                  type="number"
                  placeholder="To"
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

      {loading && (
        <div className="search-loading">
          Searching artists...
        </div>
      )}
    </div>
  );
}

export default ArtistSearchAndFilter;