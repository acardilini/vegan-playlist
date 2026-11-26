// Where "Back to Songs" goes from a song page: the rail the song was opened from (the rail rows pass `from: <queue>` in the
// navigation state), else the plain Songs page. SongsArea ignores a name it does not know, so a stale value is harmless.
export function songsBackLink(navState) {
  const from = navState && typeof navState.from === 'string' ? navState.from : '';
  return from ? `/admin/songs?queue=${encodeURIComponent(from)}` : '/admin/songs';
}
