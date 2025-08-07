function MoodBadge({ song, size = 'small' }) {
  const getMoodFromSong = (song) => {
    // Only use custom_mood - no audio feature fallback
    return song.custom_mood || null;
  };

  const getMoodColor = (mood) => {
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

  const getMoodEmoji = (mood) => {
    const emojis = {
      energetic: '⚡',
      intense: '🔥',
      chill: '🌊',
      melancholic: '🌙',
      danceable: '💃',
      balanced: '⚖️'
    };
    
    return emojis[mood] || '🎵';
  };

  const getMoodLabel = (mood) => {
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
  
  const mood = getMoodFromSong(song);
  
  if (!mood) return null;
  
  const color = getMoodColor(mood);
  const emoji = getMoodEmoji(mood);
  const label = getMoodLabel(mood);
  
  const styles = {
    small: {
      fontSize: '0.7rem',
      padding: '2px 6px',
      borderRadius: '10px'
    },
    large: {
      fontSize: '0.8rem', 
      padding: '4px 8px',
      borderRadius: '12px'
    }
  };
  
  return (
    <span 
      className="mood-badge"
      style={{
        backgroundColor: color,
        color: 'white',
        fontWeight: '500',
        display: 'inline-block',
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        ...styles[size]
      }}
      title={`Mood: ${label}`}
    >
      {emoji} {label}
    </span>
  );
}

export default MoodBadge;