// Artist enrichment review (piece 2). The analysis project stages one proposal per artist in
// artist_enrichment_proposals; this service only ever READS that table. The curator's decisions live in the web-owned
// artist_enrichment_review (match decision + finished flag); accepted values are written through the existing single
// writers (see the write side at the bottom).
// The queue predicates live in ONE table below and feed both counts() and list(), so a rail count cannot disagree with its list.
const { coded } = require('./bandCheck/errors');
const { normalizeBandcampOrigin } = require('./bandCheck/bandcamp');
const { getFacts, nameKey, SOURCE_NAMES, saveFacts, addMember, updateMember } = require('./artistFacts');

const QUEUES = [
  { key: 'enr-review', label: 'To review' },
  { key: 'enr-match', label: 'Match to approve' },
  { key: 'enr-dupes', label: 'Possible duplicates' },
  { key: 'enr-done', label: 'Done' },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = new Set(SOURCE_NAMES);
const LOCKABLE = new Set(['MusicBrainz', 'Wikidata']);
const mbUrl = (id) => (typeof id === 'string' && UUID.test(id) ? `https://musicbrainz.org/artist/${id.toLowerCase()}` : null);
const lowerId = (id) => (id ? String(id).toLowerCase() : null);

// ---- pure rules ----------------------------------------------------------------------------------------------------

// The state of the proposed MusicBrainz match. It follows the identity stored NOW, not the decision history: only the
// proposed id being the stored one makes it approved, so clearing or replacing the id under Links locks its rows again.
// A decision about a different id than the one now proposed is ignored.
function matchState(proposal, review, storedMbid) {
  const proposed = lowerId(proposal && proposal.proposed_musicbrainz_id);
  if (!proposed) return 'none';
  const stored = lowerId(storedMbid);
  if (stored === proposed) return 'approved';
  const decided = review && review.match_decision && lowerId(review.matched_mbid) === proposed ? review.match_decision : null;
  if (decided === 'rejected') return 'rejected';
  // An earlier approval whose id is no longer stored, a different id stored now, or an EXISTING match (the stored id the
  // analysis started from) that is not the stored one: the curator decides again.
  if (decided === 'approved' || stored || proposal.mbid_match_method === 'EXISTING') return 'needs-approval';
  if (proposal.mbid_confidence === 'EXACT_ID') return 'pretrusted';
  return 'needs-approval'; // HIGH, and an unknown confidence treated as the cautious case
}

// A fact from MusicBrainz or Wikidata rides on the match: it stays locked until the match is trusted.
const isLocked = (source, state) => LOCKABLE.has(source) && state !== 'pretrusted' && state !== 'approved';

function buildWarnings({ proposal, stored, catalogue, proposedMembers, sharedWith }) {
  const w = [];
  const last = proposal.proposed_last_release_year, disb = proposal.proposed_disbanded_year, formed = proposal.proposed_formed_year;
  if (last != null && catalogue.last_year != null && last < catalogue.last_year) {
    w.push({ field: 'last_release_year', text: `Proposed last release ${last} is earlier than the catalogue's latest album (${catalogue.last_year})` });
  }
  const lastRef = last != null ? last : stored.last_release_year;
  if (disb != null && lastRef != null && disb < lastRef) {
    w.push({ field: 'disbanded_year', text: `Proposed disbanded year ${disb} is earlier than the ${last != null ? 'proposed' : 'stored'} last release (${lastRef})` });
  }
  if (formed != null && catalogue.first_year != null && formed > catalogue.first_year) {
    w.push({ field: 'formed_year', text: `Proposed formed year ${formed} is later than the catalogue's earliest album (${catalogue.first_year})` });
  }
  if (proposal.artist_type === 'Person' && proposedMembers.length) {
    w.push({ field: 'members', text: `MusicBrainz lists this artist as a Person, but ${proposedMembers.length} member${proposedMembers.length === 1 ? ' is' : 's are'} proposed` });
  }
  if (sharedWith.length) {
    w.push({ field: 'match', text: `This MusicBrainz id is also proposed for or stored on: ${sharedWith.map((s) => s.name).join(', ')}` });
  }
  return w;
}

// proposed_members entries the analysis wrote; anything without a name, a true/false status and a known source is dropped.
function cleanMembers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [], seen = new Set();
  for (const m of raw) {
    if (!m || typeof m !== 'object' || typeof m.name !== 'string' || !m.name.trim()) continue;
    if (typeof m.is_current !== 'boolean' || !SOURCES.has(m.source)) continue;
    const k = nameKey(m.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: m.name.trim(), is_current: m.is_current, source: m.source }); // the proposed vegan flag never passes through
  }
  return out;
}

