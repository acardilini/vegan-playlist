// Pure parsing of a MusicBrainz artist (with artist-rels) and its release groups into the facts the Facts panel proposes.
// No network, no database: the adapter does the reads. Anything MusicBrainz lacks comes back null, never undefined.
const STUDIO_TYPES = new Set(['Album', 'EP', 'Single']);
const EXCLUDED_SECONDARY = new Set(['Live', 'Compilation', 'Remix', 'Demo']);
const NOT_A_MEMBER = new Set(['live', 'touring']);

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || code === 'ZZ' || code.startsWith('X')) return null; // X* are MusicBrainz's special areas (XW = worldwide)
  try { const n = regionNames.of(code); return n && n !== code && !/^Unknown/i.test(n) ? n : null; } catch { return null; }
}

const yearOf = (date) => { const m = /^(\d{4})/.exec(String(date || '')); return m ? parseInt(m[1], 10) : null; };

function parseMembers(relations) {
  const byName = new Map();
  for (const r of relations || []) {
    if (r.type !== 'member of band' || r.direction !== 'backward' || !r.artist || !r.artist.name) continue;
    if ((r.attributes || []).some((a) => NOT_A_MEMBER.has(String(a).toLowerCase()))) continue;
    const is_current = !r.ended && !r.end;
    const prior = byName.get(r.artist.name);
    if (!prior || (is_current && !prior.is_current)) byName.set(r.artist.name, { name: r.artist.name, is_current });
  }
  return [...byName.values()];
}

function lastReleaseYear(groups) {
  let best = null;
  for (const g of groups || []) {
    if (!STUDIO_TYPES.has(g['primary-type'])) continue;
    if ((g['secondary-types'] || []).some((t) => EXCLUDED_SECONDARY.has(t))) continue;
    const y = yearOf(g['first-release-date']);
    if (y && (best === null || y > best)) best = y;
  }
  return best;
}

function parseFacts(artist = {}, releaseGroups = []) {
  const life = artist['life-span'] || {};
  return {
    name: artist.name || null,
    country: countryName(artist.country),
    formed_year: yearOf(life.begin),
    disbanded_year: life.ended === true ? yearOf(life.end) : null,
    last_release_year: lastReleaseYear(releaseGroups),
    members: parseMembers(artist.relations),
  };
}

module.exports = { parseFacts };
