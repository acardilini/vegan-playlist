const API_BASE = 'http://localhost:5000/api/spotify';

export const spotifyService = {
  // Get featured songs for homepage
  getFeaturedSongs: async (limit = 4) => {
    try {
      const response = await fetch(`${API_BASE}/songs/featured?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch featured songs');
      return await response.json();
    } catch (error) {
      console.error('Error fetching featured songs:', error);
      throw error;
    }
  },

  // Get single song by ID
  getSong: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/songs/${id}`);
      if (!response.ok) throw new Error('Failed to fetch song');
      return await response.json();
    } catch (error) {
      console.error('Error fetching song:', error);
      throw error;
    }
  },

  // Get all artists
  getArtists: async () => {
    try {
      const response = await fetch(`${API_BASE}/artists`);
      if (!response.ok) throw new Error('Failed to fetch artists');
      return await response.json();
    } catch (error) {
      console.error('Error fetching artists:', error);
      throw error;
    }
  },

  // Advanced search songs with filters
  searchSongs: async (searchParams) => {
    try {
      const params = new URLSearchParams();
      
      // Add all search parameters
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v));
          } else {
            params.append(key, value);
          }
        }
      });
      
      const url = `${API_BASE}/search?${params.toString()}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }
      const result = await response.json();
      
      // Validate the response structure
      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response format');
      }
      
      if (!result.songs) {
        result.songs = [];
      }
      
      if (!result.pagination) {
        result.pagination = { page: 1, total: 0, pages: 0 };
      }
      
      return result;
    } catch (error) {
      console.error('Error searching songs:', error);
      throw error;
    }
  },

  // Get filter options and counts
  getFilterOptions: async () => {
    try {
      const response = await fetch(`${API_BASE}/filter-options`);
      if (!response.ok) throw new Error('Failed to fetch filter options');
      return await response.json();
    } catch (error) {
      console.error('Error fetching filter options:', error);
      throw error;
    }
  },

  // Get database stats
  getStats: async () => {
    try {
      const response = await fetch(`${API_BASE}/db-stats`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      return await response.json();
    } catch (error) {
      console.error('Error fetching stats:', error);
      throw error;
    }
  },

  // Get similar songs
  getSimilarSongs: async (songId, limit = 6) => {
    try {
      const response = await fetch(`${API_BASE}/songs/${songId}/similar?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch similar songs');
      return await response.json();
    } catch (error) {
      console.error('Error fetching similar songs:', error);
      throw error;
    }
  },

  // Get single artist by ID with their songs
  getArtist: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/artists/${id}`);
      if (!response.ok) throw new Error('Failed to fetch artist');
      return await response.json();
    } catch (error) {
      console.error('Error fetching artist:', error);
      throw error;
    }
  },

  // Search and filter artists
  searchArtists: async (searchParams) => {
    try {
      const params = new URLSearchParams();
      
      // Add all search parameters
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v));
          } else {
            params.append(key, value);
          }
        }
      });
      
      const response = await fetch(`${API_BASE}/artists/search?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to search artists');
      return await response.json();
    } catch (error) {
      console.error('Error searching artists:', error);
      throw error;
    }
  },

  // Get artist filter options
  getArtistFilterOptions: async () => {
    try {
      const response = await fetch(`${API_BASE}/artist-filter-options`);
      if (!response.ok) throw new Error('Failed to fetch artist filter options');
      return await response.json();
    } catch (error) {
      console.error('Error fetching artist filter options:', error);
      throw error;
    }
  }
};