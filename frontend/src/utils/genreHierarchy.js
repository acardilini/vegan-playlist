// Parent genre of a genre string, against the shared hierarchy (backend/data/genre_hierarchy.json -
// callers import the JSON and pass it in, so this stays pure and node-testable). Mirrors the
// backend's getParentGenre: a bare parent is its own parent, a listed subgenre maps up, anything
// else is 'other'.
export function parentGenreOf(hierarchy, genre) {
  if (!genre) return null;
  const g = String(genre).toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(hierarchy, g)) return g;
  for (const [parent, subgenres] of Object.entries(hierarchy)) {
    if (subgenres.includes(g)) return parent;
  }
  return 'other';
}
