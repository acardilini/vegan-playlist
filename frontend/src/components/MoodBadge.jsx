function MoodBadge({ song, size = 'small' }) {
  // Only use custom_mood - no audio feature fallback
  const mood = song.custom_mood || null;

  if (!mood) return null;

  const labels = {
    energetic: 'Energetic',
    intense: 'Intense',
    chill: 'Chill',
    melancholic: 'Melancholic',
    danceable: 'Danceable',
    balanced: 'Balanced'
  };

  const label = labels[mood] || mood;

  return (
    <span
      className={`mood-badge${size === 'large' ? ' large' : ''}`}
      title={`Mood: ${label}`}
    >
      {label}
    </span>
  );
}

export default MoodBadge;
