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

// The first of an artist's genres that files under a real parent, else 'other' (null with no genres).
// artist_genres can arrive nested (an array of arrays), hence the flat().
export function cardParentGenre(hierarchy, artistGenres) {
  if (!artistGenres || artistGenres.length === 0) return null;
  for (const genre of artistGenres.flat()) {
    const parent = parentGenreOf(hierarchy, genre);
    if (parent && parent !== 'other') return parent;
  }
  return 'other';
}
