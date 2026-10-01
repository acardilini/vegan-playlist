const { test, after, mock } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const inbox = require('../services/inbox');
const curation = require('../services/curation');
const staging = require('../services/staging');

// Unique fixture sentinel for this file: ZZZINBOX.
async function mkSong({ title, status = 'pending', published = false, artist = 'ZZZINBOX Artist' }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0];
  const a = (await pool.query(
    `INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}
async function mkSub({ title, artist = 'ZZZINBOX SubArtist', status = 'pending', created_at = null, existing_song_id = null }) {
  return (await pool.query(
    `INSERT INTO song_submissions (song_title, artist_name, status, existing_song_id, created_at)
     VALUES ($1,$2,$3,$4, COALESCE($5, CURRENT_TIMESTAMP)) RETURNING id`,
    [title, artist, status, existing_song_id, created_at])).rows[0].id;
}
const mine = (rows) => rows.filter(r => r.song_title.startsWith('ZZZINBOX'));

after(async () => {
  await pool.query(`DELETE FROM song_submissions WHERE song_title LIKE 'ZZZINBOX%'`);
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZINBOX%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZINBOX%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZINBOX%'`);
  await pool.end();
});

test('listInbox is oldest first and pending only', async () => {
  // inserted newest-first on purpose, so insertion order cannot explain the result
  await mkSub({ title: 'ZZZINBOX Newer', created_at: '2020-01-02' });
  await mkSub({ title: 'ZZZINBOX Older', created_at: '2020-01-01' });
  await mkSub({ title: 'ZZZINBOX Done', created_at: '2019-01-01', status: 'approved' });
  const rows = mine(await inbox.listInbox(pool));
  assert.deepEqual(rows.map(r => r.song_title), ['ZZZINBOX Older', 'ZZZINBOX Newer']);
  assert.equal(rows[0].match, null);
});

test('listInbox flags a catalogue match and whether it is live', async () => {
  const live = await mkSong({ title: 'ZZZINBOX LiveSong', status: 'included', published: true });
  const notLive = await mkSong({ title: 'ZZZINBOX PendingSong', status: 'pending' });
  await mkSub({ title: 'ZZZINBOX SubLive', existing_song_id: live, created_at: '2020-02-01' });
  await mkSub({ title: 'ZZZINBOX SubNotLive', existing_song_id: notLive, created_at: '2020-02-02' });
  const rows = mine(await inbox.listInbox(pool));
  const a = rows.find(r => r.song_title === 'ZZZINBOX SubLive');
  const b = rows.find(r => r.song_title === 'ZZZINBOX SubNotLive');
  assert.deepEqual(a.match, { song_id: live, title: 'ZZZINBOX LiveSong', live: true });
  assert.deepEqual(b.match, { song_id: notLive, title: 'ZZZINBOX PendingSong', live: false });
});

test('acceptSubmission creates a pending song, approves the row, and a second accept is NOT_PENDING', async () => {
  const id = await mkSub({ title: 'ZZZINBOX Accept Me', artist: 'ZZZINBOX NewArtist' });
  const r = await inbox.acceptSubmission(pool, id);
  assert.ok(r.song_id, 'song id returned');
  const song = (await pool.query('SELECT status FROM songs WHERE id=$1', [r.song_id])).rows[0];
  assert.equal(song.status, 'pending');
  const sub = (await pool.query('SELECT status, resolved_at FROM song_submissions WHERE id=$1', [id])).rows[0];
  assert.equal(sub.status, 'approved');
  assert.ok(sub.resolved_at);
  await assert.rejects(() => inbox.acceptSubmission(pool, id), (e) => e.code === 'NOT_PENDING');
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Accept Me'`)).rows[0].n;
  assert.equal(n, 1, 'no duplicate song');
});

test('acceptSubmission on a matched submission creates no new song', async () => {
  const songId = await mkSong({ title: 'ZZZINBOX Matched', status: 'included', published: true });
  // same title AND artist as the catalogue song: an exact duplicate, which staging dedupes
  const id = await mkSub({ title: 'ZZZINBOX Matched', artist: 'ZZZINBOX Artist', existing_song_id: songId });
  const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Matched'`)).rows[0].n;
  const r = await inbox.acceptSubmission(pool, id);
  assert.equal(r.song_id, songId);
  const after = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Matched'`)).rows[0].n;
  assert.equal(after, before);
});

test('acceptSubmission / dismissSubmission on an unknown id throw NOT_FOUND', async () => {
  await assert.rejects(() => inbox.acceptSubmission(pool, 999999999), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => inbox.dismissSubmission(pool, 999999999, ''), (e) => e.code === 'NOT_FOUND');
});

