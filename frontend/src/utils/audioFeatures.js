// Utility functions for working with audio features
export const getMoodFromFeatures = (song) => {
  const { energy, valence, danceability } = song;
  
  if (!energy || !valence || !danceability) return null;
  
  // High energy, high valence = Happy/Energetic
  if (energy > 0.7 && valence > 0.7) return 'energetic';
  
  // High energy, low valence = Aggressive/Intense
  if (energy > 0.7 && valence < 0.4) return 'intense';
  
  // Low energy, high valence = Chill/Happy
  if (energy < 0.4 && valence > 0.6) return 'chill';
  
  // Low energy, low valence = Sad/Melancholic
  if (energy < 0.4 && valence < 0.4) return 'melancholic';
  
  // High danceability = Danceable
  if (danceability > 0.8) return 'danceable';
  
  // Default
  return 'balanced';
};

export const getMoodColor = (mood) => {
  const colors = {
    energetic: '#ff6b6b',    // Red
    intense: '#ff8e53',      // Orange  
    chill: '#4ecdc4',        // Teal
    melancholic: '#95a5a6',  // Grey
    danceable: '#f39c12',    // Yellow
    balanced: '#3498db'      // Blue
  };
  
  return colors[mood] || colors.balanced;
};

export const getMoodLabel = (mood) => {
  const labels = {
    energetic: 'Energetic',
    intense: 'Intense',
    chill: 'Chill',
    melancholic: 'Melancholic', 
    danceable: 'Danceable',
    balanced: 'Balanced'
  };
  
  return labels[mood] || 'Unknown';
};

export const formatTempo = (tempo) => {
  if (!tempo) return null;
  return `${Math.round(tempo)} BPM`;
};

export const formatAudioFeature = (value, label) => {
  if (value === null || value === undefined) return null;
  
  const percentage = Math.round(value * 100);
  return `${label}: ${percentage}%`;
};

export const getKeySignature = (key, mode) => {
  if (key === null || key === undefined) return null;
  
  const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const keyName = keys[key];
  const modeName = mode === 1 ? 'Major' : 'Minor';
  
  return `${keyName} ${modeName}`;
};

export const formatPlaylistAddDate = (dateString) => {
  if (!dateString) return null;
  
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 30) {
    return `Added ${diffDays} days ago`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `Added ${months} month${months > 1 ? 's' : ''} ago`;
  } else {
    const years = Math.floor(diffDays / 365);
    return `Added ${years} year${years > 1 ? 's' : ''} ago`;
  }
};