const FIELDS = [
  { field: 'country', label: 'Country', prefix: 'country' },
  { field: 'formed_year', label: 'Formed', prefix: 'formed' },
  { field: 'disbanded_year', label: 'Disbanded', prefix: 'disbanded' },
  { field: 'last_release_year', label: 'Last release', prefix: 'last_release' },
];

function linkFor(source, proposal) {
  if (source === 'MusicBrainz') return mbUrl(proposal.proposed_musicbrainz_id);
  if (source === 'Bandcamp') return normalizeBandcampOrigin(proposal.proposed_bandcamp_url);
  return null;
}

function buildFields(proposal, stored, state) {
  const out = [];
  for (const { field, label, prefix } of FIELDS) {
    let proposed = proposal[`proposed_${field}`];
    const source = proposal[`${prefix}_source`];
    if (proposed === null || proposed === undefined || !SOURCES.has(source)) continue;
    if (typeof proposed === 'string') { proposed = proposed.trim(); if (!proposed) continue; }
    const current = stored[field] === undefined ? null : stored[field];
    if (proposed === current) continue;
    out.push({ field, label, current, proposed, source, confidence: proposal[`${prefix}_confidence`] || null,
      link: linkFor(source, proposal), locked: isLocked(source, state) });
  }
  const origin = normalizeBandcampOrigin(proposal.proposed_bandcamp_url);
  if (origin && origin !== normalizeBandcampOrigin(stored.bandcamp_url)) {
    out.push({ field: 'bandcamp_url', label: 'Bandcamp', current: stored.bandcamp_url || null, proposed: origin, source: 'Bandcamp',
      confidence: null, link: origin, locked: isLocked('Bandcamp', state) });
  }
  return out;
}

// Same rule as artistFacts.proposeFromMusicBrainz: new names and status changes only, never a delete.
function buildMembers(proposedMembers, storedMembers, state) {
  const byKey = new Map(storedMembers.map((m) => [nameKey(m.name), m]));
  const out = [];
  for (const m of proposedMembers) {
    const have = byKey.get(nameKey(m.name));
    const base = { name: m.name, is_current: m.is_current, source: m.source };
    if (!have) out.push({ ...base, change: 'new', existing: null, locked: isLocked(m.source, state) });
    else if (have.is_current !== m.is_current) {
      out.push({ ...base, change: 'status', existing: { id: have.id, is_current: have.is_current, vegan: have.vegan }, locked: isLocked(m.source, state) });
    }
  }
  return out;
}

// ---- queues --------------------------------------------------------------------------------------------------------
// FROM clause shared by every queue query: artists with a proposal, plus their review row if any.
const FROM = `FROM artists a
  JOIN artist_enrichment_proposals p ON p.artist_id = a.id
  LEFT JOIN artist_enrichment_review r ON r.artist_id = a.id`;

const SRC_LIST = SOURCE_NAMES.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
const okSource = (col) => `p.${col} IN (${SRC_LIST})`;
const bcOrigin = (expr) => `lower(substring(${expr} from '^https?://([^/?#]+)'))`;