test('dismissSubmission rejects the row, stores a trimmed note, blank note is NULL, repeat is NOT_PENDING', async () => {
  const a = await mkSub({ title: 'ZZZINBOX Dismiss A' });
  const b = await mkSub({ title: 'ZZZINBOX Dismiss B' });
  await inbox.dismissSubmission(pool, a, '  looks like spam  ');
  await inbox.dismissSubmission(pool, b, '   ');
  const ra = (await pool.query('SELECT status, admin_notes, resolved_at FROM song_submissions WHERE id=$1', [a])).rows[0];
  const rb = (await pool.query('SELECT status, admin_notes FROM song_submissions WHERE id=$1', [b])).rows[0];
  assert.equal(ra.status, 'rejected');
  assert.equal(ra.admin_notes, 'looks like spam');
  assert.ok(ra.resolved_at);
  assert.equal(rb.admin_notes, null);
  await assert.rejects(() => inbox.dismissSubmission(pool, a, ''), (e) => e.code === 'NOT_PENDING');
});

test('queueCounts.inbox counts pending submissions including catalogue matches', async () => {
  const before = (await curation.queueCounts(pool)).inbox;
  const songId = await mkSong({ title: 'ZZZINBOX CountSong', status: 'included', published: true });
  await mkSub({ title: 'ZZZINBOX CountMatched', existing_song_id: songId });
  await mkSub({ title: 'ZZZINBOX CountPlain' });
  await mkSub({ title: 'ZZZINBOX CountDone', status: 'rejected' });
  const after = (await curation.queueCounts(pool)).inbox;
  assert.equal(after, before + 2);
});

// --- review fixes (final whole-branch review) ---

test('concurrent accepts: exactly one wins and only one song is created', async () => {
  const id = await mkSub({ title: 'ZZZINBOX Race Accept', artist: 'ZZZINBOX RaceArtist' });
  const results = await Promise.allSettled([inbox.acceptSubmission(pool, id), inbox.acceptSubmission(pool, id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const loser = results.find(r => r.status === 'rejected');
  assert.equal(loser.reason.code, 'NOT_PENDING');
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Race Accept'`)).rows[0].n;
  assert.equal(n, 1, 'no orphan pending song from the losing accept');
});

test('accept racing dismiss: if dismiss wins, no song is created', async () => {
  const id = await mkSub({ title: 'ZZZINBOX Race Dismiss', artist: 'ZZZINBOX RaceArtist2' });
  const [acc, dis] = await Promise.allSettled([inbox.acceptSubmission(pool, id), inbox.dismissSubmission(pool, id, '')]);
  assert.equal([acc, dis].filter(r => r.status === 'fulfilled').length, 1);
  const status = (await pool.query('SELECT status FROM song_submissions WHERE id=$1', [id])).rows[0].status;
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Race Dismiss'`)).rows[0].n;
  if (status === 'rejected') assert.equal(n, 0, 'dismissed submission must not leave a song behind');
  else assert.equal(n, 1);
});

test('accept whose bridge yields no song is reverted to pending, never silently approved', async () => {
  const matched = await mkSong({ title: 'ZZZINBOX NoSongMatch', status: 'included', published: true });
  const id = await mkSub({ title: 'ZZZINBOX NoSong', existing_song_id: matched });
  const m = mock.method(staging, 'addSubmissionAsPending', async () => ({ added: 0, skippedExisting: 1, song_id: null }));
  try {
    await assert.rejects(() => inbox.acceptSubmission(pool, id), (e) => e.code === 'NO_SONG');
  } finally { m.mock.restore(); }
  const sub = (await pool.query('SELECT status, existing_song_id, resolved_at FROM song_submissions WHERE id=$1', [id])).rows[0];
  assert.equal(sub.status, 'pending');
  assert.equal(sub.existing_song_id, matched, 'prior catalogue match restored');
  assert.equal(sub.resolved_at, null);
});

test('accept whose bridge throws is reverted to pending and the error propagates', async () => {
  const id = await mkSub({ title: 'ZZZINBOX BridgeThrows' });
  const m = mock.method(staging, 'addSubmissionAsPending', async () => { throw new Error('boom'); });
  try {
    await assert.rejects(() => inbox.acceptSubmission(pool, id), /boom/);
  } finally { m.mock.restore(); }
  const sub = (await pool.query('SELECT status FROM song_submissions WHERE id=$1', [id])).rows[0];
  assert.equal(sub.status, 'pending');
});

test('a false-positive catalogue match can still be accepted as a genuinely new song', async () => {
  // the public form's prefix match links "Free" to "Freedom"; the curator must be able to add the new song
  const other = await mkSong({ title: 'ZZZINBOX Freedom', status: 'included', published: true, artist: 'ZZZINBOX FreeArtist' });
  const id = await mkSub({ title: 'ZZZINBOX Free', artist: 'ZZZINBOX FreeArtist', existing_song_id: other });
  const r = await inbox.acceptSubmission(pool, id);
  assert.notEqual(r.song_id, other, 'a new song, not the false match');
  assert.equal(r.added, 1);
  const song = (await pool.query('SELECT title, status FROM songs WHERE id=$1', [r.song_id])).rows[0];
  assert.equal(song.title, 'ZZZINBOX Free');
  assert.equal(song.status, 'pending');
});
