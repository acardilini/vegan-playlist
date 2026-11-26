// Artist merge (piece 3): fold a duplicate artist (the loser) into the one that stays (the keeper). Admin-only. This is the
// only code that moves song_artists, so every read here is explicit and the merge itself is one transaction (Task 4).
// `preview` is read-only: it shows what would move and what would be left alone, plus a hash of everything it read so a
// merge can refuse if either artist changed in between. Nothing here may log an artist's text.
const crypto = require('node:crypto');
const { coded } = require('./bandCheck/errors');
const { nameKey } = require('./artistFacts');

// Fact fields compared between the two artists. A blank keeper value is filled from the loser, with its `*_source` when it
// has one; a differing pair is a conflict and the keeper's value wins. `discography_review_notes` is concatenated by the
// merge, so it is neither a fill nor a conflict; the flags, images and Spotify counts are the keeper's and are not listed.
const FIELDS = Object.freeze([
  'bio', 'vegan_advocacy_notes', 'website_url', 'genres', 'country', 'formed_year', 'disbanded_year',
  'first_release_year', 'last_release_year', 'thread_claims',
]);
// The source column that travels with a fact field.
const SOURCE_OF = Object.freeze({
  country: 'country_source', formed_year: 'formed_source', disbanded_year: 'disbanded_source',
  first_release_year: 'first_release_source', last_release_year: 'last_release_source',
});
// Identity source name -> artists column (bandCheck.saveIdentity is the single writer of these).
const IDENTITY = Object.freeze({ spotify: 'spotify_id', bandcamp: 'bandcamp_url', musicbrainz: 'musicbrainz_id' });

const isBlank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validId = (v) => Number.isInteger(v) && v > 0 && v <= 2147483647;

// Reads both artists and everything a merge would touch. With { lock } the two artist rows are locked FOR UPDATE (lower id
// first, so two merges cannot deadlock); only meaningful inside a transaction.
async function load(db, keeperId, loserId, { lock = false } = {}) {
  if (!validId(keeperId) || !validId(loserId)) throw coded('BAD_INPUT', 'Both artists must be given');
  if (keeperId === loserId) throw coded('BAD_INPUT', 'An artist cannot be merged into itself');
  const rows = (await db.query(`SELECT * FROM artists WHERE id = ANY($1) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [[keeperId, loserId]])).rows;
  const keeper = rows.find((r) => r.id === keeperId);
  const loser = rows.find((r) => r.id === loserId);
  if (!keeper || !loser) throw coded('NOT_FOUND', 'Artist not found');

  const links = async (artistId) => (await db.query(
    `SELECT sa.id, sa.song_id, (s.status = 'included' AND s.published) AS live
       FROM song_artists sa JOIN songs s ON s.id = sa.song_id
      WHERE sa.artist_id = $1 ORDER BY sa.id`, [artistId])).rows;
  const keeperLinks = await links(keeperId);
  const loserLinks = await links(loserId);
  const keeperMembers = (await db.query(`SELECT id, name FROM artist_members WHERE artist_id = $1 ORDER BY id`, [keeperId])).rows;
  const loserMembers = (await db.query(`SELECT id, name, is_current, vegan, source FROM artist_members WHERE artist_id = $1 ORDER BY id`, [loserId])).rows;
  const leadIds = (await db.query(`SELECT id FROM leads WHERE artist_id = $1 ORDER BY id`, [loserId])).rows.map((r) => r.id);

  const keeperSongs = new Set(keeperLinks.map((l) => l.song_id));
  const sharedSongIds = loserLinks.filter((l) => keeperSongs.has(l.song_id)).map((l) => l.song_id);
  // A loser member whose name key the keeper already has (or the loser lists twice) is left behind.
  const seen = new Set(keeperMembers.map((m) => nameKey(m.name)));
  const movingMembers = [];
  for (const m of loserMembers) {
    const key = nameKey(m.name);
    if (!seen.has(key)) { seen.add(key); movingMembers.push(m); }
  }
  return { keeper, loser, keeperLinks, loserLinks, keeperMembers, loserMembers, movingMembers, sharedSongIds, leadIds };
}

const side = (artist, links) => ({
  id: artist.id,
  name: artist.name,
  songs: new Set(links.map((l) => l.song_id)).size,
  live_songs: new Set(links.filter((l) => l.live).map((l) => l.song_id)).size,
});

// Hex sha1 of a stable JSON of everything the preview read: both artist rows (without updated_at), both artists' song
// links and members, and the loser's leads. A change to any of them between preview and merge changes it.
function hashOf(d) {
  const row = ({ updated_at, ...rest }) => rest; // eslint-disable-line no-unused-vars
  return crypto.createHash('sha1').update(JSON.stringify({
    keeper: row(d.keeper), loser: row(d.loser),
    keeperLinks: d.keeperLinks.map((l) => [l.id, l.song_id]), loserLinks: d.loserLinks.map((l) => [l.id, l.song_id]),
    keeperMembers: d.keeperMembers.map((m) => [m.id, m.name]), loserMembers: d.loserMembers.map((m) => [m.id, m.name]),
    leadIds: d.leadIds,
  })).digest('hex');
}

function summarise(d) {
  const { keeper, loser } = d;
  const fills = [], conflicts = [];
  for (const f of FIELDS) {
    if (isBlank(loser[f])) continue;
    if (isBlank(keeper[f])) fills.push(f);
    else if (!same(keeper[f], loser[f])) conflicts.push({ field: f, keeper: keeper[f], loser: loser[f] });
  }
  const carried = [], kept = [];
  for (const [name, col] of Object.entries(IDENTITY)) {
    if (isBlank(loser[col])) continue;
    if (isBlank(keeper[col])) carried.push(name);
    else if (String(keeper[col]) !== String(loser[col])) kept.push(name);
  }
  return {
    keeper: side(keeper, d.keeperLinks),
    loser: side(loser, d.loserLinks),
    songs: { moving: d.loserLinks.length - d.sharedSongIds.length, shared: d.sharedSongIds.length },
    members: { moving: d.movingMembers.length, skipped: d.loserMembers.length - d.movingMembers.length },
    leads: d.leadIds.length,
    fills, conflicts,
    identity: { carried, kept },
    hash: hashOf(d),
  };
}

// What merging `loserId` into `keeperId` would do. Read-only.
async function preview(db, keeperId, loserId) {
  return summarise(await load(db, keeperId, loserId));
}

module.exports = { FIELDS, SOURCE_OF, IDENTITY, load, summarise, hashOf, preview };