// "Has something to review", in SQL. This is an APPROXIMATION of what getReview shows (e.g. it does not trim text,
// it treats any http(s) host as a Bandcamp origin and it only counts brand-new member names, not status changes), so
// an artist in the queue can occasionally open to "nothing to review". The queue errs on the side of showing.
const HAS_SOMETHING = `(
  (p.proposed_musicbrainz_id IS NOT NULL AND p.proposed_musicbrainz_id IS DISTINCT FROM a.musicbrainz_id)
  OR (p.proposed_country IS NOT NULL AND ${okSource('country_source')} AND p.proposed_country IS DISTINCT FROM a.country)
  OR (p.proposed_formed_year IS NOT NULL AND ${okSource('formed_source')} AND p.proposed_formed_year IS DISTINCT FROM a.formed_year)
  OR (p.proposed_disbanded_year IS NOT NULL AND ${okSource('disbanded_source')} AND p.proposed_disbanded_year IS DISTINCT FROM a.disbanded_year)
  OR (p.proposed_last_release_year IS NOT NULL AND ${okSource('last_release_source')} AND p.proposed_last_release_year IS DISTINCT FROM a.last_release_year)
  OR (${bcOrigin('p.proposed_bandcamp_url')} LIKE '%.bandcamp.com' AND ${bcOrigin('p.proposed_bandcamp_url')} IS DISTINCT FROM ${bcOrigin('a.bandcamp_url')})
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.proposed_members) = 'array' THEN p.proposed_members ELSE '[]'::jsonb END) m
             WHERE jsonb_typeof(m) = 'object' AND COALESCE(btrim(m->>'name'), '') <> ''
               AND NOT EXISTS (SELECT 1 FROM artist_members am WHERE am.artist_id = a.id AND lower(am.name) = lower(btrim(m->>'name'))))
)`;
const BASE = `(r.finished_at IS NULL AND ${HAS_SOMETHING})`;
// A match waiting for the curator's Approve: matchState's 'needs-approval' in SQL (an id is proposed and not stored, it
// was not rejected, and it is not a pre-trusted EXACT_ID: an earlier approval without the id stored, a different stored
// id or an EXISTING method all need approval again). It does not mirror getReview's downgrade of a shared EXACT_ID id;
// those artists are listed under Possible duplicates instead.
const MATCH_PENDING = `(p.proposed_musicbrainz_id IS NOT NULL
  AND p.proposed_musicbrainz_id IS DISTINCT FROM a.musicbrainz_id
  AND NOT COALESCE(r.match_decision = 'rejected' AND r.matched_mbid = p.proposed_musicbrainz_id, false)
  AND (p.mbid_confidence IS DISTINCT FROM 'EXACT_ID' OR a.musicbrainz_id IS NOT NULL
       OR p.mbid_match_method IS NOT DISTINCT FROM 'EXISTING'
       OR COALESCE(r.match_decision = 'approved' AND r.matched_mbid = p.proposed_musicbrainz_id, false)))`;
// Another artist proposes or stores the same MusicBrainz id.
const SHARED = `(p.proposed_musicbrainz_id IS NOT NULL AND (
  EXISTS (SELECT 1 FROM artist_enrichment_proposals p2 WHERE p2.proposed_musicbrainz_id = p.proposed_musicbrainz_id AND p2.artist_id <> a.id)
  OR EXISTS (SELECT 1 FROM artists a2 WHERE a2.musicbrainz_id = p.proposed_musicbrainz_id AND a2.id <> a.id)))`;

const PREDICATE = new Map([
  ['enr-review', BASE],
  ['enr-match', `(${BASE} AND ${MATCH_PENDING})`],
  ['enr-dupes', `(${BASE} AND ${SHARED})`],
  ['enr-done', `(r.finished_at IS NOT NULL)`],
]);
const ORDER = {
  'enr-review': 'pending DESC, shared DESC, songs DESC, lower(name), id',
  'enr-match': 'pending DESC, shared DESC, songs DESC, lower(name), id',
  'enr-dupes': 'songs DESC, lower(name), id',
  'enr-done': 'songs DESC, lower(name), id',
};

