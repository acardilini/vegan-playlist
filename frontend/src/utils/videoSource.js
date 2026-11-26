// Which of a song's videos the audio analysis hears (the workbench marks it `is_audio_source`), and so the one the
// top bar's Listen link opens. Falls back to the primary, then the first video, so the link works on any song that has one.
export function audioSourceVideo(videos) {
  if (!Array.isArray(videos) || videos.length === 0) return null;
  return videos.find((v) => v && v.is_audio_source) || videos.find((v) => v && v.is_primary) || videos[0] || null;
}

// The YouTube watch page of that video, only for a well-formed 11-character id (it goes into an href).
export function listenUrl(videos) {
  const v = audioSourceVideo(videos);
  return v && /^[a-zA-Z0-9_-]{11}$/.test(String(v.youtube_id || '')) ? `https://www.youtube.com/watch?v=${v.youtube_id}` : null;
}
