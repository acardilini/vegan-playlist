const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/artistFacts');

// Fixture sentinel for this file: ZZZAFA.
async function mk(name, { mb = null } = {}) {
  return (await pool.query(`INSERT INTO artists (name, musicbrainz_id, data_source) VALUES ($1,$2,'manual') RETURNING id`, [name, mb])).rows[0].id;
}
async function clean() {
  await pool.query(`DELETE FROM artist_members WHERE artist_id IN (SELECT id FROM artists WHERE name LIKE 'ZZZAFA%')`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZAFA%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const coded = (code) => (e) => e.code === code;

test('saveFacts round-trips with default source, keeps MusicBrainz when given, null clears', async () => {
  const id = await mk('ZZZAFA One');
  let f = await svc.saveFacts(pool, id, { country: ' Germany ', formed_year: 2009, last_release_year: 2024, last_release_source: 'MusicBrainz' });
  assert.deepEqual([f.country, f.country_source, f.formed_year, f.formed_source, f.last_release_year, f.last_release_source], ['Germany', 'Added by curator', 2009, 'Added by curator', 2024, 'MusicBrainz']);
  f = await svc.saveFacts(pool, id, { country: null });
  assert.deepEqual([f.country, f.country_source, f.formed_year], [null, null, 2009]);
});
test('getFacts has no Active fields, and an old active_override in a patch is ignored', async () => {
  const id = await mk('ZZZAFA NoActive');
  const f = await svc.saveFacts(pool, id, { formed_year: 2001, active_override: true });
  assert.equal(f.formed_year, 2001);
  assert.ok(!('active' in f) && !('active_override' in f));
  assert.equal(svc.activeStatus, undefined);
});
test('saveFacts stores the first release with its source and clears both', async () => {
  const id = await mk('ZZZAFA First');
  let f = await svc.saveFacts(pool, id, { first_release_year: 1996, first_release_source: 'Bandcamp' });
  assert.deepEqual([f.first_release_year, f.first_release_source], [1996, 'Bandcamp']);
  f = await svc.saveFacts(pool, id, { first_release_year: null });
  assert.deepEqual([f.first_release_year, f.first_release_source], [null, null]);
  for (const bad of [1850, 2999]) await assert.rejects(svc.saveFacts(pool, id, { first_release_year: bad }), coded('BAD_INPUT'));
});
test('saveFacts and addMember accept every named source', async () => {
  assert.equal(svc.SOURCE_NAMES.length, 6);
  const id = await mk('ZZZAFA Sources');
  for (const [i, name] of svc.SOURCE_NAMES.entries()) {
    const f = await svc.saveFacts(pool, id, { country: 'Germany', country_source: name });
    assert.equal(f.country_source, name);
    assert.equal((await svc.addMember(pool, id, { name: `ZZZAFA M-${i}`, source: name })).source, name);
  }
});
test('unknown or near-miss sources are rejected and change nothing', async () => {
  const id = await mk('ZZZAFA BadSource');
  await svc.saveFacts(pool, id, { country: 'Germany' });
  for (const bad of ['musicbrainz', 'MusicBrainz ', 'Spotify', '']) {
    await assert.rejects(svc.saveFacts(pool, id, { country: 'France', country_source: bad }), coded('BAD_INPUT'));
    await assert.rejects(svc.addMember(pool, id, { name: 'ZZZAFA Nope', source: bad }), coded('BAD_INPUT'));
  }
  await assert.rejects(svc.saveFacts(pool, id, { first_release_year: 2000, first_release_source: 'Spotify' }), coded('BAD_INPUT'));
  const f = await svc.getFacts(pool, id);
  assert.deepEqual([f.country, f.first_release_year, f.members.length], ['Germany', null, 0]);
});
test('saveFacts rejects bad years, long country and unknown artist', async () => {
  const id = await mk('ZZZAFA Two');
  for (const bad of [1850, 3000, 'abc', 2009.5]) await assert.rejects(svc.saveFacts(pool, id, { formed_year: bad }), coded('BAD_INPUT'));
  await assert.rejects(svc.saveFacts(pool, id, { country: 'x'.repeat(101) }), coded('BAD_INPUT'));
  await assert.rejects(svc.saveFacts(pool, 999999999, { country: 'X' }), coded('NOT_FOUND'));
});

test('members: add, duplicate by name ignoring case and diacritics, update, remove, other artist', async () => {
  const a = await mk('ZZZAFA Three'), b = await mk('ZZZAFA Four');
  const m = await svc.addMember(pool, a, { name: 'José Pérez', is_current: true, vegan: false });
  assert.deepEqual([m.name, m.is_current, m.vegan, m.source], ['José Pérez', true, false, 'Added by curator']);
  await assert.rejects(svc.addMember(pool, a, { name: 'jose perez' }), coded('CONFLICT'));
  await assert.rejects(svc.addMember(pool, a, { name: '  ' }), coded('BAD_INPUT'));
  const u = await svc.updateMember(pool, a, m.id, { vegan: true, is_current: false });
  assert.deepEqual([u.vegan, u.is_current], [true, false]);
  await assert.rejects(svc.updateMember(pool, b, m.id, { vegan: false }), coded('NOT_FOUND'));
  await assert.rejects(svc.removeMember(pool, b, m.id), coded('NOT_FOUND'));
  assert.deepEqual(await svc.removeMember(pool, a, m.id), { removed: true });
  assert.equal((await svc.getFacts(pool, a)).members.length, 0);
});
test('nameKey folds case, diacritics and spacing', () => {
  assert.equal(svc.nameKey('  José   PÉREZ '), 'jose perez');
});

const MB = '11111111-2222-3333-4444-555555555555';
const stub = (facts) => ({ musicbrainz: { fetchFacts: async () => ({ name: 'Stub Band', country: null, formed_year: null, disbanded_year: null, first_release_year: null, last_release_year: null, members: [], ...facts }) } });

test('propose: no MusicBrainz link is NO_IDENTITY', async () => {
  const id = await mk('ZZZAFA Five');
  await assert.rejects(svc.proposeFromMusicBrainz(pool, id, { adapters: stub({}) }), coded('NO_IDENTITY'));
});
test('propose: fresh artist lists every field MusicBrainz has, with current null, and writes nothing', async () => {
  const id = await mk('ZZZAFA Six', { mb: MB });
  const p = await svc.proposeFromMusicBrainz(pool, id, { adapters: stub({ country: 'Germany', formed_year: 2009, disbanded_year: 2016, first_release_year: 2010, last_release_year: 2015 }) });
  assert.equal(p.musicbrainz.name, 'Stub Band');
  assert.deepEqual(p.fields.map((f) => [f.field, f.current, f.proposed, f.source]), [
    ['country', null, 'Germany', 'MusicBrainz'], ['formed_year', null, 2009, 'MusicBrainz'],
    ['disbanded_year', null, 2016, 'MusicBrainz'], ['first_release_year', null, 2010, 'MusicBrainz'],
    ['last_release_year', null, 2015, 'MusicBrainz']]);
  const f = await svc.getFacts(pool, id);
  assert.deepEqual([f.country, f.formed_year, f.members.length], [null, null, 0]);
});
test('propose: equal stored values are omitted, a hand-typed differing one shows both, empty MusicBrainz proposes nothing', async () => {
  const id = await mk('ZZZAFA Seven', { mb: MB });
  await svc.saveFacts(pool, id, { country: 'Germany', formed_year: 2000 });
  const p = await svc.proposeFromMusicBrainz(pool, id, { adapters: stub({ country: 'Germany', formed_year: 2009 }) });
  assert.deepEqual(p.fields.map((f) => [f.field, f.current, f.proposed]), [['formed_year', 2000, 2009]]);
  assert.deepEqual((await svc.getFacts(pool, id)).formed_year, 2000);
  const none = await svc.proposeFromMusicBrainz(pool, id, { adapters: stub({}) });
  assert.deepEqual([none.fields, none.members], [[], []]);
});
test('propose members: matched by name ignoring case/diacritics, vegan mark kept, manual member never removed', async () => {
  const id = await mk('ZZZAFA Eight', { mb: MB });
  const jose = await svc.addMember(pool, id, { name: 'José', is_current: true, vegan: true });
  await svc.addMember(pool, id, { name: 'Manual Only', is_current: true, vegan: true });
  const p = await svc.proposeFromMusicBrainz(pool, id, { adapters: stub({ members: [
    { name: 'jose', is_current: true }, { name: 'Newbie', is_current: true }, { name: 'MANUAL only', is_current: false }] }) });
  assert.deepEqual(p.members.map((m) => [m.name, m.change, m.existing && m.existing.vegan]), [['Newbie', 'new', null], ['MANUAL only', 'status', true]]);
  const f = await svc.getFacts(pool, id);
  assert.deepEqual(f.members.map((m) => [m.name, m.vegan]).sort(), [['José', true], ['Manual Only', true]]);
  assert.equal(f.members.find((m) => m.id === jose.id).is_current, true);
});
test('propose members: a stored member absent from MusicBrainz is never mentioned', async () => {
  const id = await mk('ZZZAFA Nine', { mb: MB });
  await svc.addMember(pool, id, { name: 'Handmade', vegan: true });
  const p = await svc.proposeFromMusicBrainz(pool, id, { adapters: stub({ members: [{ name: 'Other', is_current: true }] }) });
  assert.deepEqual(p.members.map((m) => m.name), ['Other']);
  assert.equal((await svc.getFacts(pool, id)).members.length, 1);
});

test('publicFacts: nothing stored is null', async () => {
  assert.equal(await svc.publicFacts(pool, await mk('ZZZAFA Ten')), null);
});
test('publicFacts: only what exists, no sources, ids or override', async () => {
  const id = await mk('ZZZAFA Eleven');
  await svc.saveFacts(pool, id, { country: 'Germany' });
  assert.deepEqual(await svc.publicFacts(pool, id), { country: 'Germany' });
});
test('publicFacts: formed year, the release range, members current first; no sources, no Active label', async () => {
  const id = await mk('ZZZAFA Twelve');
  await svc.saveFacts(pool, id, { formed_year: 1999, first_release_year: 1994, last_release_year: 2012, last_release_source: 'MusicBrainz' });
  await svc.addMember(pool, id, { name: 'Zed', is_current: false, vegan: true });
  await svc.addMember(pool, id, { name: 'Amy', is_current: true });
  const p = await svc.publicFacts(pool, id);
  assert.deepEqual(p, { first_release_year: 1994, last_release_year: 2012, members: [{ name: 'Amy', is_current: true, vegan: false }, { name: 'Zed', is_current: false, vegan: true }] });
  assert.ok(!JSON.stringify(p).match(/source|override|active|"id"/));
});
test('publicFacts: the disbanded year stays admin-only', async () => {
  const id = await mk('ZZZAFA Fourteen');
  await svc.saveFacts(pool, id, { disbanded_year: 2010, country: 'Germany' });
  assert.deepEqual(await svc.publicFacts(pool, id), { country: 'Germany' });
});
test('publicFacts: the formed year is stored for the admin but never public', async () => {
  const id = await mk('ZZZAFA Fifteen');
  await svc.saveFacts(pool, id, { formed_year: 2008 });
  assert.equal((await svc.getFacts(pool, id)).formed_year, 2008);
  assert.equal(await svc.publicFacts(pool, id), null);
});
