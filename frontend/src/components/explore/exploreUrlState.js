// Every derivation of view state from the URL lives here, and nothing else does.
//
// The B4 final review found three defects in this logic — an unvalidated `space`, an
// unvalidated `colour`, and an empty-but-non-null search set that dimmed all 640 dots — and
// all three lived in the same unextracted block of ExploreMap.jsx. Pure by design: no React,
// no DOM, so `node --test` exercises it directly with no frontend test runner installed.
//
// The rule every `derive*` follows: a value from the URL is honoured only if the catalogue
// still serves it. A shared link must degrade to the default view, never to an empty one.

import { FIT_VIEW, MAX_K, MIN_K } from './mapGeometry.js';

export const DEFAULT_COLOUR = 'sonic_energy';

export function deriveSpace(params, spaces = []) {
  const requested = params.get('space');
  if (spaces.some(s => s.key === requested)) return requested;
  return (spaces[0] && spaces[0].key) || null;
}

export function deriveColour(params, colourBy = []) {
  const requested = params.get('colour');
  if (colourBy.some(c => c.key === requested)) return requested;
  // Falls back to the named default rather than colourBy[0] — the first entry is `genre`,
  // so a positional fallback would quietly recolour the default map.
  const fallback = colourBy.find(c => c.key === DEFAULT_COLOUR) || colourBy[0];
  return (fallback && fallback.key) || null;
}

export function deriveSpotlit(params) {
  const raw = params.get('codes');
  return new Set(raw ? raw.split(',').filter(Boolean) : []);
}

export function deriveQuery(params) {
  return params.get('q') || '';
}

export function deriveSelectedId(params) {
  const raw = params.get('song');
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

// One writer for every param, so a change never clobbers its neighbours.
export function withParam(params, key, value) {
  const next = new URLSearchParams(params);
  if (value == null || value === '') next.delete(key);
  else next.set(key, String(value));
  // Changing the colour dimension invalidates a spotlight expressed in its codes.
  if (key === 'colour') next.delete('codes');
  return next;
}

// The viewport travels as one `view=k,tx,ty` param. Anything unparseable falls back to fit
// rather than to a blank plot — the same guard `space` and `colour` carry, and for the same
// reason: this page's whole contract is that the view lives in the URL.
export function deriveView(params) {
  const raw = params.get('view');
  if (!raw) return FIT_VIEW;
  const parts = raw.split(',');
  if (parts.length !== 3) return FIT_VIEW;
  const [k, tx, ty] = parts.map(Number);
  if (![k, tx, ty].every(Number.isFinite)) return FIT_VIEW;
  if (k < MIN_K || k > MAX_K) return FIT_VIEW;
  return { k, tx, ty };
}

// Fit serialises to the empty string so the param is deleted, not written as `1,0,0` — an
// unzoomed map should share as a clean URL. Translates round to whole pixels; nobody can see
// a hundredth of one, and it keeps shared links short.
export function formatView(view) {
  if (view.k <= MIN_K) return '';
  return `${Math.round(view.k * 100) / 100},${Math.round(view.tx)},${Math.round(view.ty)}`;
}
