// Hierarchical genre mapping for the vegan playlist application
// Maps specific subgenres to higher-level parent genres

//
// The hierarchy itself lives in data/genre_hierarchy.json so the analysis project can read the
// exact same file. Every subgenre appears under exactly one parent (test/genreMapping.test.js
// enforces it); a bare parent such as 'rock' resolves to itself in getParentGenre.
const GENRE_HIERARCHY = require('../data/genre_hierarchy.json');

// Create reverse mapping for quick lookup (read it with hasOwnProperty: a genre string such as
// 'constructor' would otherwise find an inherited function on a plain object).
const SUBGENRE_TO_PARENT = {};
Object.entries(GENRE_HIERARCHY).forEach(([parent, subgenres]) => {
  subgenres.forEach(subgenre => {
    SUBGENRE_TO_PARENT[subgenre] = parent;
  });
});

/**
 * Get the parent genre for a given subgenre
 * @param {string} subgenre - The specific subgenre (or a parent, which is its own parent)
 * @returns {string} - The parent genre, or 'other' if not found
 */
function getParentGenre(subgenre) {
  if (!subgenre) return null;

  const normalized = subgenre.toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(GENRE_HIERARCHY, normalized)) return normalized;
  if (Object.prototype.hasOwnProperty.call(SUBGENRE_TO_PARENT, normalized)) return SUBGENRE_TO_PARENT[normalized];
  return 'other';
}

/**
 * Get all subgenres for a parent genre
 * @param {string} parentGenre - The parent genre
 * @returns {string[]} - Array of subgenres
 */
function getSubgenres(parentGenre) {
  if (!parentGenre) return [];
  
  const normalized = parentGenre.toLowerCase().trim();
  return GENRE_HIERARCHY[normalized] || [];
}

/**
 * Get all available parent genres
 * @returns {string[]} - Array of parent genre names
 */
function getParentGenres() {
  return Object.keys(GENRE_HIERARCHY).sort();
}

/**
 * Get all available subgenres across all parents
 * @returns {string[]} - Array of all subgenre names
 */
function getAllSubgenres() {
  const subgenres = new Set();
  Object.values(GENRE_HIERARCHY).forEach(genreList => {
    genreList.forEach(genre => subgenres.add(genre));
  });
  return Array.from(subgenres).sort();
}

/**
 * Process Spotify genres array and return the best match
 * @param {string[]} spotifyGenres - Array of genres from Spotify
 * @returns {object} - {genre: string, parentGenre: string}
 */
function processSpotifyGenres(spotifyGenres) {
  if (!spotifyGenres || spotifyGenres.length === 0) {
    return { genre: null, parentGenre: null };
  }
  
  // Priority order: prefer more specific genres first
  const priorityOrder = ['punk', 'hardcore', 'metal', 'rock', 'folk', 'blues'];
  
  // Find the first genre that matches our hierarchy
  for (const spotifyGenre of spotifyGenres) {
    const normalized = spotifyGenre.toLowerCase().trim();
    const parentGenre = getParentGenre(normalized);
    
    if (parentGenre && parentGenre !== 'other') {
      return {
        genre: normalized,
        parentGenre: parentGenre
      };
    }
  }
  
  // If no exact match, try partial matching
  for (const priority of priorityOrder) {
    for (const spotifyGenre of spotifyGenres) {
      const normalized = spotifyGenre.toLowerCase().trim();
      if (normalized.includes(priority)) {
        return {
          genre: normalized,
          parentGenre: priority
        };
      }
    }
  }
  
  // Return the first genre as-is with 'other' parent
  return {
    genre: spotifyGenres[0].toLowerCase().trim(),
    parentGenre: 'other'
  };
}

module.exports = {
  GENRE_HIERARCHY,
  SUBGENRE_TO_PARENT,
  getParentGenre,
  getSubgenres,
  getParentGenres,
  getAllSubgenres,
  processSpotifyGenres
};