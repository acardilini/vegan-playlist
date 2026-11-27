// Pure labels for the artist enrichment review. Lookups go through Map so an inherited property name such as
// 'constructor' can never come back as a label.
const METHODS = new Map([
  ['MB_SPOTIFY_URL', 'Matched by your Spotify link'],
  ['WIKIDATA_P1902', 'Matched through Wikidata'],
  ['MB_TITLE_VERIFIED', 'Matched by title, needs your check'],
  ['EXISTING', 'Already saved'],
]);
const CONFIDENCE = new Map([['EXACT_ID', 'Exact'], ['HIGH', 'High']]);
const FIELDS = new Map([
  ['country', 'Country'],
  ['formed_year', 'Formed (year)'],
  ['disbanded_year', 'Disbanded (year)'],
  ['first_release_year', 'First release (year)'],
  ['last_release_year', 'Last release (year)'],
  ['bandcamp_url', 'Bandcamp link'],
]);
const STATES = new Map([
  ['none', 'No match proposed'],
  ['pretrusted', 'Exact match, ready to accept'],
  ['needs-approval', 'Match needs your approval'],
  ['approved', 'Match approved'],
  ['rejected', 'Match rejected'],
]);

export function methodLabel(method) {
  return METHODS.get(method) || 'Unknown method';
}

export function confidenceLabel(c) {
  if (c === null || c === undefined) return '';
  return CONFIDENCE.get(c) || String(c);
}

export function fieldLabel(field) {
  if (field === null || field === undefined) return '';
  return FIELDS.get(field) || String(field);
}

export function stateLabel(state) {
  if (state === null || state === undefined) return '';
  return STATES.get(state) || String(state);
}

// What Accept all applied, as labels: 'match', 'member:<name>' or a field key (order kept).
export function acceptedSummary(applied) {
  if (!Array.isArray(applied)) return [];
  return applied.map((a) => {
    if (typeof a === 'string' && a.startsWith('member:')) return `Member: ${a.slice('member:'.length)}`;
    if (a === 'match') return 'MusicBrainz match approved';
    return fieldLabel(a);
  });
}

// A Spotify artist page for a stored Spotify id; anything that is not a 22-character base-62 id gives no link.
export function spotifyArtistLink(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id) ? `https://open.spotify.com/artist/${id}` : null;
}

// "Name (1999)" per album, "Name" when the year is unknown, joined into one line.
export function albumLine(albums) {
  if (!Array.isArray(albums)) return '';
  return albums.map((a) => (a && a.year != null ? `${a.name} (${a.year})` : a && a.name)).filter(Boolean).join(', ');
}
