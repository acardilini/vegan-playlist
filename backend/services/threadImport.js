// Thread import: turns the mentions Claude extracted from a pasted Reddit thread into (a) a read-only plan - what is
// new and what we already have - and (b) the writes the curator approved. Bands go to Leads, named songs by known
// artists to To be processed (pending), vegan claims into the admin-only `thread_claims` notes. Nothing here is public.
const { coded } = require('./bandCheck/errors');
const { keyOf } = require('./bandCheck/merge');
const { leadKey } = require('./leads');
const { STATUS_LABELS, claimLine, bodyOf } = require('./threadClaims');

const NEGATIVE = new Set(['not_vegan', 'unsure']);
const isHttp = (v) => { try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; } };
const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

function validate(extracted) {
  if (!extracted || typeof extracted !== 'object') throw coded('BAD_INPUT', 'The extraction must be an object');
  const thread = extracted.thread;
  if (!thread || typeof thread.url !== 'string' || !isHttp(thread.url.trim())) throw coded('BAD_INPUT', 'thread.url must be an http(s) address');
  if (!Array.isArray(extracted.mentions)) throw coded('BAD_INPUT', 'mentions must be a list');
  const byKey = new Map();
  for (const m of extracted.mentions) {
    if (!m || typeof m.artist !== 'string' || !str(m.artist)) throw coded('BAD_INPUT', 'Every mention needs an artist name');
    for (const f of ['songs', 'claims']) if (m[f] !== undefined && m[f] !== null && !Array.isArray(m[f])) throw coded('BAD_INPUT', `${f} must be a list`);
    const name = str(m.artist);
    const key = leadKey(name);
    if (!byKey.has(key)) byKey.set(key, { artist: name, key, songs: [], genre: null, claims: [] });
    const out = byKey.get(key);
    if (!out.genre && str(m.genre)) out.genre = str(m.genre);
    for (const s of m.songs || []) {
      const title = str(s);
      if (title && !out.songs.some((x) => keyOf(x) === keyOf(title))) out.songs.push(title);
    }
    for (const c of m.claims || []) {
      if (!c || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, c.status)) throw coded('BAD_INPUT', 'A claim status must be vegan, vegetarian, formerly_vegan, not_vegan or unsure');
      const claim = { person: str(c.person), status: c.status, quote: str(c.quote), dispute: str(c.dispute) || (c.disputed ? 'disputed in the thread' : null) };
      const id = [claim.person, claim.status, claim.quote].join('|').toLowerCase();
      if (!out.claims.some((x) => [x.person, x.status, x.quote].join('|').toLowerCase() === id)) out.claims.push(claim);
    }
  }
  return { thread: { url: thread.url.trim(), title: str(thread.title) || null }, mentions: [...byKey.values()].map((m, i) => ({ n: i + 1, ...m })) };
}

const storedBodies = (text) => new Set(String(text || '').split('\n').map(bodyOf).filter(Boolean));

async function plan(db, extracted, { now = new Date() } = {}) {
  const v = validate(extracted);
  const artists = new Map();
  for (const a of (await db.query(`SELECT id, name, thread_claims FROM artists ORDER BY id`)).rows) { const k = leadKey(a.name); if (k && !artists.has(k)) artists.set(k, a); }
  const leads = new Map();
  for (const l of (await db.query(`SELECT id, name_key, status, thread_claims FROM leads ORDER BY id`)).rows) if (!leads.has(l.name_key)) leads.set(l.name_key, l);

  const items = [];
  for (const m of v.mentions) {
    const artist = artists.get(m.key);
    const lead = artist ? null : leads.get(m.key);
    const item = { n: m.n, artist: m.artist, kind: artist ? 'existing_artist' : lead ? 'existing_lead' : 'new_lead', genre: m.genre, songs: [], claims: [], defaultSkip: false, skipReason: null };
    let stored = new Set();
    if (artist) {
      item.artistId = artist.id;
      stored = storedBodies(artist.thread_claims);
      const held = (await db.query(`SELECT s.title, s.status FROM songs s JOIN song_artists sa ON sa.song_id = s.id WHERE sa.artist_id = $1`, [artist.id])).rows;
      item.noSongsYet = held.length === 0;
      item.songs = m.songs.map((title) => {
        const h = held.find((x) => keyOf(x.title) === keyOf(title));
        return h ? { title, state: 'have', haveStatus: h.status } : { title, state: 'new' };
      });
    } else {
      item.songs = m.songs.map((title) => ({ title, state: 'listed' }));
      if (lead) { item.leadId = lead.id; item.leadStatus = lead.status; stored = storedBodies(lead.thread_claims); }
    }
    const dismissed = item.leadStatus === 'dismissed';
    item.claims = m.claims.map((c) => {
      const line = claimLine({ url: v.thread.url, ...c }, now);
      return { line, fresh: !dismissed && !stored.has(bodyOf(line)) };
    });
    if (item.kind === 'new_lead' && m.songs.length === 0 && m.claims.length > 0 && m.claims.every((c) => NEGATIVE.has(c.status))) {
      item.defaultSkip = true; item.skipReason = 'nothing to follow up';
    }
    items.push(item);
  }
  const totals = {
    existing_artist: items.filter((i) => i.kind === 'existing_artist').length,
    existing_lead: items.filter((i) => i.kind === 'existing_lead').length,
    new_lead: items.filter((i) => i.kind === 'new_lead').length,
    newSongs: items.reduce((n, i) => n + i.songs.filter((s) => s.state === 'new').length, 0),
    freshClaims: items.reduce((n, i) => n + i.claims.filter((c) => c.fresh).length, 0),
  };
  return { thread: v.thread, items, totals };
}

module.exports = { validate, plan };
