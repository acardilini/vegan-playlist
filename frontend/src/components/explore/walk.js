// The guided walk's path logic ("Next similar" / "Back"). Pure; the path itself is held in
// component state, never the URL. The path is only meaningful while its last element is the
// selected song: selecting any other song (a click, Escape, a search result) restarts the walk,
// which is why no explicit reset is needed anywhere.
import { nearestSongs } from './neighbours.js';

export function walkBase(path, selectedId) {
  if (selectedId == null) return [];
  return path.length > 0 && path[path.length - 1] === selectedId ? path : [selectedId];
}

// The nearest song not yet on the path, appended; null with no selection, no coordinates or
// nothing left to visit.
export function walkNext(songs, space, dim, path, selectedId) {
  const base = walkBase(path, selectedId);
  if (base.length === 0) return null;
  const [next] = nearestSongs(songs, base[base.length - 1], space, dim, 1, new Set(base));
  return next ? { path: [...base, next.id], id: next.id } : null;
}

// One step back along the path; null at the start (or when the selection is off the path).
export function walkBack(path, selectedId) {
  const base = walkBase(path, selectedId);
  if (base.length < 2) return null;
  const trimmed = base.slice(0, -1);
  return { path: trimmed, id: trimmed[trimmed.length - 1] };
}

// The path as it should be held after the selection changes: kept only while it still ends at the
// selected song, otherwise forgotten (Escape, the card's x, or picking any other song), so
// reselecting the song a long-abandoned walk ended on starts fresh instead of reviving it.
export function walkPrune(path, selectedId) {
  return path.length > 0 && path[path.length - 1] === selectedId ? path : [];
}
