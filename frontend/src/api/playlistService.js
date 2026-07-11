const API_BASE = 'http://localhost:5000/api/playlists';

export const playlistService = {
  // Get all playlists
  getPlaylists: async (page = 1, limit = 20) => {
    try {
      const response = await fetch(`${API_BASE}?page=${page}&limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch playlists');
      return await response.json();
    } catch (error) {
      console.error('Error fetching playlists:', error);
      throw error;
    }
  },

  // Get single playlist with songs
  getPlaylist: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`);
      if (!response.ok) throw new Error('Failed to fetch playlist');
      return await response.json();
    } catch (error) {
      console.error('Error fetching playlist:', error);
      throw error;
    }
  },

  // Update playlist
  updatePlaylist: async (id, playlistData) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(playlistData)
      });
      if (!response.ok) throw new Error('Failed to update playlist');
      return await response.json();
    } catch (error) {
      console.error('Error updating playlist:', error);
      throw error;
    }
  },

  // Delete playlist
  deletePlaylist: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete playlist');
      return await response.json();
    } catch (error) {
      console.error('Error deleting playlist:', error);
      throw error;
    }
  }
};