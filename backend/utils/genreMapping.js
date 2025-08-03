// Hierarchical genre mapping for the vegan playlist application
// Maps specific subgenres to higher-level parent genres

const GENRE_HIERARCHY = {
  // Metal parent genre
  'metal': [
    'metalcore',
    'deathcore', 
    'mathcore',
    'groove metal',
    'death metal',
    'black metal',
    'thrash metal',
    'doom metal',
    'progressive metal',
    'nu metal',
    'melodic death metal',
    'sludge metal',
    'stoner metal',
    'grindcore',
    'heavy metal',
    'alternative metal',
    'industrial metal',
    'speed metal',
    'rap metal',
    'djent'
  ],
  
  // Rock parent genre  
  'rock': [
    'blues rock',
    'hard rock',
    'alternative rock',
    'indie rock',
    'classic rock',
    'progressive rock',
    'psychedelic rock',
    'garage rock',
    'gothic rock',
    'industrial rock',
    'art rock',
    'acid rock',
    'grunge',
    'post-grunge',
    'britpop',
    'madchester',
    'krautrock',
    'noise rock',
    'neo-psychedelic',
    'folk rock',
    'celtic rock',
    'brazilian rock'
  ],
  
  // Punk parent genre
  'punk': [
    'punk',
    'hardcore punk',
    'skate punk',
    'ska punk',
    'folk punk',
    'pop punk',
    'post-punk',
    'anarcho-punk',
    'street punk',
    'queercore',
    'riot grrrl',
    'indie punk',
    'celtic punk',
    'proto-punk',
    'egg punk'
  ],
  
  // Hardcore parent genre
  'hardcore': [
    'hardcore',
    'melodic hardcore',
    'post-hardcore',
    'crossover hardcore',
    'screamo',
    'midwest emo'
  ],
  
  // Folk parent genre
  'folk': [
    'folk punk',
    'anti-folk',
    'indie folk',
    'folk rock',
    'acoustic folk',
    'contemporary folk',
    'folk',
    'traditional folk',
    'americana',
    'celtic',
    'singer-songwriter',
    'country blues'
  ],
  
  // Blues parent genre
  'blues': [
    'blues',
    'blues rock',
    'electric blues',
    'acoustic blues',
    'delta blues'
  ],
  
  // Pop parent genre
  'pop': [
    'pop',
    'indie pop',
    'electropop',
    'synthpop',
    'power pop',
    'dream pop',
    'jangle pop',
    'swedish pop',
    'german pop',
    'new wave',
    'pop soul'
  ],
  
  // Electronic parent genre
  'electronic': [
    'electronic',
    'ambient',
    'techno',
    'house',
    'drum and bass',
    'dubstep',
    'edm',
    'industrial',
    'ebm',
    'darkwave',
    'coldwave',
    'cold wave',
    'downtempo',
    'trip hop',
    'glitch',
    'witch house',
    'footwork',
    'bassline',
    'riddim',
    'minimalism',
    'neoclassical'
  ],
  
  // Hip-hop parent genre
  'hip-hop': [
    'hip hop',
    'rap',
    'conscious hip hop',
    'alternative hip hop',
    'underground hip hop',
    'east coast hip hop',
    'experimental hip hop',
    'hardcore hip hop',
    'old school hip hop',
    'gangster rap',
    'horrorcore',
    'grime',
    'uk grime'
  ],
  
  // Reggae parent genre
  'reggae': [
    'reggae',
    'ska',
    'dub',
    'roots reggae',
    'nz reggae',
    'lovers rock',
    'ragga',
    'dancehall',
    'rocksteady'
  ],
  
  // Jazz parent genre
  'jazz': [
    'free jazz',
    'hard bop'
  ],
  
  // Soul parent genre
  'soul': [
    'philly soul',
    'pop soul',
    'gospel',
    'gospel r&b'
  ],
  
  // Other/Misc parent genre
  'other': [
    'christian',
    'worship',
    'children\'s music',
    'musicals',
    'soundtrack',
    'comedy',
    'spoken word',
    'lullaby',
    'deathrock',
    'avant-garde',
    'experimental',
    'aor'
  ]
};

// Create reverse mapping for quick lookup
const SUBGENRE_TO_PARENT = {};
Object.entries(GENRE_HIERARCHY).forEach(([parent, subgenres]) => {
  subgenres.forEach(subgenre => {
    SUBGENRE_TO_PARENT[subgenre] = parent;
  });
});

/**
 * Get the parent genre for a given subgenre
 * @param {string} subgenre - The specific subgenre
 * @returns {string} - The parent genre, or 'other' if not found
 */
function getParentGenre(subgenre) {
  if (!subgenre) return null;
  
  const normalized = subgenre.toLowerCase().trim();
  return SUBGENRE_TO_PARENT[normalized] || 'other';
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