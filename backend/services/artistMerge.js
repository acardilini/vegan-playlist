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

// Overridable only so a test can inject a failure into the identity step.
const _deps = { saveIdentity: (...args) => require('./bandCheck').saveIdentity(...args) };

// Merges `loserId` into `keeperId` in ONE transaction; `hash` is the preview the curator saw. The keeper's values win; its
// blank fields are filled from the loser; the loser's songs, members and leads move; the loser row is snapshotted into
// artist_merges and deleted. Identity ids go through bandCheck.saveIdentity (the single writer) after the delete, which
// frees the loser's unique MusicBrainz / Spotify ids. Any error rolls everything back and is rethrown unchanged.
async function merge(pool, keeperId, loserId, hash) {
  if (typeof hash !== 'string' || !hash) throw coded('BAD_INPUT', 'Open the merge preview first');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = await load(client, keeperId, loserId, { lock: true });
    const pv = summarise(d);
    if (pv.hash !== hash) throw coded('CONFLICT', 'These artists changed since the preview; open it again');
    const { keeper, loser } = d;

    await client.query(`INSERT INTO artist_merges (loser_id, keeper_id, loser_snapshot) VALUES ($1, $2, $3)`, [loserId, keeperId, JSON.stringify({
      artist: loser,
      song_artists: d.loserLinks.map((l) => ({ id: l.id, song_id: l.song_id })),
      members: d.loserMembers,
      lead_ids: d.leadIds,
    })]);

    // UPDATE (not delete + insert) so each row keeps its id: a song's artist order is song_artists.id order.
    const songs = await client.query(
      `UPDATE song_artists SET artist_id = $1
        WHERE artist_id = $2 AND song_id NOT IN (SELECT song_id FROM song_artists WHERE artist_id = $1)`, [keeperId, loserId]);
    const members = d.movingMembers.length
      ? await client.query(`UPDATE artist_members SET artist_id = $1 WHERE id = ANY($2)`, [keeperId, d.movingMembers.map((m) => m.id)])
      : { rowCount: 0 };
    const leads = await client.query(`UPDATE leads SET artist_id = $1 WHERE artist_id = $2`, [keeperId, loserId]);

    // Blank keeper fields (field names come from the fixed FIELDS list) take the loser's value and its source.
    const sets = [], params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    for (const f of pv.fills) {
      set(f, loser[f]);
      if (SOURCE_OF[f]) set(SOURCE_OF[f], loser[SOURCE_OF[f]]);
    }
    if (!isBlank(loser.discography_review_notes)) {
      const line = `Merged from ${loser.name} (${new Date().toISOString().slice(0, 10)}): ${loser.discography_review_notes}`;
      set('discography_review_notes', isBlank(keeper.discography_review_notes) ? line : `${keeper.discography_review_notes}\n\n${line}`);
    }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(keeperId);
    await client.query(`UPDATE artists SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    // Remaining song_artists (shared songs), members, proposals and review rows of the loser go with it (ON DELETE CASCADE).
    await client.query(`DELETE FROM artists WHERE id = $1`, [loserId]);
    for (const source of pv.identity.carried) await _deps.saveIdentity(client, keeperId, source, String(loser[IDENTITY[source]]));

    await client.query('COMMIT');
    return { merged: true, keeper: { id: keeperId }, moved: { songs: songs.rowCount, members: members.rowCount, leads: leads.rowCount } };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* the original error is the one to report */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { FIELDS, SOURCE_OF, IDENTITY, load, summarise, hashOf, preview, merge, _deps };