const like = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

async function counts(db) {
  const cols = [...PREDICATE].map(([k, p]) => `count(*) FILTER (WHERE ${p})::int AS "${k}"`).join(', ');
  return (await db.query(`SELECT ${cols} ${FROM}`)).rows[0];
}

async function list(db, { queue, q = '', limit = 50, offset = 0 } = {}) {
  const pred = PREDICATE.get(queue);
  if (!pred) throw coded('BAD_INPUT', 'Unknown queue');
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200), off = Math.max(parseInt(offset) || 0, 0);
  const pat = q ? `%${like(q)}%` : null;
  // One filter, built once, used by BOTH queries.
  const where = `WHERE ${pred} AND ($1::text IS NULL OR a.name ILIKE $1)`;
  const total = (await db.query(`SELECT count(*)::int AS n ${FROM} ${where}`, [pat])).rows[0].n;
  const rows = (await db.query(`
    SELECT id, name, method, confidence, shared, pending, songs, live_songs FROM (
      SELECT a.id, a.name, p.mbid_match_method AS method, p.mbid_confidence AS confidence,
             ${SHARED} AS shared, ${MATCH_PENDING} AS pending,
             (SELECT COUNT(DISTINCT sa.song_id)::int FROM song_artists sa WHERE sa.artist_id = a.id) AS songs,
             (SELECT COUNT(DISTINCT sa.song_id)::int FROM song_artists sa JOIN songs s ON s.id = sa.song_id
               WHERE sa.artist_id = a.id AND s.status = 'included' AND s.published) AS live_songs
      ${FROM} ${where}) x
    ORDER BY ${ORDER[queue]}
    LIMIT $2 OFFSET $3`, [pat, lim, off])).rows;
  return {
    total,
    rows: rows.map((r) => ({ id: r.id, name: r.name, songs: r.songs, live_songs: r.live_songs,
      enrichment: { method: r.method, confidence: r.confidence, shared: !!r.shared } })),
  };
}

// ---- one artist ----------------------------------------------------------------------------------------------------

async function catalogueOf(db, artistId) {
  const n = (await db.query(`
    SELECT COUNT(DISTINCT sa.song_id)::int AS songs,
           (COUNT(DISTINCT sa.song_id) FILTER (WHERE s.status = 'included' AND s.published))::int AS live_songs
    FROM song_artists sa JOIN songs s ON s.id = sa.song_id WHERE sa.artist_id = $1`, [artistId])).rows[0];
  const albums = (await db.query(`
    SELECT DISTINCT al.id, al.name, EXTRACT(YEAR FROM al.release_date)::int AS year
    FROM song_artists sa JOIN songs s ON s.id = sa.song_id JOIN albums al ON al.id = s.album_id
    WHERE sa.artist_id = $1
    ORDER BY year NULLS LAST, al.name, al.id`, [artistId])).rows;
  const years = albums.map((a) => a.year).filter((y) => y != null);
  return {
    songs: n.songs, live_songs: n.live_songs,
    first_year: years.length ? Math.min(...years) : null,
    last_year: years.length ? Math.max(...years) : null,
    albums: albums.map((a) => ({ name: a.name, year: a.year })),
  };
}

async function sharedWith(db, artistId, mbid) {
  if (!mbid) return [];
  return (await db.query(`
    SELECT a.id, a.name, (SELECT COUNT(DISTINCT sa.song_id)::int FROM song_artists sa WHERE sa.artist_id = a.id) AS songs
    FROM artists a
    WHERE a.id <> $1 AND (a.musicbrainz_id = $2
      OR EXISTS (SELECT 1 FROM artist_enrichment_proposals p WHERE p.artist_id = a.id AND p.proposed_musicbrainz_id = $2))
    ORDER BY songs DESC, lower(a.name), a.id`, [artistId, mbid])).rows;
}

