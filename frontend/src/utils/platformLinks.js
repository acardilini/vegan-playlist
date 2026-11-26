// The "Listen on" row of the song page: Spotify first (it has its own columns), then the confirmed platform links the
// server sends. Order is fixed here, not by the server. Lookups go through Map, so a platform named 'constructor' is
// simply unknown. Text labels only: no logos.

const LABELS = new Map([
  ['spotify', 'Spotify'],
  ['apple_music', 'Apple Music'],
  ['deezer', 'Deezer'],
  ['tidal', 'Tidal'],
]);
const ORDER = ['spotify', 'apple_music', 'deezer', 'tidal'];
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

export function listenLinks({ spotify_url, spotify_dormant, platform_links } = {}) {
  const byKey = new Map();
  if (isHttp(spotify_url) && !spotify_dormant) byKey.set('spotify', spotify_url);
  for (const l of Array.isArray(platform_links) ? platform_links : []) {
    if (!l || !LABELS.has(l.platform) || l.platform === 'spotify' || !isHttp(l.url) || byKey.has(l.platform)) continue;
    byKey.set(l.platform, l.url);
  }
  return ORDER.filter((k) => byKey.has(k)).map((k) => ({ key: k, label: LABELS.get(k), url: byKey.get(k) }));
}
