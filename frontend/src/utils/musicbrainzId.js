// The MusicBrainz artist id (lower-case UUID) from what a curator pastes: the bare id or a musicbrainz.org/artist/<id> page
// address (any scheme or subdomain, a trailing slash, /edit, ?query or #hash). Anything else, including a release page, is null.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE = new RegExp(`^${UUID}$`, 'i');
const URL_FORM = new RegExp(`^(?:https?://)?(?:[a-z0-9-]+\\.)*musicbrainz\\.org/artist/(${UUID})(?:[/?#].*)?$`, 'i');

export function parseMusicBrainzId(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (BARE.test(t)) return t.toLowerCase();
  const m = URL_FORM.exec(t);
  return m ? m[1].toLowerCase() : null;
}