const PROPOSAL_COLS = `proposed_musicbrainz_id, mbid_match_method, mbid_confidence, artist_type,
  proposed_country, country_source, country_confidence, proposed_formed_year, formed_source, formed_confidence,
  proposed_disbanded_year, disbanded_source, disbanded_confidence, proposed_last_release_year, last_release_source,
  last_release_confidence, proposed_bandcamp_url, proposed_members`;

async function getReview(db, artistId) {
  const artist = (await db.query(`SELECT id, musicbrainz_id, bandcamp_url FROM artists WHERE id = $1`, [artistId])).rows[0];
  if (!artist) throw coded('NOT_FOUND', 'Artist not found');
  // Explicit columns only: the Layer 4 / website / Wikidata / Wikipedia columns of the proposals table are never read.
  const proposal = (await db.query(`SELECT ${PROPOSAL_COLS} FROM artist_enrichment_proposals WHERE artist_id = $1`, [artistId])).rows[0];
  if (!proposal) return { has_proposal: false };
  const review = (await db.query(`SELECT match_decision, matched_mbid, finished_at FROM artist_enrichment_review WHERE artist_id = $1`, [artistId])).rows[0] || null;
  const facts = await getFacts(db, artistId);
  const stored = { ...facts, bandcamp_url: artist.bandcamp_url };
  const proposedMbid = lowerId(proposal.proposed_musicbrainz_id);
  const [catalogue, shared] = [await catalogueOf(db, artistId), await sharedWith(db, artistId, proposedMbid)];
  // An EXACT_ID match is only pre-trusted while no other artist proposes or stores the same id; a shared id needs the
  // curator's approval, so its MusicBrainz/Wikidata rows stay locked (and the 'match' warning says why).
  let state = matchState(proposal, review, artist.musicbrainz_id);
  if (state === 'pretrusted' && shared.length) state = 'needs-approval';
  const proposedMembers = cleanMembers(proposal.proposed_members);
  return {
    has_proposal: true,
    artist_type: proposal.artist_type || null,
    finished_at: review ? review.finished_at : null,
    match: {
      state, proposed_mbid: proposedMbid, stored_mbid: lowerId(artist.musicbrainz_id),
      method: proposal.mbid_match_method || null, confidence: proposal.mbid_confidence || null,
      url: mbUrl(proposedMbid), shared_with: shared, catalogue,
    },
    fields: buildFields(proposal, stored, state),
    members: buildMembers(proposedMembers, facts.members, state),
    warnings: buildWarnings({ proposal, stored, catalogue, proposedMembers, sharedWith: shared }),
  };
}

// ---- write side ----------------------------------------------------------------------------------------------------
// Every write re-reads the proposal and the stored values through getReview; the client names only a decision, a field
// or a member. Writes go through the existing single writers (bandCheck.saveIdentity, artistFacts.saveFacts/addMember/
// updateMember). artist_enrichment_proposals is never written.

const FIELD_KEYS = new Set([...FIELDS.map((f) => f.field), 'bandcamp_url']);
const PREFIX = new Map(FIELDS.map((f) => [f.field, f.prefix]));
const DECISIONS = new Set(['approve', 'reject', 'clear']);
const OUR_CODES = new Set(['NOT_FOUND', 'BAD_INPUT', 'CONFLICT', 'BUSY', 'NO_IDENTITY']);
const memberLabel = (name) => `member:${name}`;

// Lazy: bandCheck/index pulls in staging and curation, which this read-mostly service otherwise never needs.
const saveIdentity = (...args) => require('./bandCheck/index').saveIdentity(...args);

async function reviewWithProposal(db, artistId) {
  const r = await getReview(db, artistId); // NOT_FOUND for an unknown artist
  if (!r.has_proposal) throw coded('NOT_FOUND', 'No proposal for this artist');
  return r;
}

