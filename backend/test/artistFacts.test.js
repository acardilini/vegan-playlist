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
const NOW = new Date('2026-06-01');

test('activeStatus: override wins over a disbanded year and a stale release', () => {
  assert.deepEqual(svc.activeStatus({ lastReleaseYear: 2010, disbandedYear: 2012, override: true }, NOW), { active: true, label: 'Active, last release 2010' });
  assert.deepEqual(svc.activeStatus({ lastReleaseYear: 2026, override: false }, NOW), { active: false, label: 'Inactive, last release 2026' });
});
test('activeStatus: override with no release year is just Active / Inactive', () => {
  assert.deepEqual(svc.activeStatus({ override: true }, NOW), { active: true, label: 'Active' });
  assert.deepEqual(svc.activeStatus({ override: false }, NOW), { active: false, label: 'Inactive' });
});
test('activeStatus: disbanded means Inactive', () => {
  assert.deepEqual(svc.activeStatus({ lastReleaseYear: 2025, disbandedYear: 2026 }, NOW), { active: false, label: 'Inactive, last release 2025' });
});
test('activeStatus: within 3 years Active, older Inactive, no information null', () => {
  assert.equal(svc.activeStatus({ lastReleaseYear: 2024 }, NOW).label, 'Active, last release 2024');
  assert.equal(svc.activeStatus({ lastReleaseYear: 2023 }, NOW).label, 'Active, last release 2023');
  assert.equal(svc.activeStatus({ lastReleaseYear: 2012 }, NOW).label, 'Inactive, last release 2012');
  assert.deepEqual(svc.activeStatus({}, NOW), { active: null, label: null });
});

test('saveFacts round-trips with default source, keeps MusicBrainz when given, null clears', async () => {
  const id = await mk('ZZZAFA One');
  let f = await svc.saveFacts(pool, id, { country: ' Germany ', formed_year: 2009, last_release_year: 2024, last_release_source: 'MusicBrainz' });
  assert.deepEqual([f.country, f.country_source, f.formed_year, f.formed_source, f.last_release_year, f.last_release_source], ['Germany', 'Added by curator', 2009, 'Added by curator', 2024, 'MusicBrainz']);
  f = await svc.saveFacts(pool, id, { country: null, active_override: false });
  assert.deepEqual([f.country, f.country_source, f.active_override, f.formed_year], [null, null, false, 2009]);
  f = await svc.saveFacts(pool, id, { active_override: null });
  assert.equal(f.active_override, null);
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
