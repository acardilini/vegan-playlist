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

const FAILED = 'could not write this item';

// Write the approved items. Re-plans first, so a stale overview can never cause a write the current data would not allow.
// Not one transaction per item (staging.insertManualCandidate opens its own); every write is idempotent instead, so a
// failed item is reported and a re-run completes it.
async function apply(db, extracted, { skip = [], include = [], now = new Date() } = {}) {
  const p = await plan(db, extracted, { now });
  const skipSet = new Set(skip), includeSet = new Set(include);
  const staging = require('./staging'); // lazy: staging requires bandCheck/merge, as insertManualCandidate does itself
  const leadsSvc = require('./leads');
  const { appendClaimLines } = require('./threadClaims');
  const results = [];
  for (const item of p.items) {
    const r = { n: item.n, artist: item.artist, songsAdded: 0, songsHeld: 0, claimsAdded: 0 };
    results.push(r);
    if (skipSet.has(item.n)) { r.skipped = 'skipped by you'; continue; }
    if (item.defaultSkip && !includeSet.has(item.n)) { r.skipped = item.skipReason; continue; }
    const lines = item.claims.filter((c) => c.fresh).map((c) => c.line);
    try {
      let target = null; // [table, id] that receives the claim lines
      if (item.kind === 'existing_artist') {
        for (const s of item.songs) {
          if (s.state === 'have') { r.songsHeld += 1; continue; }
          const res = await staging.insertManualCandidate(db, { title: s.title, artistId: item.artistId, note: `added via reddit thread (${p.thread.url})` });
          if (res.added) r.songsAdded += 1; else r.songsHeld += 1;
        }
        target = ['artists', item.artistId];
      } else if (item.kind === 'existing_lead') {
        if (item.leadStatus !== 'dismissed') target = ['leads', item.leadId];
      } else {
        const res = await leadsSvc.addLead(db, {
          name: item.artist, note: item.genre, song: item.songs.map((s) => s.title).join('; ').slice(0, 255), url: p.thread.url, origin: 'reddit' });
        if (res.status === 'added') { r.lead = 'added'; target = ['leads', res.lead.id]; }
        else {
          r.lead = 'duplicate';
          if (res.kind === 'artist') target = ['artists', res.artist.id];
          else if (res.lead.status !== 'dismissed') target = ['leads', res.lead.id];
        }
      }
      if (target && lines.length) r.claimsAdded = await appendClaimLines(db, target[0], target[1], lines);
    } catch {
      r.error = FAILED; // fixed string: never the pasted text or an error message
    }
  }
  return { results };
}

function formatOverview(p) {
  const t = p.totals;
  const out = [
    `Thread: ${p.thread.title || 'untitled'} (${p.thread.url})`,
    `${p.items.length} bands: ${t.existing_artist} already artists, ${t.existing_lead} already leads, ${t.new_lead} new leads · ${t.newSongs} new songs · ${t.freshClaims} new claim lines`,
  ];
  for (const i of p.items) {
    const label = i.kind === 'existing_artist' ? `already an artist${i.noSongsYet ? ' (no songs yet)' : ''}`
      : i.kind === 'existing_lead' ? `already a lead (${i.leadStatus})` : 'NEW lead';
    out.push('', `#${i.n} ${i.artist} - ${label}`);
    for (const s of i.songs) out.push(`    song: ${s.title} - ${s.state === 'have' ? `have it (${s.haveStatus})` : s.state === 'new' ? 'NEW song' : 'named'}`);
    for (const c of i.claims) out.push(`    claim: ${c.fresh ? `new: ${c.line}` : 'already noted'}`);
    if (i.defaultSkip) out.push(`    [skipped by default: ${i.skipReason}]`);
  }
  return out.join('\n');
}

module.exports = { validate, plan, apply, formatOverview };