// One upsert per column group: a decision never touches finished_at, and finishing never touches the decision.
async function upsertDecision(q, artistId, decision, mbid) {
  await q.query(`INSERT INTO artist_enrichment_review (artist_id, match_decision, matched_mbid, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (artist_id) DO UPDATE SET match_decision = EXCLUDED.match_decision, matched_mbid = EXCLUDED.matched_mbid,
      updated_at = CURRENT_TIMESTAMP`, [artistId, decision, mbid]);
}
async function upsertFinished(q, artistId, finished) {
  await q.query(`INSERT INTO artist_enrichment_review (artist_id, finished_at, updated_at)
    VALUES ($1, CASE WHEN $2::boolean THEN CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP)
    ON CONFLICT (artist_id) DO UPDATE SET finished_at = EXCLUDED.finished_at, updated_at = CURRENT_TIMESTAMP`, [artistId, finished]);
}

// Identity and decision land together or not at all: a CONFLICT from saveIdentity rolls back and leaves no review row.
async function approveMatch(db, artistId, review) {
  const mbid = review.match.proposed_mbid;
  if (!mbid) throw coded('BAD_INPUT', 'No MusicBrainz id is proposed');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await saveIdentity(client, artistId, 'musicbrainz', mbid);
    await upsertDecision(client, artistId, 'approved', mbid);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* the original error matters */ }
    throw e;
  } finally {
    client.release();
  }
}

async function decideMatch(db, artistId, decision) {
  if (typeof decision !== 'string' || !DECISIONS.has(decision)) throw coded('BAD_INPUT', 'Unknown decision');
  const r = await reviewWithProposal(db, artistId);
  const { proposed_mbid: proposed, stored_mbid: stored } = r.match;
  if (decision === 'approve') await approveMatch(db, artistId, r);
  else if (decision === 'reject') {
    if (!proposed) throw coded('BAD_INPUT', 'No MusicBrainz id is proposed');
    if (stored === proposed) throw coded('BAD_INPUT', 'That id is already saved; clear it under Links first');
    await upsertDecision(db, artistId, 'rejected', proposed);
  } else {
    // Only a rejection can be undone: clearing an approval would make an EXACT_ID match pre-trusted again, and Accept all
    // would re-write an id the curator removed under Links.
    const row = (await db.query(`SELECT match_decision FROM artist_enrichment_review WHERE artist_id = $1`, [artistId])).rows[0];
    if (!row || row.match_decision !== 'rejected') throw coded('BAD_INPUT', 'Only a rejected match can be undone');
    await upsertDecision(db, artistId, null, null);
  }
  return getReview(db, artistId);
}

// The one row-accept path, shared by acceptField and acceptAll.
async function applyField(db, artistId, row) {
  if (row.locked) throw coded('CONFLICT', 'Approve the match first');
  if (row.field === 'bandcamp_url') await saveIdentity(db, artistId, 'bandcamp', row.proposed);
  else {
    const prefix = PREFIX.get(row.field);
    await saveFacts(db, artistId, { [row.field]: row.proposed, [`${prefix}_source`]: row.source });
  }
}
async function applyMember(db, artistId, row) {
  if (row.locked) throw coded('CONFLICT', 'Approve the match first');
  if (row.change === 'new') await addMember(db, artistId, { name: row.name, is_current: row.is_current, vegan: false, source: row.source });
  else await updateMember(db, artistId, row.existing.id, { is_current: row.is_current }); // vegan and source untouched
}

async function acceptField(db, artistId, field) {
  if (typeof field !== 'string' || !FIELD_KEYS.has(field)) throw coded('BAD_INPUT', 'Unknown field');
  const r = await reviewWithProposal(db, artistId);
  const row = r.fields.find((f) => f.field === field);
  if (!row) throw coded('NOT_FOUND', 'Nothing proposed for that field');
  await applyField(db, artistId, row);
  return getReview(db, artistId);
}

