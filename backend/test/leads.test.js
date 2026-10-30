const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/leads');

// Fixture sentinel for this file: ZZZLEA.
async function mkArtist(name) {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0].id;
}
async function clean() {
  await pool.query(`DELETE FROM leads WHERE name LIKE 'ZZZLEA%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZLEA%'`);
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
