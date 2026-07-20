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
