import { adminFetch } from '../../api/adminApi';

export const SOURCE_LABEL = { spotify: 'Spotify', bandcamp: 'Bandcamp', musicbrainz: 'MusicBrainz' };
export const SOURCES = Object.keys(SOURCE_LABEL);

export async function api(path, opts) {
  const r = await adminFetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.message || d.error || 'Request failed');
    err.artist = d.artist; // present on NO_IDENTITY: lets the view open the Identify step with the band's name
    throw err;
  }
  return d;
}
