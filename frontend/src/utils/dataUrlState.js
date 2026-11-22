// URL state for the Explore > Data area: the shared slice (parent genre + release-year window) and the
// Over time chart's own toggles. Pure (no React); the URL is the single source of truth, like exploreUrlState.
// Every invalid value falls back to its default so a stale shared link never draws an empty chart.
import { applyFilterState, EMPTY_FILTERS } from './browseUrlState.js';

export const ERA_MODES = ['count', 'share'];
export const ERA_BUCKETS = ['5y', '1y'];
// the Arguments flow presets (ids only: flowModel.js owns their fields, and a test keeps the two lists equal)
export const FLOW_IDS = ['genre-tone-action', 'audience-frame-action', 'voice-tone-emotion'];

const OWNED = ['pg', 'yf', 'yt', 'era_m', 'era_b', 'flow'];

function year(raw, fallback, bounds) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, n));
}

// bounds = {min, max} from the data, or null while it is still loading (years are then null).
export function deriveDataState(params, bounds) {
  let yf = null;
  let yt = null;
  if (bounds) {
    yf = year(params.get('yf'), bounds.min, bounds);
    yt = year(params.get('yt'), bounds.max, bounds);
    if (yf > yt) [yf, yt] = [yt, yf];
  }
  const m = params.get('era_m');
  const b = params.get('era_b');
  const f = params.get('flow');
  return {
    pg: params.get('pg') || '',
    yf,
    yt,
    eraMode: ERA_MODES.includes(m) ? m : 'count',
    eraBucket: ERA_BUCKETS.includes(b) ? b : '5y',
    flow: FLOW_IDS.includes(f) ? f : FLOW_IDS[0],
  };
}

// Defaults are omitted; params this module does not own are kept.
export function formatDataState(state, bounds, prev = new URLSearchParams()) {
  const p = new URLSearchParams(prev);
  for (const k of OWNED) p.delete(k);
  if (state.pg) p.set('pg', state.pg);
  if (bounds && state.yf != null && state.yf !== bounds.min) p.set('yf', String(state.yf));
  if (bounds && state.yt != null && state.yt !== bounds.max) p.set('yt', String(state.yt));
  if (state.eraMode && state.eraMode !== 'count') p.set('era_m', state.eraMode);
  if (state.eraBucket && state.eraBucket !== '5y') p.set('era_b', state.eraBucket);
  if (state.flow && state.flow !== FLOW_IDS[0] && FLOW_IDS.includes(state.flow)) p.set('flow', state.flow);
  return p;
}

// "Browse these songs": the slice in the browse page's own vocabulary. It states no song count (Browse filters on
// catalogue genres, so its count can differ slightly from a chart's in a genre-filtered slice). `extra` is
// { browseKey: [codes] } in Browse's own vocabulary; its arrays are unioned with the slice's own, de-duplicated.
export function browseHref(state, bounds, extra = {}) {
  const filters = structuredClone(EMPTY_FILTERS);
  if (state.pg) filters.parent_genres = [state.pg];
  if (bounds && state.yf != null && state.yf > bounds.min) filters.year_from = String(state.yf);
  if (bounds && state.yt != null && state.yt < bounds.max) filters.year_to = String(state.yt);
  for (const [key, codes] of Object.entries(extra)) {
    if (!Array.isArray(filters[key])) continue;
    filters[key] = [...new Set([...filters[key], ...codes])];
  }
  const qs = applyFilterState(new URLSearchParams(), { searchQuery: '', filters }).toString();
  return qs ? `/?${qs}` : '/';
}
