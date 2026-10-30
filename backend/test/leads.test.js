const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/leads');

// Fixture sentinel for this file: ZZZLEA.
async function mkArtist(name) {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0].id;
}
async function clean() {
  await pool.query(`DELETE FROM leads WHERE name ILIKE '%ZZZLEA%'`);
  await pool.query(`DELETE FROM artists WHERE name ILIKE '%ZZZLEA%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const coded = (code) => (e) => e.code === code;

test('leadKey folds case, diacritics, a leading The, punctuation and spacing', () => {
  assert.equal(svc.leadKey('  The  ZZZLEA Bånd! '), svc.leadKey('zzzlea band'));
  assert.equal(svc.leadKey('The'), '');
  assert.equal(svc.leadKey('***'), '');
});

test('addLead adds with defaults and trims', async () => {
  const r = await svc.addLead(pool, { name: '  ZZZLEA One  ', note: ' heard on reddit ', song: ' A Song ', url: 'https://example.com/x' });
  assert.equal(r.status, 'added');
  assert.deepEqual([r.lead.name, r.lead.note, r.lead.song, r.lead.status, r.lead.origin], ['ZZZLEA One', 'heard on reddit', 'A Song', 'new', 'manual']);
});
test('addLead rejects empty, over-length, bad url and bad origin; nothing is inserted', async () => {
  const before = (await pool.query(`SELECT count(*) c FROM leads`)).rows[0].c;
  for (const bad of [{ name: '   ' }, { name: 'The' }, { name: 'ZZZLEA ' + 'x'.repeat(260) }, { name: 'ZZZLEA Two', note: 'n'.repeat(1001) },
    { name: 'ZZZLEA Two', url: 'ftp://x' }, { name: 'ZZZLEA Two', origin: 'o'.repeat(31) }, { name: 'ZZZLEA Two', origin: '' }, {}]) {
    await assert.rejects(svc.addLead(pool, bad), coded('BAD_INPUT'));
  }
  assert.equal((await pool.query(`SELECT count(*) c FROM leads`)).rows[0].c, before);
});
test('the same band in another form is a duplicate lead and inserts nothing', async () => {
  await svc.addLead(pool, { name: 'ZZZLEA Dupe Band' });
  const r = await svc.addLead(pool, { name: 'the zzzlea  DÜPE band!' });
  assert.deepEqual([r.status, r.kind, r.lead.status], ['duplicate', 'lead', 'new']);
  assert.equal((await pool.query(`SELECT count(*) c FROM leads WHERE name_key = $1`, [svc.leadKey('ZZZLEA Dupe Band')])).rows[0].c, '1');
});
test('a dismissed and a checked lead each block a re-add and carry their status', async () => {
  const d = (await svc.addLead(pool, { name: 'ZZZLEA Dismissed' })).lead;
  await svc.updateLead(pool, d.id, { status: 'dismissed' });
  const rd = await svc.addLead(pool, { name: 'zzzlea dismissed' });
  assert.deepEqual([rd.status, rd.kind, rd.lead.status], ['duplicate', 'lead', 'dismissed']);
  assert.ok(rd.lead.dismissed_at);
  const c = (await svc.addLead(pool, { name: 'ZZZLEA Checked' })).lead;
  await svc.updateLead(pool, c.id, { status: 'checked' });
  const rc = await svc.addLead(pool, { name: 'ZZZLEA Checked' });
  assert.deepEqual([rc.kind, rc.lead.status], ['lead', 'checked']);
});
test('a name matching an existing artist is a duplicate artist and inserts nothing', async () => {
  const id = await mkArtist('The ZZZLEA Artist Band');
  const r = await svc.addLead(pool, { name: 'zzzlea artist band' });
  assert.deepEqual([r.status, r.kind, r.artist.id], ['duplicate', 'artist', id]);
  assert.equal((await pool.query(`SELECT count(*) c FROM leads WHERE name LIKE 'zzzlea artist%'`)).rows[0].c, '0');
});

test('listLeads: default new only, counts for all statuses, newest first, artist match is live', async () => {
  await clean();
  const a = (await svc.addLead(pool, { name: 'ZZZLEA List A' })).lead;
  const b = (await svc.addLead(pool, { name: 'ZZZLEA List B' })).lead;
  const c = (await svc.addLead(pool, { name: 'ZZZLEA List C' })).lead;
  await svc.updateLead(pool, c.id, { status: 'checked' });
  const artistId = await mkArtist('The ZZZLEA List A'); // created after the lead
  const r = await svc.listLeads(pool);
  const mine = r.leads.filter((l) => l.name.startsWith('ZZZLEA'));
  assert.deepEqual(mine.map((l) => l.name), ['ZZZLEA List B', 'ZZZLEA List A']);
  assert.deepEqual(mine.find((l) => l.id === a.id).artist_match, { id: artistId, name: 'The ZZZLEA List A' });
  assert.equal(mine.find((l) => l.id === b.id).artist_match, null);
  assert.ok(r.counts.new >= 2 && r.counts.checked >= 1 && r.counts.dismissed >= 0);
  const all = await svc.listLeads(pool, { status: 'all' });
  assert.ok(all.leads.some((l) => l.id === c.id));
  await assert.rejects(svc.listLeads(pool, { status: 'nope' }), coded('BAD_INPUT'));
});

test('updateLead edits, clears with null, moves status and stamps/clears dismissed_at', async () => {
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Upd', note: 'n', song: 's', url: 'https://x.test' })).lead;
  let u = await svc.updateLead(pool, l.id, { note: 'new note', song: null, url: '' });
  assert.deepEqual([u.note, u.song, u.url], ['new note', null, null]);
  u = await svc.updateLead(pool, l.id, { status: 'dismissed' });
  assert.ok(u.dismissed_at);
  u = await svc.updateLead(pool, l.id, { status: 'new' });
  assert.equal(u.dismissed_at, null);
  await assert.rejects(svc.updateLead(pool, l.id, { status: 'weird' }), coded('BAD_INPUT'));
  await assert.rejects(svc.updateLead(pool, 999999999, { note: 'x' }), coded('NOT_FOUND'));
});
test('deleteLead removes and reports a missing one', async () => {
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Del' })).lead;
  assert.deepEqual(await svc.deleteLead(pool, l.id), { removed: true });
  await assert.rejects(svc.deleteLead(pool, l.id), coded('NOT_FOUND'));
});

const NOW = new Date('2026-10-31T10:00:00Z');
const notesOf = async (id) => (await pool.query(`SELECT discography_review_notes n FROM artists WHERE id = $1`, [id])).rows[0].n;
const artistCount = async (key) => (await pool.query(`SELECT name FROM artists`)).rows.filter((a) => svc.leadKey(a.name) === key).length;

test('promote creates a manual artist, appends the dated line and marks the lead checked', async () => {
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Promo One', note: 'heard on reddit', song: 'Loud Song', url: 'https://example.com/t' })).lead;
  const r = await svc.promoteLead(pool, l.id, { now: NOW });
  assert.equal(r.created, true);
  const a = (await pool.query(`SELECT name, data_source, spotify_id FROM artists WHERE id = $1`, [r.artistId])).rows[0];
  assert.deepEqual([a.name, a.data_source, a.spotify_id], ['ZZZLEA Promo One', 'manual', null]);
  assert.equal(await notesOf(r.artistId), 'Lead (2026-10-31): heard on reddit · song: Loud Song · https://example.com/t');
  assert.deepEqual([r.lead.status, r.lead.artist_id], ['checked', r.artistId]);
});
test('promote uses an existing same-key artist, appends to its notes and never creates a second', async () => {
  const id = await mkArtist('The ZZZLEA Promo Two');
  await pool.query(`UPDATE artists SET discography_review_notes = 'my own notes' WHERE id = $1`, [id]);
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Promo Two Lead', note: 'x' })).lead;
  await pool.query(`UPDATE leads SET name = 'zzzlea promo two', name_key = $2 WHERE id = $1`, [l.id, svc.leadKey('zzzlea promo two')]); // the artist appeared after the lead
  const r = await svc.promoteLead(pool, l.id, { now: NOW });
  assert.deepEqual([r.artistId, r.created], [id, false]);
  assert.equal(await notesOf(id), 'my own notes\nLead (2026-10-31): x');
  assert.equal(await artistCount(svc.leadKey('zzzlea promo two')), 1);
});
test('a second promote opens the artist without adding another line', async () => {
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Promo Three', note: 'n' })).lead;
  const first = await svc.promoteLead(pool, l.id, { now: NOW });
  const again = await svc.promoteLead(pool, l.id, { now: new Date('2026-11-05') });
  assert.deepEqual([again.artistId, again.created], [first.artistId, false]);
  assert.equal(await notesOf(first.artistId), 'Lead (2026-10-31): n');
});
test('a lead with no note, song or link appends just the dated stub', async () => {
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Promo Four' })).lead;
  const r = await svc.promoteLead(pool, l.id, { now: NOW });
  assert.equal(await notesOf(r.artistId), 'Lead (2026-10-31)');
});
test('a failure inside promote rolls everything back', async () => {
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Promo Five', note: 'n' })).lead;
  const failing = { connect: async () => { const c = await pool.connect(); const orig = c.query, release = c.release.bind(c), q = c.query.bind(c);
    c.release = () => { c.query = orig; c.release = release; release(); }; // the pool reuses this client: undo the patch on release
    c.query = (sql, ...a) => (/discography_review_notes/.test(String(sql)) && /UPDATE/i.test(String(sql)) ? Promise.reject(new Error('boom')) : q(sql, ...a)); return c; } };
  await assert.rejects(svc.promoteLead(failing, l.id, { now: NOW }), /boom/);
  assert.equal(await artistCount(svc.leadKey('ZZZLEA Promo Five')), 0);
  assert.deepEqual((await pool.query(`SELECT status, artist_id FROM leads WHERE id = $1`, [l.id])).rows[0], { status: 'new', artist_id: null });
});
test('deleting a promoted artist leaves the lead, and it can be restored', async () => {
  const l = (await svc.addLead(pool, { name: 'ZZZLEA Promo Six' })).lead;
  const r = await svc.promoteLead(pool, l.id, { now: NOW });
  await pool.query(`DELETE FROM artists WHERE id = $1`, [r.artistId]);
  const row = (await pool.query(`SELECT status, artist_id FROM leads WHERE id = $1`, [l.id])).rows[0];
  assert.deepEqual(row, { status: 'checked', artist_id: null });
  assert.equal((await svc.updateLead(pool, l.id, { status: 'new' })).status, 'new');
});
test('promote of an unknown lead is NOT_FOUND', async () => {
  await assert.rejects(svc.promoteLead(pool, 999999999, { now: NOW }), coded('NOT_FOUND'));
});
