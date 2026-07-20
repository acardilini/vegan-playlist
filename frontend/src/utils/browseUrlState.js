// Serialize/deserialize homepage browse state to/from the URL query string.
// Pure (no React). The URL is the single source of truth for browse state.

export const EMPTY_FILTERS = {
  genres: [], parent_genres: [],
  year_from: '', year_to: '',
  lengths: [],
  has_youtube: false, has_analysis: false, on_spotify: false,
  languages: [],
  themes: [], targets: [], actions: [], tactics: [], moral_frames: [],
  facet_groups: [], facet_subdims: [],
  sort_by: 'year',
};

const ARRAY_KEYS = [
  'genres', 'parent_genres', 'lengths', 'languages',
  'themes', 'targets', 'actions', 'tactics', 'moral_frames',
  'facet_groups', 'facet_subdims',
];
const STRING_KEYS = ['year_from', 'year_to'];
const BOOL_KEYS = ['has_youtube', 'has_analysis', 'on_spotify'];
const DEFAULT_SORT = 'year';

// URL -> { searchQuery, filters }. Absent keys fall back to EMPTY_FILTERS defaults.
export function readFilterState(searchParams) {
  const filters = structuredClone(EMPTY_FILTERS);
  for (const k of ARRAY_KEYS) {
    const v = searchParams.getAll(k);
    if (v.length) filters[k] = v;
  }
  for (const k of STRING_KEYS) {
    const v = searchParams.get(k);
    if (v) filters[k] = v;
  }
  for (const k of BOOL_KEYS) {
    if (searchParams.get(k) === 'true') filters[k] = true;
  }
  const sb = searchParams.get('sort_by');
  if (sb) filters.sort_by = sb;
  return { searchQuery: searchParams.get('q') || '', filters };
}

// { searchQuery, filters } -> URLSearchParams, cloned from prev so non-owned keys
// (e.g. page) are preserved. Defaults are omitted, not written.
export function applyFilterState(prevParams, { searchQuery, filters }) {
  const p = new URLSearchParams(prevParams);
  p.delete('q');
  if (searchQuery) p.set('q', searchQuery);
  for (const k of ARRAY_KEYS) {
    p.delete(k);
    (filters[k] || []).forEach(v => p.append(k, v));
  }
  for (const k of STRING_KEYS) {
    p.delete(k);
    if (filters[k]) p.set(k, filters[k]);
  }
  for (const k of BOOL_KEYS) {
    p.delete(k);
    if (filters[k]) p.set(k, 'true');
  }
  p.delete('sort_by');
  if (filters.sort_by && filters.sort_by !== DEFAULT_SORT) p.set('sort_by', filters.sort_by);
  return p;
}

// --- within-visit persistence (survives param-less nav to '/', e.g. the Home link) ---
// The URL stays the source of truth whenever it carries any browse param; sessionStorage
// is the fallback only for a clean '/' so filters aren't lost on a Home/logo click.

const STORAGE_KEY = 'vp:browseState';
const BROWSE_KEYS = ['q', 'sort_by', 'page', ...ARRAY_KEYS, ...STRING_KEYS, ...BOOL_KEYS];

export function hasBrowseParams(searchParams) {
  return BROWSE_KEYS.some(k => searchParams.has(k));
}

export function readStoredBrowseState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        searchQuery: s.searchQuery || '',
        filters: { ...structuredClone(EMPTY_FILTERS), ...(s.filters || {}) },
        page: s.page || 1,
      };
    }
  } catch { /* sessionStorage unavailable or corrupt — fall through to empty */ }
  return { searchQuery: '', filters: structuredClone(EMPTY_FILTERS), page: 1 };
}

export function writeStoredBrowseState({ searchQuery, filters, page }) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ searchQuery, filters, page }));
  } catch { /* sessionStorage unavailable — non-fatal */ }
}

// Initial browse state for a mounting browse view: the URL when it carries browse params
// (deep link / shared URL / back-nav), otherwise the last state saved this visit.
export function readBrowseState(searchParams) {
  if (hasBrowseParams(searchParams)) {
    const { searchQuery, filters } = readFilterState(searchParams);
    return { searchQuery, filters, page: parseInt(searchParams.get('page'), 10) || 1 };
  }
  return readStoredBrowseState();
}
