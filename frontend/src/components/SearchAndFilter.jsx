import { useState, useEffect, useCallback } from 'react';
import { spotifyService } from '../api/spotifyService';

function SearchAndFilter({ onResults, onLoading, onError, initialQuery = '' }) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [filters, setFilters] = useState({
    vegan_focus: [],
    animal_category: [],
    advocacy_style: [],
    advocacy_issues: [],
    lyrical_explicitness: [],
    genres: [],
    parent_genres: [],
    year_from: '',
    year_to: '',
    energy_min: '',
    energy_max: '',
    danceability_min: '',
    danceability_max: '',
    valence_min: '',
    valence_max: '',
    sort_by: 'popularity'
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
        console.log('Loaded filter options:', options);
        console.log('Number of genres:', options.genres?.length);
        
        // Add hierarchical genre data with FIXED counts (parent = sum of subgenres)
        if (!options.parent_genres || !options.subgenres) {
          options.parent_genres = [
            { value: 'metal', count: 169 },
            { value: 'hardcore', count: 134 },
            { value: 'punk', count: 108 }, // FIXED: Was 95, now 108 (sum of subgenres)
            { value: 'blues', count: 27 },
            { value: 'folk', count: 23 },
            { value: 'reggae', count: 23 },
            { value: 'electronic', count: 15 },
            { value: 'hip-hop', count: 11 },
            { value: 'other', count: 10 },
            { value: 'rock', count: 10 },
            { value: 'pop', count: 7 },
            { value: 'jazz', count: 2 },
            { value: 'soul', count: 2 }
          ];
          
          options.subgenres = options.genres || [];
        }
        
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
      
      const results = await spotifyService.searchSongs(searchParams);
      onResults(results);
    } catch (error) {
      console.error('Search error:', error);
      onError('Failed to search songs');
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
      vegan_focus: [],
      animal_category: [],
      advocacy_style: [],
      advocacy_issues: [],
      lyrical_explicitness: [],
      genres: [],
      parent_genres: [],
      year_from: '',
      year_to: '',
      energy_min: '',
      energy_max: '',
      danceability_min: '',
      danceability_max: '',
      valence_min: '',
      valence_max: '',
      sort_by: 'popularity'
    });
    setSearchQuery('');
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (searchQuery) count++;
    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'sort_by') return;
      if (Array.isArray(value) && value.length > 0) count++;
      if (!Array.isArray(value) && value !== '') count++;
    });
    return count;
  };

  // Genre hierarchy mapping (matches backend)
  const GENRE_HIERARCHY = {
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
  };

  const HierarchicalGenreFilter = () => {
    const [expandedParents, setExpandedParents] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');

    const toggleParentExpansion = (parentGenre) => {
      const newExpanded = new Set(expandedParents);
      if (newExpanded.has(parentGenre)) {
        newExpanded.delete(parentGenre);
      } else {
        newExpanded.add(parentGenre);
      }
      setExpandedParents(newExpanded);
    };

    const handleParentGenreChange = (parentGenre, checked) => {
      // Get all subgenres for this parent
      const subgenres = GENRE_HIERARCHY[parentGenre] || [];
      
      if (checked) {
        // Add parent genre
        handleFilterChange('parent_genres', parentGenre, true);
        // Add all subgenres
        subgenres.forEach(subgenre => {
          if (!filters.genres.includes(subgenre)) {
            handleFilterChange('genres', subgenre, true);
          }
        });
      } else {
        // Remove parent genre
        handleFilterChange('parent_genres', parentGenre, false);
        // Remove all subgenres
        subgenres.forEach(subgenre => {
          if (filters.genres.includes(subgenre)) {
            handleFilterChange('genres', subgenre, false);
          }
        });
      }
    };

    const handleSubgenreChange = (subgenre, checked) => {
      handleFilterChange('genres', subgenre, checked);
      
      // Find parent genre for this subgenre
      const parentGenre = Object.keys(GENRE_HIERARCHY).find(parent => 
        GENRE_HIERARCHY[parent].includes(subgenre)
      );
      
      if (parentGenre) {
        const allSubgenres = GENRE_HIERARCHY[parentGenre];
        const selectedSubgenres = filters.genres.filter(g => allSubgenres.includes(g));
        
        if (checked) {
          // If all subgenres are now selected, select the parent too
          if (selectedSubgenres.length + 1 === allSubgenres.length) {
            handleFilterChange('parent_genres', parentGenre, true);
          }
        } else {
          // If unchecking a subgenre, uncheck the parent
          if (filters.parent_genres.includes(parentGenre)) {
            handleFilterChange('parent_genres', parentGenre, false);
          }
        }
      }
    };

    const getParentGenreCount = (parentGenre) => {
      const parentOption = filterOptions.parent_genres?.find(p => p.value === parentGenre);
      return parentOption?.count || 0;
    };

    const getSubgenreCount = (subgenre) => {
      const subgenreOption = filterOptions.subgenres?.find(s => s.value === subgenre);
      return subgenreOption?.count || 0;
    };

    const isParentSelected = (parentGenre) => {
      return filters.parent_genres.includes(parentGenre);
    };

    const isSubgenreSelected = (subgenre) => {
      return filters.genres.includes(subgenre);
    };

    // Filter parent genres based on search
    const filteredParentGenres = filterOptions.parent_genres?.filter(parent => {
      if (!searchTerm) return true;
      
      // Search in parent genre name
      if (parent.value.toLowerCase().includes(searchTerm.toLowerCase())) {
        return true;
      }
      
      // Search in subgenres
      const subgenres = GENRE_HIERARCHY[parent.value] || [];
      return subgenres.some(sub => 
        sub.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }) || [];

    return (
      <div className="filter-section hierarchical-genre-filter">
        <h4 className="filter-title">Genres</h4>
        
        <div className="filter-search">
          <input
            type="text"
            placeholder="Search genres..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="filter-search-input"
          />
        </div>

        <div className="filter-options scrollable">
          {filteredParentGenres.map(parentOption => {
            const parentGenre = parentOption.value;
            const subgenres = GENRE_HIERARCHY[parentGenre] || [];
            const isExpanded = expandedParents.has(parentGenre);
            const hasMatchingSubgenres = searchTerm ? 
              subgenres.some(sub => sub.toLowerCase().includes(searchTerm.toLowerCase())) :
              true;

            // Filter subgenres based on search
            const filteredSubgenres = searchTerm ?
              subgenres.filter(sub => sub.toLowerCase().includes(searchTerm.toLowerCase())) :
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
                          onChange={(e) => handleSubgenreChange(subgenre, e.target.checked)}
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

        {searchTerm && filteredParentGenres.length === 0 && (
          <div className="no-filter-results">
            No genres found matching "{searchTerm}"
          </div>
        )}
      </div>
    );
  };

  const FilterSection = ({ title, filterKey, options, type = 'checkbox', searchable = false }) => {
    const [searchTerm, setSearchTerm] = useState('');
    
    if (title === 'Genres') {
      console.log('Genres FilterSection - options length:', options?.length);
      console.log('First 5 genres:', options?.slice(0, 5));
    }
    
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
          {type === 'range' && (
            <div className="range-inputs">
              <input
                type="number"
                placeholder="Min"
                value={filters[`${filterKey}_min`] || ''}
                onChange={(e) => handleFilterChange(`${filterKey}_min`, e.target.value)}
                step="0.1"
                min="0"
                max="1"
              />
              <span>to</span>
              <input
                type="number"
                placeholder="Max"
                value={filters[`${filterKey}_max`] || ''}
                onChange={(e) => handleFilterChange(`${filterKey}_max`, e.target.value)}
                step="0.1"
                min="0"
                max="1"
              />
            </div>
          )}
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
          placeholder="Search songs, artists, albums, or reviews..."
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
          <option value="popularity">Popularity</option>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="year">Year</option>
          <option value="energy">Energy</option>
          <option value="danceability">Danceability</option>
          <option value="valence">Positivity</option>
        </select>
      </div>

      {/* Filters Panel */}
      {isFiltersOpen && (
        <div className="filters-panel">
          <div className="filters-grid">
            {/* Vegan Categories */}
            <FilterSection
              title="Vegan Focus"
              filterKey="vegan_focus"
              options={filterOptions.vegan_focus}
            />
            
            <FilterSection
              title="Animal Category"
              filterKey="animal_category"
              options={filterOptions.animal_category}
            />
            
            <FilterSection
              title="Advocacy Style"
              filterKey="advocacy_style"
              options={filterOptions.advocacy_style}
            />
            
            <FilterSection
              title="Advocacy Issues"
              filterKey="advocacy_issues"
              options={filterOptions.advocacy_issues}
            />
            
            <FilterSection
              title="Lyrical Style"
              filterKey="lyrical_explicitness"
              options={filterOptions.lyrical_explicitness}
            />
            
            <HierarchicalGenreFilter />

            {/* Year Range */}
            {filterOptions.year_range && (
              <div className="filter-section">
                <h4 className="filter-title">Year Range</h4>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder={`From (${filterOptions.year_range.min_year})`}
                    value={filters.year_from}
                    onChange={(e) => handleFilterChange('year_from', e.target.value)}
                    min={filterOptions.year_range.min_year}
                    max={filterOptions.year_range.max_year}
                  />
                  <span>to</span>
                  <input
                    type="number"
                    placeholder={`To (${filterOptions.year_range.max_year})`}
                    value={filters.year_to}
                    onChange={(e) => handleFilterChange('year_to', e.target.value)}
                    min={filterOptions.year_range.min_year}
                    max={filterOptions.year_range.max_year}
                  />
                </div>
              </div>
            )}

            {/* Audio Features */}
            <FilterSection
              title="Energy Level"
              filterKey="energy"
              options={[]}
              type="range"
            />
            
            <FilterSection
              title="Danceability"
              filterKey="danceability"
              options={[]}
              type="range"
            />
            
            <FilterSection
              title="Positivity (Valence)"
              filterKey="valence"
              options={[]}
              type="range"
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="search-loading">
          Searching...
        </div>
      )}
    </div>
  );
}

export default SearchAndFilter;