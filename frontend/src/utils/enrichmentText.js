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
