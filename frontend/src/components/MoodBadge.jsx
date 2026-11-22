function MoodBadge({ song, size = 'small' }) {
  // `mood` is the song's first-listed musical mood from the audio analysis, already a display label.
  const label = song.mood || null;

  if (!label) return null;

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
