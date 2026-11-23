// A "check this" link for a fact's source, built only from ids the artist already stores (admin screens only; public pages
// show no sources). Anything that is not a valid id or an http(s) url gives no link, so a bad stored value cannot become a
// clickable address.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sourceLink(source, artist) {
  const a = artist || {};
  if (source === 'MusicBrainz') return typeof a.musicbrainz_id === 'string' && UUID.test(a.musicbrainz_id) ? `https://musicbrainz.org/artist/${a.musicbrainz_id}` : null;
  if (source === 'Bandcamp') return typeof a.bandcamp_url === 'string' && /^https?:\/\//i.test(a.bandcamp_url) ? a.bandcamp_url : null;
  return null;
}
