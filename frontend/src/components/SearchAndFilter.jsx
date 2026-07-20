import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';
import { readFilterState, applyFilterState, EMPTY_FILTERS } from '../utils/browseUrlState';
import GenreFilterTree from './GenreFilterTree';
import ThemeFacetTree from './ThemeFacetTree';
import FilterChips from './FilterChips';

const DIM_KEYS = ['themes', 'targets', 'actions', 'tactics', 'moral_frames'];

function SearchAndFilter({ onResults, onLoading, onError, initialQuery = '', currentPage = 1, onPageReset, children }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => readFilterState(searchParams).searchQuery || initialQuery);
  const [filters, setFilters] = useState(() => readFilterState(searchParams).filters);
  const [filterOptions, setFilterOptions] = useState({});
  const [facets, setFacets] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) setSearchQuery(initialQuery);
  }, [initialQuery]);

  const performSearch = useCallback(async (searchParams) => {
    try {
      setLoading(true);
      onLoading(true);
      const results = await spotifyService.searchSongs(searchParams);
      onResults(results);
    } catch (error) {
      console.error('Search error:', error);
      onError('Failed to search songs: ' + error.message);
    } finally {
      setLoading(false);
      onLoading(false);
    }
  }, [onResults, onLoading, onError]);

  // Only send booleans when true (keeps the query string clean); arrays/strings pass through.
  const buildSearchParams = useCallback(() => {
    const p = { q: searchQuery, page: currentPage, limit: 20, sort_by: filters.sort_by };
    if (filters.genres.length) p.genres = filters.genres;
    if (filters.year_from) p.year_from = filters.year_from;
    if (filters.year_to) p.year_to = filters.year_to;
    if (filters.lengths.length) p.lengths = filters.lengths;
    if (filters.has_youtube) p.has_youtube = 'true';
    if (filters.has_analysis) p.has_analysis = 'true';
    if (filters.on_spotify) p.on_spotify = 'true';
    if (filters.languages.length) p.languages = filters.languages;
    DIM_KEYS.forEach(k => { if (filters[k].length) p[k] = filters[k]; });
    if (filters.facet_groups.length) p.facet_groups = filters.facet_groups;
    if (filters.facet_subdims.length) p.facet_subdims = filters.facet_subdims;
    return p;
  }, [searchQuery, filters, currentPage]);

  useEffect(() => {
    const params = buildSearchParams();
    const t = setTimeout(() => performSearch(params), 300);
    return () => clearTimeout(t);
  }, [buildSearchParams, performSearch]);

  // Mirror browse state into the URL (single source of truth for restore + sharing).
  // Functional updater + applyFilterState clone => the page writer's `page` key is preserved.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchParams(prev => applyFilterState(prev, { searchQuery, filters }), { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, filters, setSearchParams]);

  // Dynamic (cross-filtered) sidebar counts: refetch on every filter change, debounced
  // and stale-guarded. Page-less params — facets don't depend on page/limit.
  const facetsReq = useRef(0);
  useEffect(() => {
    const { page: _page, limit: _limit, ...facetParams } = buildSearchParams();
    const token = ++facetsReq.current;
    const t = setTimeout(async () => {
      const data = await spotifyService.getBrowseFacets(facetParams);
      if (token !== facetsReq.current) return; // stale — a newer request superseded this
      if (!data || !data.genre_tree) return; // failed/empty response — keep last-good counts
      setFilterOptions({
        genre_tree: data.genre_tree, year_range: data.year_range,
        languages: data.languages, length_buckets: data.length_buckets,
        availability: data.availability,
      });
      setFacets(data.facets || {});
    }, 300);
    return () => clearTimeout(t);
  }, [buildSearchParams]);

  useEffect(() => {
    if (onPageReset && currentPage !== 1) onPageReset();
  }, [searchQuery, JSON.stringify(filters)]);

  // --- mutation helpers ---
  const toggleInArray = (key, value, checked) => setFilters(prev => ({
    ...prev,
    [key]: checked ? [...prev[key], value] : prev[key].filter(v => v !== value),
  }));

  const onToggleGenre = (value, checked) => toggleInArray('genres', value, checked);

  const onToggleParent = (parentValue, checked, subValues) => setFilters(prev => {
    const parents = checked
      ? [...prev.parent_genres, parentValue]
      : prev.parent_genres.filter(v => v !== parentValue);
    const genres = checked
      ? Array.from(new Set([...prev.genres, ...subValues]))
      : prev.genres.filter(v => !subValues.includes(v));
    return { ...prev, parent_genres: parents, genres };
  });

  const onToggleFacet = (dimKey, code, checked) => toggleInArray(dimKey, code, checked);

  const findSub = (dimKey, subId) => (facets[dimKey]?.sub_dimensions || []).find(s => s.id === subId);
  const findGroup = (dimKey, groupId) => {
    for (const s of (facets[dimKey]?.sub_dimensions || [])) {
      const g = s.groups.find(x => x.id === groupId);
      if (g) return g;
    }
    return null;
  };

  const onToggleGroup = (dimKey, groupId, checked) => setFilters(prev => {
    const k = `${dimKey}:${groupId}`;
    const facet_groups = checked ? [...prev.facet_groups, k] : prev.facet_groups.filter(v => v !== k);
    let codes = prev[dimKey];
    if (checked) {
      const g = findGroup(dimKey, groupId);
      const ids = g ? g.codes.map(c => c.code) : [];
      codes = prev[dimKey].filter(c => !ids.includes(c)); // ancestor covers -> clear own codes
    }
    return { ...prev, facet_groups, [dimKey]: codes };
  });

  const onToggleSubdim = (dimKey, subId, checked) => setFilters(prev => {
    const k = `${dimKey}:${subId}`;
    const facet_subdims = checked ? [...prev.facet_subdims, k] : prev.facet_subdims.filter(v => v !== k);
    let facet_groups = prev.facet_groups, codes = prev[dimKey];
    if (checked) {
      const s = findSub(dimKey, subId);
      const gKeys = s ? s.groups.map(g => `${dimKey}:${g.id}`) : [];
      const cIds = s ? s.groups.flatMap(g => g.codes.map(c => c.code)) : [];
      facet_groups = prev.facet_groups.filter(v => !gKeys.includes(v));
      codes = prev[dimKey].filter(c => !cIds.includes(c));
    }
    return { ...prev, facet_subdims, facet_groups, [dimKey]: codes };
  });

  const setScalar = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  const toggleBool = (key) => setFilters(prev => ({ ...prev, [key]: !prev[key] }));

  const clearAllFilters = () => { setFilters(EMPTY_FILTERS); setSearchQuery(''); };

  // --- chips ---
  const codeLabelMap = useMemo(() => {
    const m = {};
    DIM_KEYS.forEach(dim => {
      m[dim] = {};
      (facets[dim]?.sub_dimensions || []).forEach(sub =>
        sub.groups.forEach(gr => gr.codes.forEach(c => { m[dim][c.code] = c.label; })));
    });
    return m;
  }, [facets]);

  const lengthLabelMap = useMemo(() => {
    const m = {};
    (filterOptions.length_buckets || []).forEach(b => { m[b.value] = b.label; });
    return m;
  }, [filterOptions]);

  const facetLabelMaps = useMemo(() => {
    const groups = {}, subdims = {};
    DIM_KEYS.forEach(dim => {
      groups[dim] = {}; subdims[dim] = {};
      (facets[dim]?.sub_dimensions || []).forEach(sub => {
        subdims[dim][sub.id] = sub.label;
        sub.groups.forEach(g => { groups[dim][g.id] = g.label; });
      });
    });
    return { groups, subdims };
  }, [facets]);

  const chips = useMemo(() => {
    const list = [];
    if (searchQuery) list.push({ key: 'q:', label: `"${searchQuery}"` });
    filters.parent_genres.forEach(p => list.push({ key: `parent:${p}`, label: `Genre: ${p}` }));
    // subgenres selected on their own (parent not selected) get their own chip
    const parentSubs = new Set();
    (filterOptions.genre_tree?.parents || [])
      .filter(p => filters.parent_genres.includes(p.value))
      .forEach(p => p.subgenres.forEach(s => parentSubs.add(s.value)));
    filters.genres.filter(g => !parentSubs.has(g)).forEach(g => list.push({ key: `genre:${g}`, label: g }));
    if (filters.year_from || filters.year_to) {
      list.push({ key: 'year:', label: `${filters.year_from || '…'}–${filters.year_to || '…'}` });
    }
    filters.lengths.forEach(l => list.push({ key: `length:${l}`, label: lengthLabelMap[l] || l }));
    if (filters.has_youtube) list.push({ key: 'has_youtube:', label: 'Has YouTube' });
    if (filters.has_analysis) list.push({ key: 'has_analysis:', label: 'Has analysis' });
    if (filters.on_spotify) list.push({ key: 'on_spotify:', label: 'On Spotify' });
    filters.languages.forEach(l => list.push({ key: `language:${l}`, label: l }));
    filters.facet_subdims.forEach(v => {
      const [dk, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
      list.push({ key: `subdim:${v}`, label: facetLabelMaps.subdims[dk]?.[id] || id });
    });
    filters.facet_groups.forEach(v => {
      const [dk, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
      list.push({ key: `group:${v}`, label: facetLabelMaps.groups[dk]?.[id] || id });
    });
    DIM_KEYS.forEach(dim => filters[dim].forEach(code =>
      list.push({ key: `${dim}:${code}`, label: codeLabelMap[dim]?.[code] || code })));
    return list;
  }, [searchQuery, filters, filterOptions, lengthLabelMap, codeLabelMap, facetLabelMaps]);

  const removeChip = (key) => {
    const [type, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (type === 'q') return setSearchQuery('');
    if (type === 'year') return setFilters(prev => ({ ...prev, year_from: '', year_to: '' }));
    if (type === 'parent') {
      const parent = (filterOptions.genre_tree?.parents || []).find(p => p.value === value);
      return onToggleParent(value, false, parent ? parent.subgenres.map(s => s.value) : []);
    }
    if (type === 'genre') return toggleInArray('genres', value, false);
    if (type === 'length') return toggleInArray('lengths', value, false);
    if (type === 'language') return toggleInArray('languages', value, false);
    if (['has_youtube', 'has_analysis', 'on_spotify'].includes(type)) return setScalar(type, false);
    if (type === 'subdim') {
      const [dk, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
      return onToggleSubdim(dk, id, false);
    }
    if (type === 'group') {
      const [dk, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
      return onToggleGroup(dk, id, false);
    }
    if (DIM_KEYS.includes(type)) return toggleInArray(type, value, false);
  };

  const activeCount = chips.length;
  const yr = filterOptions.year_range || {};

  const filterGroups = (
    <div className="sidebar-groups">
      <GenreFilterTree
        tree={filterOptions.genre_tree}
        selectedGenres={filters.genres}
        selectedParents={filters.parent_genres}
        onToggleGenre={onToggleGenre}
        onToggleParent={onToggleParent}
      />
      <ThemeFacetTree
        facets={facets}
        selected={filters}
        onToggle={onToggleFacet}
        codedCount={filterOptions.availability?.has_analysis || 0}
        selectedGroups={filters.facet_groups}
        selectedSubdims={filters.facet_subdims}
        onToggleGroup={onToggleGroup}
        onToggleSubdim={onToggleSubdim}
      />
      <div className="filter-section">
        <h3 className="filter-title">Year range</h3>
        <div className="range-inputs">
          <input type="number" placeholder={yr.min_year ? `From ${yr.min_year}` : 'From'}
            value={filters.year_from} onChange={(e) => setScalar('year_from', e.target.value)}
            min={yr.min_year} max={yr.max_year} />
          <span>to</span>
          <input type="number" placeholder={yr.max_year ? `To ${yr.max_year}` : 'To'}
            value={filters.year_to} onChange={(e) => setScalar('year_to', e.target.value)}
            min={yr.min_year} max={yr.max_year} />
        </div>
      </div>
      <div className="filter-section">
        <h3 className="filter-title">Song length</h3>
        <div className="filter-options">
          {(filterOptions.length_buckets || []).map(b => {
            const selected = filters.lengths.includes(b.value);
            const zero = b.count === 0 && !selected;
            return (
              <label key={b.value} className={`filter-option ${zero ? 'is-zero' : ''}`}>
                <input type="checkbox" checked={selected} disabled={zero}
                  onChange={(e) => toggleInArray('lengths', b.value, e.target.checked)} />
                <span className="filter-label">{b.label}<span className="filter-count">({b.count})</span></span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="filter-section">
        <h3 className="filter-title">Available on</h3>
        <div className="filter-options">
          <label className={`filter-option ${(filterOptions.availability?.on_spotify || 0) === 0 && !filters.on_spotify ? 'is-zero' : ''}`}>
            <input type="checkbox" checked={filters.on_spotify}
              disabled={(filterOptions.availability?.on_spotify || 0) === 0 && !filters.on_spotify}
              onChange={() => toggleBool('on_spotify')} />
            <span className="filter-label">On Spotify<span className="filter-count">({filterOptions.availability?.on_spotify || 0})</span></span>
          </label>
          <label className={`filter-option ${(filterOptions.availability?.has_youtube || 0) === 0 && !filters.has_youtube ? 'is-zero' : ''}`}>
            <input type="checkbox" checked={filters.has_youtube}
              disabled={(filterOptions.availability?.has_youtube || 0) === 0 && !filters.has_youtube}
              onChange={() => toggleBool('has_youtube')} />
            <span className="filter-label">Has YouTube<span className="filter-count">({filterOptions.availability?.has_youtube || 0})</span></span>
          </label>
        </div>
      </div>
      <div className="filter-section">
        <h3 className="filter-title">Analysis</h3>
        <div className="filter-options">
          <label className={`filter-option ${(filterOptions.availability?.has_analysis || 0) === 0 && !filters.has_analysis ? 'is-zero' : ''}`}>
            <input type="checkbox" checked={filters.has_analysis}
              disabled={(filterOptions.availability?.has_analysis || 0) === 0 && !filters.has_analysis}
              onChange={() => toggleBool('has_analysis')} />
            <span className="filter-label">Has lyrics analysis<span className="filter-count">({filterOptions.availability?.has_analysis || 0})</span></span>
          </label>
        </div>
      </div>
      {(filterOptions.languages?.length > 0) && (
        <div className="filter-section">
          <h3 className="filter-title">Language</h3>
          <div className="filter-options">
            {filterOptions.languages.map(l => {
              const selected = filters.languages.includes(l.value);
              const zero = l.count === 0 && !selected;
              return (
                <label key={l.value} className={`filter-option ${zero ? 'is-zero' : ''}`}>
                  <input type="checkbox" checked={selected} disabled={zero}
                    onChange={(e) => toggleInArray('languages', l.value, e.target.checked)} />
                  <span className="filter-label">{l.value}<span className="filter-count">({l.count})</span></span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="browse">
      <div className="browse-top">
        <div className="browse-search-row">
          <div className="search-container">
            <input type="text" className="search-input" placeholder="Search songs, artists, albums..."
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <button className="filter-toggle drawer-toggle" onClick={() => setDrawerOpen(true)}>
              Filters {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
            </button>
            {activeCount > 0 && (
              <button className="clear-filters" onClick={clearAllFilters}>Clear all</button>
            )}
          </div>
          <div className="sort-container">
            <label>Sort by:</label>
            <select value={filters.sort_by} onChange={(e) => setScalar('sort_by', e.target.value)}>
              <option value="title">Title</option>
              <option value="artist">Artist</option>
              <option value="year">Year</option>
              <option value="date_added">Date added</option>
            </select>
          </div>
        </div>
      </div>

      <div className="browse-body">
        <aside className={`browse-sidebar ${drawerOpen ? 'open' : ''}`}>
          <div className="sidebar-drawer-head">
            <h2 className="sidebar-title">Filters</h2>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close filters">✕</button>
          </div>
          {filterGroups}
        </aside>
        {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
        <div className="browse-results">
          <FilterChips chips={chips} onRemove={removeChip} />
          {loading && <div className="search-loading">Searching...</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

export default SearchAndFilter;