async function acceptMember(db, artistId, name) {
  if (typeof name !== 'string' || !name.trim()) throw coded('BAD_INPUT', 'Name is required');
  const r = await reviewWithProposal(db, artistId);
  const key = nameKey(name);
  const row = r.members.find((m) => nameKey(m.name) === key);
  if (!row) {
    // No pending change: fine if that member is already stored as proposed, otherwise there is nothing to accept.
    const stored = (await getFacts(db, artistId)).members.some((m) => nameKey(m.name) === key);
    if (!stored) throw coded('NOT_FOUND', 'Nothing proposed for that member');
    return r;
  }
  await applyMember(db, artistId, row);
  return getReview(db, artistId);
}

const failMessage = (e) => (e && OUR_CODES.has(e.code) && typeof e.message === 'string' ? e.message : 'Could not save this change');

async function acceptAll(db, artistId) {
  let r = await reviewWithProposal(db, artistId);
  const applied = [], skipped = [];
  // Warnings are taken from the review as first read, before anything is applied.
  const warned = new Set(r.warnings.map((w) => w.field));
  let approveBlocked = false;
  const undecided = r.match.state === 'pretrusted' || r.match.state === 'needs-approval';
  if (undecided && warned.has('match')) {
    // Never auto-approve a warned (shared-id) match. getReview already downgrades such a match to needs-approval;
    // this guard holds even if that ever changes.
    approveBlocked = true;
    skipped.push({ field: 'match', reason: 'warning' });
  } else if (r.match.state === 'pretrusted') {
    try { await approveMatch(db, artistId, r); applied.push('match'); }
    catch (e) { approveBlocked = true; skipped.push({ field: 'match', reason: 'failed', message: failMessage(e) }); }
    r = await getReview(db, artistId);
  }
  // A pretrusted match that was not approved in this run does not unlock its rows.
  const locked = (row) => row.locked || (approveBlocked && isLocked(row.source, 'needs-approval'));
  // Accept all is FILL-ONLY: it never replaces a stored value (that is a per-row Accept), never changes a stored member,
  // and fills the Bandcamp url (a name match like a title-verified id) only once the match is approved.
  const approved = r.match.state === 'approved';
  for (const row of r.fields) {
    if (locked(row)) { skipped.push({ field: row.field, reason: 'locked' }); continue; }
    if (warned.has(row.field)) { skipped.push({ field: row.field, reason: 'warning' }); continue; }
    if (row.current !== null && row.current !== '') { skipped.push({ field: row.field, reason: 'replace' }); continue; }
    if (row.field === 'bandcamp_url' && !approved) { skipped.push({ field: row.field, reason: 'warning' }); continue; }
    try { await applyField(db, artistId, row); applied.push(row.field); }
    catch (e) { skipped.push({ field: row.field, reason: 'failed', message: failMessage(e) }); }
  }
  for (const row of r.members) {
    const label = memberLabel(row.name);
    if (locked(row)) { skipped.push({ field: label, reason: 'locked' }); continue; }
    if (warned.has('members')) { skipped.push({ field: label, reason: 'warning' }); continue; }
    if (row.change !== 'new') { skipped.push({ field: label, reason: 'replace' }); continue; }
    try { await applyMember(db, artistId, row); applied.push(label); }
    catch (e) { skipped.push({ field: label, reason: 'failed', message: failMessage(e) }); }
  }
  return { applied, skipped, review: await getReview(db, artistId) };
}

async function finish(db, artistId, finished) {
  if (typeof finished !== 'boolean') throw coded('BAD_INPUT', 'finished must be true or false');
  await reviewWithProposal(db, artistId);
  await upsertFinished(db, artistId, finished);
  return getReview(db, artistId);
}

module.exports = { QUEUES, counts, list, getReview, matchState, isLocked, buildWarnings,
  decideMatch, acceptField, acceptMember, acceptAll, finish };
