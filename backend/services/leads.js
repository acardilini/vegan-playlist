// Leads: bands the curator wants to look into later. Capture is deliberately cheap (a name is enough); duplicates are
// found by a folded name key and never merged. Leads are admin-only and never reach a public route.
const { coded } = require('./bandCheck/errors');

const STATUSES = ['new', 'checked', 'dismissed'];
const LIMITS = { name: 255, note: 1000, song: 255, url: 500, origin: 30 };
const COLS = 'id, name, note, song, url, origin, status, created_at, dismissed_at, artist_id';

// lowercase, diacritics folded, a leading "the" dropped, every non-alphanumeric run one space
function leadKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the\b\s*/, '').trim();
}

const isHttp = (v) => { try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; } };

function text(value, field, { required = false } = {}) {
  if (value === undefined || value === null) { if (required) throw coded('BAD_INPUT', 'Name is required'); return null; }
  if (typeof value !== 'string') throw coded('BAD_INPUT', `${field} must be text`);
  const v = value.trim();
  if (!v) { if (required) throw coded('BAD_INPUT', 'Name is required'); return null; }
  if (v.length > LIMITS[field]) throw coded('BAD_INPUT', `${field} is too long (${LIMITS[field]} characters at most)`);
  return v;
}
function link(value) {
  const v = text(value, 'url');
  if (v && !isHttp(v)) throw coded('BAD_INPUT', 'The link must be an http(s) address');
  return v;
}

async function artistsByKey(db) {
  const map = new Map();
  for (const a of (await db.query(`SELECT id, name FROM artists`)).rows) { const k = leadKey(a.name); if (k && !map.has(k)) map.set(k, a); }
  return map;
}

async function addLead(db, { name, note, song, url, origin = 'manual' } = {}) {
  const n = text(name, 'name', { required: true });
  const key = leadKey(n);
  if (!key) throw coded('BAD_INPUT', 'Name is required');
  const clean = { note: text(note, 'note'), song: text(song, 'song'), url: link(url) };
  if (typeof origin !== 'string' || !origin.trim() || origin.trim().length > LIMITS.origin) throw coded('BAD_INPUT', 'origin must be a short word (30 characters at most)');
  const existing = (await db.query(`SELECT ${COLS} FROM leads WHERE name_key = $1 ORDER BY id LIMIT 1`, [key])).rows[0];
  if (existing) return { status: 'duplicate', kind: 'lead', lead: existing };
  const artist = (await artistsByKey(db)).get(key);
  if (artist) return { status: 'duplicate', kind: 'artist', artist: { id: artist.id, name: artist.name } };
  const lead = (await db.query(
    `INSERT INTO leads (name, name_key, note, song, url, origin) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
    [n, key, clean.note, clean.song, clean.url, origin.trim()])).rows[0];
  return { status: 'added', lead };
}

async function listLeads(db, { status = 'new' } = {}) {
  if (status !== 'all' && !STATUSES.includes(status)) throw coded('BAD_INPUT', 'Unknown status');
  const counts = { new: 0, checked: 0, dismissed: 0 };
  for (const r of (await db.query(`SELECT status, count(*)::int AS n FROM leads GROUP BY status`)).rows) counts[r.status] = r.n;
  const rows = (await db.query(
    `SELECT ${COLS}, name_key FROM leads ${status === 'all' ? '' : 'WHERE status = $1'} ORDER BY created_at DESC, id DESC`,
    status === 'all' ? [] : [status])).rows;
  const byKey = await artistsByKey(db);
  const byId = new Map(); for (const a of byKey.values()) byId.set(a.id, a);
  const leads = rows.map(({ name_key, ...l }) => {
    const m = (l.artist_id && byId.get(l.artist_id)) || byKey.get(name_key) || null;
    return { ...l, artist_match: m ? { id: m.id, name: m.name } : null };
  });
  return { leads, counts };
}

async function updateLead(db, id, patch = {}) {
  const sets = [], params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.note !== undefined) set('note', text(patch.note, 'note'));
  if (patch.song !== undefined) set('song', text(patch.song, 'song'));
  if (patch.url !== undefined) set('url', link(patch.url));
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw coded('BAD_INPUT', 'Unknown status');
    set('status', patch.status);
    sets.push(`dismissed_at = ${patch.status === 'dismissed' ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
  }
  if (!sets.length) {
    const cur = (await db.query(`SELECT ${COLS} FROM leads WHERE id = $1`, [id])).rows[0];
    if (!cur) throw coded('NOT_FOUND', 'Lead not found');
    return cur;
  }
  params.push(id);
  const r = await db.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLS}`, params);
  if (!r.rows.length) throw coded('NOT_FOUND', 'Lead not found');
  return r.rows[0];
}

async function deleteLead(db, id) {
  const r = await db.query(`DELETE FROM leads WHERE id = $1`, [id]);
  if (!r.rowCount) throw coded('NOT_FOUND', 'Lead not found');
  return { removed: true };
}

module.exports = { leadKey, addLead, listLeads, updateLead, deleteLead };
