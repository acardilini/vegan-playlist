// Artist facts: country, years, the Active status and members, each stored with the source that supplied it.
// Only stored (= accepted) facts are ever public; MusicBrainz proposals are computed on demand and never stored.
const { coded } = require('./bandCheck/errors');

const CURATOR = 'Added by curator';
const SOURCES = new Set(['MusicBrainz', CURATOR]);
const ACTIVE_WINDOW_YEARS = 3;
const YEAR_FIELDS = ['formed_year', 'disbanded_year', 'last_release_year'];

const nameKey = (name) => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Automatic from the last release (within 3 years = Active), a disbanded year = Inactive, the curator's override wins.
function activeStatus({ lastReleaseYear, disbandedYear, override } = {}, now = new Date()) {
  let active = null;
  if (override === true || override === false) active = override;
  else if (disbandedYear) active = false;
  else if (lastReleaseYear) active = now.getFullYear() - lastReleaseYear <= ACTIVE_WINDOW_YEARS;
  if (active === null) return { active: null, label: null };
  return { active, label: `${active ? 'Active' : 'Inactive'}${lastReleaseYear ? `, last release ${lastReleaseYear}` : ''}` };
}

const COLS = `country, country_source, formed_year, formed_source, disbanded_year, disbanded_source,
              last_release_year, last_release_source, active_override`;
const MEMBER_COLS = 'id, name, is_current, vegan, source';

async function getFacts(db, artistId) {
  const a = (await db.query(`SELECT ${COLS} FROM artists WHERE id = $1`, [artistId])).rows[0];
  if (!a) throw coded('NOT_FOUND', 'Artist not found');
  const members = (await db.query(`SELECT ${MEMBER_COLS} FROM artist_members WHERE artist_id = $1 ORDER BY is_current DESC, lower(name), id`, [artistId])).rows;
  return {
    ...a,
    active: activeStatus({ lastReleaseYear: a.last_release_year, disbandedYear: a.disbanded_year, override: a.active_override }),
    members,
  };
}

function validYear(v) {
  const max = new Date().getFullYear() + 1;
  if (!Number.isInteger(v) || v < 1900 || v > max) throw coded('BAD_INPUT', `Year must be a whole number from 1900 to ${max}`);
  return v;
}
function sourceFor(patch, key) {
  const s = patch[`${key}_source`];
  if (s === undefined) return CURATOR;
  if (!SOURCES.has(s)) throw coded('BAD_INPUT', 'Unknown source');
  return s;
}

async function saveFacts(db, artistId, patch = {}) {
  const sets = [], params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.country !== undefined) {
    if (patch.country === null || (typeof patch.country === 'string' && !patch.country.trim())) { set('country', null); set('country_source', null); }
    else {
      if (typeof patch.country !== 'string' || patch.country.trim().length > 100) throw coded('BAD_INPUT', 'Country must be text, 100 characters at most');
      set('country', patch.country.trim()); set('country_source', sourceFor(patch, 'country'));
    }
  }
  for (const key of YEAR_FIELDS) {
    if (patch[key] === undefined) continue;
    const srcCol = `${key.replace('_year', '')}_source`;
    if (patch[key] === null) { set(key, null); set(srcCol, null); }
    else { set(key, validYear(patch[key])); set(srcCol, sourceFor(patch, key.replace('_year', ''))); }
  }
  if (patch.active_override !== undefined) {
    if (patch.active_override !== null && typeof patch.active_override !== 'boolean') throw coded('BAD_INPUT', 'active_override must be true, false or null');
    set('active_override', patch.active_override);
  }
  if (sets.length) {
    params.push(artistId);
    const r = await db.query(`UPDATE artists SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING id`, params);
    if (!r.rows.length) throw coded('NOT_FOUND', 'Artist not found');
  }
  return getFacts(db, artistId);
}

const cleanName = (name) => {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > 255) throw coded('BAD_INPUT', 'Name is required (255 characters at most)');
  return n;
};
async function membersOf(db, artistId) { return (await db.query(`SELECT id, name FROM artist_members WHERE artist_id = $1`, [artistId])).rows; }

async function addMember(db, artistId, { name, is_current = true, vegan = false, source = CURATOR } = {}) {
  const n = cleanName(name);
  if (!SOURCES.has(source)) throw coded('BAD_INPUT', 'Unknown source');
  if (!(await db.query(`SELECT 1 FROM artists WHERE id = $1`, [artistId])).rows.length) throw coded('NOT_FOUND', 'Artist not found');
  if ((await membersOf(db, artistId)).some((m) => nameKey(m.name) === nameKey(n))) throw coded('CONFLICT', 'That member is already listed');
  return (await db.query(
    `INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,$2,$3,$4,$5) RETURNING ${MEMBER_COLS}`,
    [artistId, n, !!is_current, !!vegan, source])).rows[0];
}

async function updateMember(db, artistId, memberId, patch = {}) {
  const cur = (await db.query(`SELECT ${MEMBER_COLS} FROM artist_members WHERE id = $1 AND artist_id = $2`, [memberId, artistId])).rows[0];
  if (!cur) throw coded('NOT_FOUND', 'Member not found');
  const sets = [], params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.name !== undefined) {
    const n = cleanName(patch.name);
    if ((await membersOf(db, artistId)).some((m) => m.id !== cur.id && nameKey(m.name) === nameKey(n))) throw coded('CONFLICT', 'That member is already listed');
    set('name', n);
  }
  for (const col of ['is_current', 'vegan']) {
    if (patch[col] === undefined) continue;
    if (typeof patch[col] !== 'boolean') throw coded('BAD_INPUT', `${col} must be true or false`);
    set(col, patch[col]);
  }
  if (!sets.length) return cur;
  params.push(memberId);
  return (await db.query(`UPDATE artist_members SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${MEMBER_COLS}`, params)).rows[0];
}

async function removeMember(db, artistId, memberId) {
  const r = await db.query(`DELETE FROM artist_members WHERE id = $1 AND artist_id = $2`, [memberId, artistId]);
  if (!r.rowCount) throw coded('NOT_FOUND', 'Member not found');
  return { removed: true };
}

module.exports = { activeStatus, nameKey, getFacts, saveFacts, addMember, updateMember, removeMember };
