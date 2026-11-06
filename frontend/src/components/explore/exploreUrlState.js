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
import {
  DEFAULT_CAMERA, MAX_PAN, MAX_ZOOM, MIN_ZOOM, PRESETS, activePreset, clampCamera,
} from './camera3d.js';

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

// 3D is honoured only where the space actually has 3D data; absent or junk means 2D, so every
// pre-existing link keeps its meaning.
export function deriveDim(params, spaceHas3d) {
  return params.get('dim') === '3d' && spaceHas3d ? '3d' : '2d';
}

// The camera travels as `cam=<preset>` or `cam=yaw,pitch,zoom,panX,panY`. Anything invalid is
// the default camera, never a half-repaired one (same contract as deriveView).
export function deriveCamera(params) {
  const raw = params.get('cam');
  if (!raw) return DEFAULT_CAMERA;
  if (Object.hasOwn(PRESETS, raw)) return { ...DEFAULT_CAMERA, ...PRESETS[raw] };
  const parts = raw.split(',');
  if (parts.length !== 5 || parts.some(s => s.trim() === '')) return DEFAULT_CAMERA;
  const [yaw, pitch, zoom, panX, panY] = parts.map(Number);
  if (![yaw, pitch, zoom, panX, panY].every(Number.isFinite)) return DEFAULT_CAMERA;
  if (pitch < -90 || pitch > 90 || zoom < MIN_ZOOM || zoom > MAX_ZOOM) return DEFAULT_CAMERA;
  if (Math.abs(panX) > MAX_PAN || Math.abs(panY) > MAX_PAN) return DEFAULT_CAMERA;
  return clampCamera({ yaw, pitch, zoom, panX, panY });
}

// Default writes nothing (a clean URL); a preset writes its name; otherwise rounded numbers.
export function formatCamera(cam) {
  const d = DEFAULT_CAMERA;
  const isDefault = Math.abs(cam.yaw - d.yaw) < 0.05 && Math.abs(cam.pitch - d.pitch) < 0.05
    && cam.zoom === d.zoom && cam.panX === d.panX && cam.panY === d.panY;
  if (isDefault) return '';
  const preset = activePreset(cam);
  if (preset) return preset;
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  return `${r1(cam.yaw)},${r1(cam.pitch)},${r2(cam.zoom)},${Math.round(cam.panX)},${Math.round(cam.panY)}`;
}

// A theme song's colour is one bucket, but a spotlight lights every song that TOUCHES a lit
// sub-dimension, so it also checks the song's full `subs` list.
export function songPassesSpotlight(song, colour, spotlit) {
  if (spotlit.size === 0) return true;
  if (spotlit.has(song.codes[colour])) return true;
  const subs = song.subs && song.subs[colour];
  return !!subs && subs.some(c => spotlit.has(c));
}

// --- Round 2: year cutoff and on/off toggles -----------------------------------------------

// Earliest and latest release year on the map, and how many songs have none. Only whole numbers
// count as a year; null when no song has one (the year strip then does not render).
export function yearBounds(songs) {
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  for (const s of songs) {
    if (Number.isInteger(s.year)) {
      if (s.year < min) min = s.year;
      if (s.year > max) max = s.year;
    } else {
      missing += 1;
    }
  }
  return Number.isFinite(min) ? { min, max, missing } : null;
}

// `yr=<year>` means "released up to this year". Anything that is not a whole year inside the
// range, including the latest year itself (which would filter nothing), is null = all years.
export function deriveYear(params, bounds) {
  const raw = params.get('yr');
  if (!bounds || !raw || !/^\d+$/.test(raw)) return null;
  const year = Number(raw);
  return year >= bounds.min && year < bounds.max ? year : null;
}

// All years serialise to the empty string so the param is deleted, like the viewport at fit.
export function formatYear(year, bounds) {
  if (!bounds || year == null || year >= bounds.max) return '';
  return String(year);
}

// How one song relates to the cutoff. With no cutoff every song is 'in' (songs with no year
// included); with one, a song with no year is 'unknown' rather than lost.
export function yearState(song, year) {
  if (year == null) return 'in';
  if (!Number.isInteger(song.year)) return 'unknown';
  return song.year <= year ? 'in' : 'out';
}

// A toggle that is on by default and written to the URL only when switched off (`key=0`).
export function deriveFlag(params, key) {
  return params.get(key) !== '0';
}

// Fit serialises to the empty string so the param is deleted, not written as `1,0,0` — an
// unzoomed map should share as a clean URL. Translates round to whole pixels; nobody can see
// a hundredth of one, and it keeps shared links short.
export function formatView(view) {
  if (view.k <= MIN_K) return '';
  return `${Math.round(view.k * 100) / 100},${Math.round(view.tx)},${Math.round(view.ty)}`;
}
