// Pure wording for the artist merge preview. Lookups go through Map so an inherited property name such as 'constructor'
// can never come back as a label.
const FIELD_LABELS = new Map([
  ['bio', 'Bio'],
  ['vegan_advocacy_notes', 'Advocacy notes'],
  ['website_url', 'Website'],
  ['genres', 'Genres'],
  ['country', 'Country'],
  ['formed_year', 'Formed (year)'],
  ['disbanded_year', 'Disbanded (year)'],
  ['first_release_year', 'First release (year)'],
  ['last_release_year', 'Last release (year)'],
  ['thread_claims', 'Thread claims'],
]);
const IDENTITY_LABELS = new Map([['spotify', 'Spotify'], ['bandcamp', 'Bandcamp'], ['musicbrainz', 'MusicBrainz']]);

const fieldName = (f) => FIELD_LABELS.get(f) || String(f);
const identityName = (s) => IDENTITY_LABELS.get(s) || String(s);
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Which of two artists ({id, songs, live_songs}) should stay: more songs, then more live songs, then the lower id.
export function defaultKeeper(a, b) {
  if (a.songs !== b.songs) return a.songs > b.songs ? 'a' : 'b';
  if (a.live_songs !== b.live_songs) return a.live_songs > b.live_songs ? 'a' : 'b';
  return a.id <= b.id ? 'a' : 'b';
}

// The plain sentences shown under a merge preview (the server's `preview` result).
export function previewLines(p) {
  const k = p.keeper.name, l = p.loser.name;
  const lines = [];
  lines.push(p.songs.moving > 0 ? `${count(p.songs.moving, 'song moves', 'songs move')} to ${k}` : 'No songs move');
  if (p.songs.shared > 0) lines.push(`${p.songs.shared} ${p.songs.shared === 1 ? 'song is' : 'songs are'} on both and ${p.songs.shared === 1 ? 'stays' : 'stay'} once`);
  if (p.members.moving > 0 || p.members.skipped > 0) {
    lines.push(`${count(p.members.moving, 'member moves', 'members move')}, ${p.members.skipped} skipped as already listed`);
  }
  if (p.leads > 0) lines.push(`${count(p.leads, 'lead moves', 'leads move')} to ${k}`);
  if (p.fills.length > 0) lines.push(`Filled from ${l}: ${p.fills.map(fieldName).join(', ')}`);
  if (p.conflicts.length > 0) lines.push(`Kept as on ${k} (${l} differs): ${p.conflicts.map((c) => fieldName(c.field)).join(', ')}`);
  if (p.identity.carried.length > 0) lines.push(`${p.identity.carried.map(identityName).join(' / ')} link carried over`);
  if (p.identity.kept.length > 0) lines.push(`${p.identity.kept.map(identityName).join(' / ')} link kept as on ${k}`);
  lines.push(`${l} is removed. This cannot be undone from the screen; a snapshot of it is saved`);
  return lines;
}
