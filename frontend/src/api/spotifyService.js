const API_BASE = 'http://localhost:5000/api/spotify';

export const spotifyService = {
  // Get featured songs for homepage
  getFeaturedSongs: async (limit = 8) => {
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

  // Search songs
  searchSongs: async (query) => {
    try {
      const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Failed to search songs');
      return await response.json();
    } catch (error) {
      console.error('Error searching songs:', error);
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
  }
};