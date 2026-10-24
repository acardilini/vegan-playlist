// Artists service (sub-project I1): the admin Artists area's queues, list, read and update. Takes `db` (a pg Pool).
// The queue predicates live in ONE table below and feed both counts() and list(), so a rail count can never
// disagree with its list. Artist identity (spotify / bandcamp / musicbrainz) is NOT written here -
// bandCheck.saveIdentity is its single writer.
const { coded } = require('./bandCheck/errors');

const NO_IDENTITY = `COALESCE(a.spotify_id,'')='' AND COALESCE(a.bandcamp_url,'')='' AND a.musicbrainz_id IS NULL`;
const NOT_REVIEWED = `COALESCE(a.discography_reviewed,false)=false`;
const NO_BIO = `COALESCE(btrim(a.bio),'')=''`;
const NO_NOTES = `(COALESCE(btrim(a.vegan_advocacy_notes),'')='' AND NOT a.no_advocacy_notes_needed)`;

const PREDICATE = {
  'needs-identity': NO_IDENTITY,
  'needs-check': NOT_REVIEWED,
  'needs-bio': NO_BIO,
  'needs-notes': NO_NOTES,
  'done': `NOT (${NO_IDENTITY}) AND NOT (${NOT_REVIEWED}) AND NOT (${NO_BIO}) AND NOT ${NO_NOTES}`,
  'all': 'true',
};
const QUEUES = [
  { key: 'needs-identity', label: 'Needs identity' },
  { key: 'needs-check', label: 'Needs catalogue check' },
  { key: 'needs-bio', label: 'Needs bio' },
  { key: 'needs-notes', label: 'Needs advocacy notes' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All artists' },
];

const like = (s) => String(s).replace(/[\\%_]/g, c => '\\' + c);

async function counts(db) {
  const cols = Object.entries(PREDICATE).map(([k, p]) => `count(*) FILTER (WHERE ${p})::int AS "${k}"`).join(', ');
  return (await db.query(`SELECT ${cols} FROM artists a`)).rows[0];
}

async function list(db, { queue = 'all', q = '', limit = 50, offset = 0 } = {}) {
  const pred = PREDICATE[queue];
  if (!pred) throw coded('BAD_INPUT', 'Unknown queue');
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200), off = Math.max(parseInt(offset) || 0, 0);
  const pat = q ? `%${like(q)}%` : null;
  // One filter, built once, used by BOTH queries (the old route reused a $3 placeholder in a query that bound only $1).
  const where = `WHERE (${pred}) AND ($1::text IS NULL OR a.name ILIKE $1)`;
  const total = (await db.query(`SELECT count(*)::int AS n FROM artists a ${where}`, [pat])).rows[0].n;
  const rows = (await db.query(`
    SELECT a.id, a.name, a.spotify_id, a.bandcamp_url, a.musicbrainz_id, a.discography_reviewed,
           a.bio, a.vegan_advocacy_notes, a.no_advocacy_notes_needed,
           COUNT(DISTINCT sa.song_id)::int AS songs,
           (COUNT(DISTINCT sa.song_id) FILTER (WHERE s.status='included' AND s.published))::int AS live_songs
    FROM artists a
    LEFT JOIN song_artists sa ON sa.artist_id = a.id
    LEFT JOIN songs s ON s.id = sa.song_id
    ${where}
    GROUP BY a.id
    ORDER BY LOWER(a.name), a.id
    LIMIT $2 OFFSET $3`, [pat, lim, off])).rows;
  return {
    total,
    rows: rows.map(r => ({
      id: r.id, name: r.name, songs: r.songs, live_songs: r.live_songs,
      identity: { spotify: !!r.spotify_id, bandcamp: !!r.bandcamp_url, musicbrainz: !!r.musicbrainz_id },
      reviewed: !!r.discography_reviewed,
      has_bio: !!(r.bio && r.bio.trim()),
      has_notes: !!(r.vegan_advocacy_notes && r.vegan_advocacy_notes.trim()),
      none_needed: !!r.no_advocacy_notes_needed,
    })),
  };
}

async function get(db, id) {
  const a = (await db.query(`
    SELECT a.id, a.name, a.bio, a.vegan_advocacy_notes, a.no_advocacy_notes_needed, a.website_url, a.genres,
           a.spotify_id, a.bandcamp_url, a.musicbrainz_id,
           a.discography_reviewed, a.discography_reviewed_date, a.discography_review_notes,
           (SELECT COUNT(DISTINCT sa.song_id)::int FROM song_artists sa WHERE sa.artist_id = a.id) AS songs,
           (SELECT COUNT(DISTINCT sa.song_id)::int FROM song_artists sa JOIN songs s ON s.id = sa.song_id
             WHERE sa.artist_id = a.id AND s.status='included' AND s.published) AS live_songs
    FROM artists a WHERE a.id = $1`, [id])).rows[0];
  if (!a) throw coded('NOT_FOUND', 'Artist not found');
  return a;
}

const isHttp = (v) => { try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; } };

async function update(db, id, patch = {}) {
  const sets = [], params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.name !== undefined) {
    const n = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!n || n.length > 255) throw coded('BAD_INPUT', 'Name is required (255 characters at most)');
    set('name', n);
  }
  for (const col of ['bio', 'vegan_advocacy_notes', 'discography_review_notes']) {
    if (patch[col] === undefined) continue;
    if (patch[col] !== null && typeof patch[col] !== 'string') throw coded('BAD_INPUT', `${col} must be text`);
    set(col, patch[col] === null || patch[col].trim() === '' ? null : patch[col]);
  }
  if (patch.no_advocacy_notes_needed !== undefined) {
    if (typeof patch.no_advocacy_notes_needed !== 'boolean') throw coded('BAD_INPUT', 'no_advocacy_notes_needed must be true or false');
    set('no_advocacy_notes_needed', patch.no_advocacy_notes_needed);
  }
  if (patch.website_url !== undefined) {
    const v = patch.website_url === null ? '' : String(patch.website_url).trim();
    if (v && !isHttp(v)) throw coded('BAD_INPUT', 'Website must be an http(s) address');
    if (v.length > 500) throw coded('BAD_INPUT', 'Website address is too long (500 characters at most)');
    set('website_url', v || null);
  }
  if (patch.genres !== undefined) {
    if (!Array.isArray(patch.genres) || patch.genres.some(g => typeof g !== 'string')) throw coded('BAD_INPUT', 'Genres must be a list of text');
    set('genres', patch.genres.map(g => g.trim()).filter(Boolean));
  }
  if (patch.discography_reviewed !== undefined) {
    if (typeof patch.discography_reviewed !== 'boolean') throw coded('BAD_INPUT', 'discography_reviewed must be true or false');
    set('discography_reviewed', patch.discography_reviewed);
    sets.push(`discography_reviewed_date = ${patch.discography_reviewed ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
  }
  if (sets.length) {
    params.push(id);
    const r = await db.query(`UPDATE artists SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING id`, params);
    if (r.rows.length === 0) throw coded('NOT_FOUND', 'Artist not found');
  }
  return get(db, id);
}

module.exports = { QUEUES, counts, list, get, update };
