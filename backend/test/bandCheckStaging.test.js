const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const staging = require('../services/staging');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZBANDSTG.
async function mkArtist(name = 'ZZZBANDSTG Band') {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0].id;
}
after(async () => {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBANDSTG%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZBANDSTG%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZBANDSTG%'`);
  await pool.end();
});

test('insertManualCandidate adds a pending manual song linked to the existing artist, with the bandcamp link', async () => {
  const artistId = await mkArtist();
  const r = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Lone Song', artistId, bandcamp_url: 'https://zzzbandstg.bandcamp.com/track/lone', note: 'added via band check (ZZZBANDSTG Band)' });
  assert.equal(r.added, 1);
  const s = (await pool.query(`SELECT status, published, data_source, bandcamp_url, status_notes FROM songs WHERE id=$1`, [r.song_id])).rows[0];
  assert.deepEqual([s.status, s.published, s.data_source, s.bandcamp_url], ['pending', false, 'manual', 'https://zzzbandstg.bandcamp.com/track/lone']);
  const links = (await pool.query(`SELECT artist_id FROM song_artists WHERE song_id=$1`, [r.song_id])).rows;
  assert.deepEqual(links.map(l => l.artist_id), [artistId]);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM artists WHERE name LIKE 'ZZZBANDSTG%'`)).rows[0].n, 1); // no duplicate artist created
});

test('insertManualCandidate skips a normalised-title duplicate for the same artist and a same-url duplicate', async () => {
  const artistId = await mkArtist('ZZZBANDSTG Band 2');
  const first = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Dupe (Live)', artistId, note: 'n' });
  assert.equal(first.added, 1);
  const again = await staging.insertManualCandidate(pool, { title: 'zzzbandstg dupe', artistId, note: 'n' });
  assert.deepEqual([again.added, again.skippedExisting, again.song_id], [0, 1, null]);
  await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Url One', artistId, bandcamp_url: 'https://zzzbandstg.bandcamp.com/track/u', note: 'n' });
  const sameUrl = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Url Two', artistId, bandcamp_url: 'https://zzzbandstg.bandcamp.com/track/u', note: 'n' });
  assert.equal(sameUrl.skippedExisting, 1);
});

test('insertManualCandidate dedupe is Unicode-aware: distinct non-Latin titles are both added', async () => {
  const artistId = await mkArtist('ZZZBANDSTG Band U');
  const a = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Смерть 2', artistId, note: 'n' });
  const b = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Жизнь 2', artistId, note: 'n' });
  const c = await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Смерть 2 (Live)', artistId, note: 'n' });
  assert.equal(a.added, 1);
  assert.equal(b.added, 1);
  assert.deepEqual([c.added, c.skippedExisting, c.song_id], [0, 1, null]);
});

test('a band-check song shows origin "bandcheck" in the To be processed queue', async () => {
  const artistId = await mkArtist('ZZZBANDSTG Band 3');
  await staging.insertManualCandidate(pool, { title: 'ZZZBANDSTG Origin', artistId, note: 'added via band check (ZZZBANDSTG Band 3)' });
  const { rows } = await curation.listCurationQueue(pool, { queue: 'to-process', q: 'ZZZBANDSTG Origin' });
  assert.equal(rows.find(r => r.title === 'ZZZBANDSTG Origin').origin, 'bandcheck');
});

test('insertCandidates accepts a custom note and keeps its default', async () => {
  const track = (id, title) => ({ spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: null, added_at: null,
    artists: [{ spotify_id: 'ZZZBANDSTG' + id, name: 'ZZZBANDSTG Spot ' + id, spotify_url: null }], album: null });
  await staging.insertCandidates(pool, [track('n1', 'ZZZBANDSTG Noted')], { note: 'added via band check (x)' });
  await staging.insertCandidates(pool, [track('n2', 'ZZZBANDSTG Plain')]);
  const notes = Object.fromEntries((await pool.query(`SELECT title, status_notes FROM songs WHERE title IN ('ZZZBANDSTG Noted','ZZZBANDSTG Plain')`)).rows.map(r => [r.title, r.status_notes]));
  assert.equal(notes['ZZZBANDSTG Noted'], 'added via band check (x)');
  assert.equal(notes['ZZZBANDSTG Plain'], 'added as candidate via staging intake');
});
