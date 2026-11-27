const { test, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const pool = require('../database/db');
const svc = require('../services/artistEnrichment');
const { saveIdentity } = require('../services/bandCheck/index');

// Fixture sentinel for this file: ZZZENW. Proposal, review and member rows cascade from the sentinel artists.
async function mkArtist(name, f = {}) {
  return (await pool.query(
    `INSERT INTO artists (name, data_source, musicbrainz_id, bandcamp_url, country, country_source, formed_year, formed_source, last_release_year, last_release_source)
     VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [name, f.musicbrainz_id || null, f.bandcamp_url || null, f.country || null, f.country ? 'Added by curator' : null,
     f.formed_year || null, f.formed_year ? 'Added by curator' : null,
     f.last_release_year || null, f.last_release_year ? 'Added by curator' : null])).rows[0].id;
}
async function mkProposal(artistId, p = {}) {
  await pool.query(
    `INSERT INTO artist_enrichment_proposals (artist_id, proposed_musicbrainz_id, mbid_match_method, mbid_confidence, artist_type,
       proposed_country, country_source, proposed_formed_year, formed_source, proposed_disbanded_year, disbanded_source,
       proposed_last_release_year, last_release_source, proposed_bandcamp_url, proposed_members, layers_completed, review_status, updated_at,
       proposed_first_release_year, first_release_source, field_conflicts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'{}','pending',TIMESTAMP '2026-01-01 00:00:00',$16,$17,$18)`,
    [artistId, p.mbid || null, p.method || (p.mbid ? 'MB_SPOTIFY_URL' : null), p.confidence || (p.mbid ? 'EXACT_ID' : null), p.artist_type || null,
     p.country || null, p.country_source || null, p.formed || null, p.formed_source || null,
     p.disbanded || null, p.disbanded_source || null, p.last || null, p.last_source || null,
     p.bandcamp || null, p.members === undefined ? null : JSON.stringify(p.members), p.first || null, p.first_source || null,
     p.conflicts === undefined ? null : JSON.stringify(p.conflicts)]);
}
async function mkSong(artistId, title, year) {
  const albumId = (await pool.query(`INSERT INTO albums (name, release_date, data_source) VALUES ($1,$2,'manual') RETURNING id`,
    [`${title} album`, `${year}-06-01`])).rows[0].id;
  const id = (await pool.query(`INSERT INTO songs (title, status, published, album_id, data_source) VALUES ($1,'included',true,$2,'manual') RETURNING id`,
    [title, albumId])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
}
async function clean() {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZENW%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZENW%'`);
  await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZENW%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZENW%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const isCode = (code) => (e) => e.code === code;
const artistRow = async (id) => (await pool.query(
  `SELECT musicbrainz_id, bandcamp_url, country, country_source, formed_year, formed_source, disbanded_year, disbanded_source,
          last_release_year, last_release_source, first_release_year, first_release_source FROM artists WHERE id = $1`, [id])).rows[0];
const reviewRow = async (id) => (await pool.query(`SELECT match_decision, matched_mbid, finished_at FROM artist_enrichment_review WHERE artist_id = $1`, [id])).rows[0];
const membersOf = async (id) => (await pool.query(`SELECT id, name, is_current, vegan, source FROM artist_members WHERE artist_id = $1 ORDER BY id`, [id])).rows;
const inQueue = async (queue, id) => (await svc.list(pool, { queue, q: 'ZZZENW', limit: 200 })).rows.some((r) => r.id === id);

test('approve writes musicbrainz_id through saveIdentity and records the decision for that id', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW Approve');
  await mkProposal(id, { mbid: mb.toUpperCase(), confidence: 'HIGH', method: 'MB_TITLE_VERIFIED', country: 'Italy', country_source: 'MusicBrainz' });
  const before = await svc.getReview(pool, id);
  assert.equal(before.match.state, 'needs-approval');
  const r = await svc.decideMatch(pool, id, 'approve');
  assert.equal(r.match.state, 'approved');
  assert.equal((await artistRow(id)).musicbrainz_id, mb);
  const rev = await reviewRow(id);
  assert.equal(rev.match_decision, 'approved'); assert.equal(rev.matched_mbid, mb);
  assert.equal(r.fields.find((f) => f.field === 'country').locked, false);
  await assert.rejects(svc.decideMatch(pool, id, 'nope'), isCode('BAD_INPUT'));
  await assert.rejects(svc.decideMatch(pool, -1, 'approve'), isCode('NOT_FOUND'));
  const none = await mkArtist('ZZZENW No Id');
  await mkProposal(none, { country: 'Italy', country_source: 'Wikidata' });
  await assert.rejects(svc.decideMatch(pool, none, 'approve'), isCode('BAD_INPUT'));
  const noProp = await mkArtist('ZZZENW No Proposal');
  await assert.rejects(svc.decideMatch(pool, noProp, 'approve'), isCode('NOT_FOUND'));
});

test('approve of an id stored on another artist is CONFLICT and writes nothing (no identity change, no review row)', async () => {
  const mb = randomUUID();
  await mkArtist('ZZZENW Holder', { musicbrainz_id: mb });
  const id = await mkArtist('ZZZENW Wants');
  await mkProposal(id, { mbid: mb, confidence: 'HIGH' });
  await assert.rejects(svc.decideMatch(pool, id, 'approve'), (e) => e.code === 'CONFLICT' && !/duplicate key|violates/i.test(e.message));
  assert.equal((await artistRow(id)).musicbrainz_id, null);
  assert.equal(await reviewRow(id), undefined);
});

test('reject records the decision, writes nothing to artists, and locks MusicBrainz/Wikidata rows', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW Reject');
  await mkProposal(id, { mbid: mb, confidence: 'EXACT_ID', country: 'Peru', country_source: 'Wikidata', formed: 2001, formed_source: 'MusicBrainz',
    last: 2010, last_source: 'Catalogue Albums' });
  const pre = await artistRow(id);
  assert.equal((await svc.getReview(pool, id)).fields.find((f) => f.field === 'country').locked, false); // pretrusted
  const r = await svc.decideMatch(pool, id, 'reject');
  assert.equal(r.match.state, 'rejected');
  assert.deepEqual(await artistRow(id), pre);
  const rev = await reviewRow(id);
  assert.equal(rev.match_decision, 'rejected'); assert.equal(rev.matched_mbid, mb);
  assert.deepEqual(r.fields.map((f) => [f.field, f.locked]), [['country', true], ['formed_year', true], ['last_release_year', false]]);
  // clear puts it back to undecided
  const c = await svc.decideMatch(pool, id, 'clear');
  assert.equal(c.match.state, 'pretrusted');
  const cr = await reviewRow(id);
  assert.equal(cr.match_decision, null); assert.equal(cr.matched_mbid, null);
  // rejecting an id that is already stored is refused
  const stored = await mkArtist('ZZZENW Reject Stored', { musicbrainz_id: randomUUID() });
  const sid = (await artistRow(stored)).musicbrainz_id;
  await mkProposal(stored, { mbid: sid, confidence: 'HIGH' });
  await assert.rejects(svc.decideMatch(pool, stored, 'reject'), (e) => e.code === 'BAD_INPUT' && /clear it under Links first/.test(e.message));
  assert.equal(await reviewRow(stored), undefined);
});

test('clear only undoes a rejection: an approved decision or no decision is BAD_INPUT and the review row is unchanged', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW Clear Approved');
  await mkProposal(id, { mbid: mb, confidence: 'EXACT_ID', country: 'Chad', country_source: 'MusicBrainz' });
  // no decision row yet
  await assert.rejects(svc.decideMatch(pool, id, 'clear'), (e) => e.code === 'BAD_INPUT' && e.message === 'Only a rejected match can be undone');
  assert.equal(await reviewRow(id), undefined);
  // approved, then the id cleared under Links: a clear sent straight to the API must not make the match pre-trusted again
  await svc.decideMatch(pool, id, 'approve');
  await saveIdentity(pool, id, 'musicbrainz', null);
  const snap = await reviewRow(id);
  await assert.rejects(svc.decideMatch(pool, id, 'clear'), isCode('BAD_INPUT'));
  assert.deepEqual(await reviewRow(id), snap);
  assert.equal(snap.match_decision, 'approved');
  const res = await svc.acceptAll(pool, id);
  assert.ok(!res.applied.includes('match'));
  assert.equal((await artistRow(id)).musicbrainz_id, null);
});

test('a decision for an old id stops applying after the proposal\'s id changes', async () => {
  const [x, y] = [randomUUID(), randomUUID()];
  const id = await mkArtist('ZZZENW Old Id');
  await mkProposal(id, { mbid: x, confidence: 'HIGH' });
  await svc.decideMatch(pool, id, 'reject');
  assert.equal((await svc.getReview(pool, id)).match.state, 'rejected');
  await pool.query(`UPDATE artist_enrichment_proposals SET proposed_musicbrainz_id = $2 WHERE artist_id = $1`, [id, y]); // the analysis re-ran
  const r = await svc.getReview(pool, id);
  assert.equal(r.match.state, 'needs-approval');
  assert.equal(r.match.proposed_mbid, y);
});

test('acceptField saves value and source; Skip (never calling anything) stores nothing', async () => {
  const id = await mkArtist('ZZZENW Field', { country: 'USA' });
  await mkProposal(id, { mbid: randomUUID(), country: 'United States', country_source: 'Wikidata', formed: 1995, formed_source: 'MusicBrainz',
    disbanded: 2015, disbanded_source: 'Gemini Web Search', last: 2014, last_source: 'Catalogue Albums' });
  let r = await svc.acceptField(pool, id, 'country');
  let a = await artistRow(id);
  assert.equal(a.country, 'United States'); assert.equal(a.country_source, 'Wikidata');
  assert.ok(!r.fields.some((f) => f.field === 'country'), 'an accepted row disappears');
  r = await svc.acceptField(pool, id, 'last_release_year');
  a = await artistRow(id);
  assert.equal(a.last_release_year, 2014); assert.equal(a.last_release_source, 'Catalogue Albums');
  await svc.acceptField(pool, id, 'disbanded_year');
  a = await artistRow(id);
  assert.equal(a.disbanded_year, 2015); assert.equal(a.disbanded_source, 'Gemini Web Search');
  // formed_year was skipped: nothing stored
  assert.equal(a.formed_year, null); assert.equal(a.formed_source, null);
});

test('acceptField on first_release_year saves the year and its source through saveFacts, leaving the other facts alone', async () => {
  const id = await mkArtist('ZZZENW First');
  await mkProposal(id, { mbid: randomUUID(), first: 1996, first_source: 'MusicBrainz', country: 'Peru', country_source: 'Bandcamp' });
  assert.equal((await artistRow(id)).first_release_year, null);
  const r = await svc.acceptField(pool, id, 'first_release_year');
  const a = await artistRow(id);
  assert.equal(a.first_release_year, 1996); assert.equal(a.first_release_source, 'MusicBrainz');
  assert.equal(a.country, null, 'only the accepted row is written');
  assert.ok(!r.fields.some((f) => f.field === 'first_release_year'), 'an accepted row disappears');
  assert.ok(r.fields.some((f) => f.field === 'country'), 'the other rows stay proposed');
});

test('acceptField on a locked row is CONFLICT and writes nothing', async () => {
  const id = await mkArtist('ZZZENW Locked');
  await mkProposal(id, { mbid: randomUUID(), confidence: 'HIGH', country: 'Chile', country_source: 'MusicBrainz' });
  const pre = await artistRow(id);
  await assert.rejects(svc.acceptField(pool, id, 'country'), (e) => e.code === 'CONFLICT' && e.message === 'Approve the match first');
  assert.deepEqual(await artistRow(id), pre);
});

test('acceptField with an unknown field name is BAD_INPUT; a field with no proposal is NOT_FOUND', async () => {
  const id = await mkArtist('ZZZENW Unknown');
  await mkProposal(id, { country: 'Chile', country_source: 'Wikidata' });
  for (const f of ['musicbrainz_id', 'name', 'constructor', '__proto__', '', null, 42]) {
    await assert.rejects(svc.acceptField(pool, id, f), isCode('BAD_INPUT'), String(f));
  }
  await assert.rejects(svc.acceptField(pool, id, 'formed_year'), (e) => e.code === 'NOT_FOUND' && e.message === 'Nothing proposed for that field');
  await assert.rejects(svc.acceptField(pool, -1, 'country'), isCode('NOT_FOUND'));
});

test('bandcamp_url accept goes through saveIdentity and normalises to the origin', async () => {
  const id = await mkArtist('ZZZENW Bandcamp');
  await mkProposal(id, { mbid: randomUUID(), confidence: 'HIGH', bandcamp: 'https://ZZZENW-bc.bandcamp.com/album/x?y=1' });
  const r = await svc.acceptField(pool, id, 'bandcamp_url'); // never locked, even with an unapproved match
  assert.equal((await artistRow(id)).bandcamp_url, 'https://zzzenw-bc.bandcamp.com');
  assert.ok(!r.fields.some((f) => f.field === 'bandcamp_url'));
});

test('acceptMember adds with vegan=false and the proposal\'s source; a status change leaves vegan alone; an existing hand-entered member is never removed', async () => {
  const id = await mkArtist('ZZZENW Members');
  await pool.query(`INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,'Ann Ex',true,true,'Added by curator')`, [id]);
  await pool.query(`INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,'Hand Only',true,true,'Added by curator')`, [id]);
  await pool.query(`INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,'Bob Same',false,false,'MusicBrainz')`, [id]);
  await mkProposal(id, { mbid: randomUUID(), members: [
    { name: 'ann ex', is_current: false, source: 'MusicBrainz' },
    { name: 'Cleo New', is_current: true, source: 'Gemini Web Search', vegan: true },
    { name: 'Bob Same', is_current: false, source: 'MusicBrainz' },
  ] });
  let r = await svc.acceptMember(pool, id, 'CLEO NEW');
  let m = await membersOf(id);
  const cleo = m.find((x) => x.name === 'Cleo New');
  assert.deepEqual([cleo.is_current, cleo.vegan, cleo.source], [true, false, 'Gemini Web Search']);
  r = await svc.acceptMember(pool, id, 'Ann Ex');
  m = await membersOf(id);
  const ann = m.find((x) => x.name === 'Ann Ex');
  assert.deepEqual([ann.is_current, ann.vegan, ann.source], [false, true, 'Added by curator']);
  assert.ok(m.some((x) => x.name === 'Hand Only'), 'hand-entered member kept');
  assert.equal(r.members.length, 0);
  // an already-equal member is a no-op that succeeds
  await svc.acceptMember(pool, id, 'Bob Same');
  assert.equal((await membersOf(id)).length, 4);
  await assert.rejects(svc.acceptMember(pool, id, 'Nobody'), isCode('NOT_FOUND'));
  await assert.rejects(svc.acceptMember(pool, id, ''), isCode('BAD_INPUT'));
  // locked member
  const lk = await mkArtist('ZZZENW Members Locked');
  await mkProposal(lk, { mbid: randomUUID(), confidence: 'HIGH', members: [{ name: 'Lou', is_current: true, source: 'MusicBrainz' }] });
  await assert.rejects(svc.acceptMember(pool, lk, 'Lou'), isCode('CONFLICT'));
  assert.equal((await membersOf(lk)).length, 0);
});

test('acceptAll on a pretrusted artist approves the match and applies unlocked rows without warnings; warned rows come back skipped', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW All Trusted');
  await mkSong(id, 'ZZZENW all one', 2005);
  await mkProposal(id, { mbid: mb, confidence: 'EXACT_ID', artist_type: 'Person', country: 'Norway', country_source: 'MusicBrainz',
    formed: 2008, formed_source: 'Wikidata', // later than the catalogue's 2005 album -> warned
    last: 2012, last_source: 'Catalogue Albums', bandcamp: 'https://zzzenw-all.bandcamp.com',
    members: [{ name: 'Solo', is_current: true, source: 'MusicBrainz' }] }); // Person with members -> warned
  const res = await svc.acceptAll(pool, id);
  assert.deepEqual(res.applied.sort(), ['bandcamp_url', 'country', 'last_release_year', 'match'].sort());
  assert.deepEqual(res.skipped.map((s) => [s.field, s.reason]).sort(), [['formed_year', 'warning'], ['member:Solo', 'warning']].sort());
  const a = await artistRow(id);
  assert.equal(a.musicbrainz_id, mb); assert.equal(a.country, 'Norway'); assert.equal(a.country_source, 'MusicBrainz');
  assert.equal(a.last_release_year, 2012); assert.equal(a.bandcamp_url, 'https://zzzenw-all.bandcamp.com');
  assert.equal(a.formed_year, null);
  assert.equal((await membersOf(id)).length, 0);
  assert.equal((await reviewRow(id)).match_decision, 'approved');
  assert.equal(res.review.match.state, 'approved');
});

test('acceptAll on a needs-approval artist applies only unlocked rows (Bandcamp, Catalogue Albums) and reports the rest locked', async () => {
  const id = await mkArtist('ZZZENW All High');
  await mkProposal(id, { mbid: randomUUID(), confidence: 'HIGH', country: 'Norway', country_source: 'MusicBrainz',
    formed: 2001, formed_source: 'Wikidata', last: 2012, last_source: 'Catalogue Albums', bandcamp: 'https://zzzenw-high.bandcamp.com',
    members: [{ name: 'Mo', is_current: true, source: 'MusicBrainz' }] });
  const res = await svc.acceptAll(pool, id);
  // the proposed Bandcamp url is a name match too: Accept all fills it only once the match is approved
  assert.deepEqual(res.applied.sort(), ['last_release_year']);
  assert.deepEqual(res.skipped.map((s) => [s.field, s.reason]).sort(),
    [['bandcamp_url', 'warning'], ['country', 'locked'], ['formed_year', 'locked'], ['member:Mo', 'locked']]);
  const a = await artistRow(id);
  assert.equal(a.musicbrainz_id, null); assert.equal(a.country, null); assert.equal(a.bandcamp_url, null);
  assert.equal(await reviewRow(id), undefined);
  // an EXACT_ID match whose id another artist stores: the shared id warns, so the match is skipped and its rows stay locked
  const mb = randomUUID();
  await mkArtist('ZZZENW All Holder', { musicbrainz_id: mb });
  const c = await mkArtist('ZZZENW All Clash');
  await mkProposal(c, { mbid: mb, confidence: 'EXACT_ID', country: 'Norway', country_source: 'MusicBrainz' });
  const rc = await svc.acceptAll(pool, c);
  assert.deepEqual(rc.skipped.filter((s) => s.field === 'match'), [{ field: 'match', reason: 'warning' }]);
  assert.deepEqual(rc.skipped.filter((s) => s.field === 'country').map((s) => s.reason), ['locked']);
  assert.deepEqual(rc.applied, []);
  assert.equal((await artistRow(c)).musicbrainz_id, null);
  assert.equal(await reviewRow(c), undefined);
  // a direct approve of that stored id is still CONFLICT with a fixed message and writes nothing
  await assert.rejects(svc.decideMatch(pool, c, 'approve'),
    (e) => e.code === 'CONFLICT' && e.message === 'Another artist in the catalogue already has that MusicBrainz id');
  assert.equal((await artistRow(c)).musicbrainz_id, null);
  assert.equal(await reviewRow(c), undefined);
});

test('pretrusted + id proposed for another artist -> needs-approval, acceptAll skips the match as warning, rows stay locked, direct acceptField is CONFLICT', async () => {
  const mb = randomUUID();
  const other = await mkArtist('ZZZENW Shared Other');
  await mkProposal(other, { mbid: mb, confidence: 'EXACT_ID' });
  const id = await mkArtist('ZZZENW Shared Mine');
  await mkProposal(id, { mbid: mb, confidence: 'EXACT_ID', country: 'Wales', country_source: 'MusicBrainz', formed: 2001, formed_source: 'Wikidata',
    bandcamp: 'https://zzzenw-shared.bandcamp.com', members: [{ name: 'Sha', is_current: true, source: 'MusicBrainz' }] });
  const r = await svc.getReview(pool, id);
  assert.equal(r.match.state, 'needs-approval');
  assert.ok(r.warnings.some((w) => w.field === 'match'), 'the match warning stays');
  assert.deepEqual(r.fields.map((f) => [f.field, f.locked]), [['country', true], ['formed_year', true], ['bandcamp_url', false]]);
  assert.equal(r.members[0].locked, true);
  await assert.rejects(svc.acceptField(pool, id, 'country'), (e) => e.code === 'CONFLICT' && e.message === 'Approve the match first');
  const res = await svc.acceptAll(pool, id);
  assert.deepEqual(res.applied, []);
  assert.deepEqual(res.skipped.map((s) => [s.field, s.reason]).sort(),
    [['bandcamp_url', 'warning'], ['country', 'locked'], ['formed_year', 'locked'], ['match', 'warning'], ['member:Sha', 'locked']]);
  const a = await artistRow(id);
  assert.equal(a.musicbrainz_id, null); assert.equal(a.country, null); assert.equal(a.formed_year, null); assert.equal(a.bandcamp_url, null);
  assert.equal((await membersOf(id)).length, 0);
  assert.equal(await reviewRow(id), undefined);
  // the curator can still approve it explicitly (no artist stores the id), which unlocks the rows
  const ap = await svc.decideMatch(pool, id, 'approve');
  assert.equal(ap.match.state, 'approved');
  assert.equal((await artistRow(id)).musicbrainz_id, mb);
  assert.ok(ap.fields.every((f) => !f.locked));
});

test('an exact match the later check found to be someone else: acceptAll never approves it or writes its MusicBrainz facts; the curator can still approve explicitly', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW WrongId');
  await mkProposal(id, { mbid: mb, confidence: 'EXACT_ID', country: 'Wales', country_source: 'MusicBrainz', bandcamp: 'https://zzzenw-wrong.bandcamp.com',
    conflicts: { l4c2_resolution: { status: 'WRONG_MBID_IDENTITY_CORRECTED' } } });
  const r = await svc.getReview(pool, id);
  assert.equal(r.match.state, 'needs-approval');
  const res = await svc.acceptAll(pool, id);
  assert.ok(!res.applied.includes('match'), 'the match is not approved');
  assert.ok(!res.applied.includes('country'), 'the MusicBrainz country is not written');
  assert.ok(res.skipped.some((s) => s.field === 'match' && s.reason === 'warning'));
  const a = await artistRow(id);
  assert.equal(a.musicbrainz_id, null); assert.equal(a.country, null);
  assert.equal(await reviewRow(id), undefined);
  const ap = await svc.decideMatch(pool, id, 'approve'); // an explicit, informed approval is still possible
  assert.equal(ap.match.state, 'approved');
});

test('acceptAll twice is idempotent (second call applied = [])', async () => {
  const id = await mkArtist('ZZZENW All Twice');
  await mkProposal(id, { mbid: randomUUID(), confidence: 'EXACT_ID', country: 'Mali', country_source: 'Wikidata',
    bandcamp: 'https://zzzenw-twice.bandcamp.com', members: [{ name: 'Ty', is_current: true, source: 'MusicBrainz' }] });
  const first = await svc.acceptAll(pool, id);
  assert.deepEqual(first.applied.sort(), ['bandcamp_url', 'country', 'match', 'member:Ty']);
  const snap = [await artistRow(id), await membersOf(id), await reviewRow(id)];
  const second = await svc.acceptAll(pool, id);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, []);
  assert.deepEqual([await artistRow(id), await membersOf(id), await reviewRow(id)], snap);
});

test('approve, then clear the id under Links: the MusicBrainz/Wikidata rows lock again and Accept all neither re-approves nor applies them', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW Cleared');
  await mkProposal(id, { mbid: mb, confidence: 'EXACT_ID', country: 'Laos', country_source: 'MusicBrainz', formed: 2003, formed_source: 'Wikidata',
    last: 2011, last_source: 'Catalogue Albums' });
  assert.equal((await svc.decideMatch(pool, id, 'approve')).match.state, 'approved');
  await saveIdentity(pool, id, 'musicbrainz', null); // what the Links panel's clear does
  const r = await svc.getReview(pool, id);
  assert.equal(r.match.state, 'needs-approval');
  assert.deepEqual(r.fields.map((f) => [f.field, f.locked]), [['country', true], ['formed_year', true], ['last_release_year', false]]);
  await assert.rejects(svc.acceptField(pool, id, 'country'), (e) => e.code === 'CONFLICT' && e.message === 'Approve the match first');
  const res = await svc.acceptAll(pool, id);
  assert.deepEqual(res.applied, ['last_release_year']);
  assert.deepEqual(res.skipped.map((s) => [s.field, s.reason]).sort(), [['country', 'locked'], ['formed_year', 'locked']]);
  const a = await artistRow(id);
  assert.equal(a.musicbrainz_id, null); assert.equal(a.country, null); assert.equal(a.formed_year, null);
});

test('EXACT_ID with a different id stored now: needs approval, and Accept all leaves the stored id alone', async () => {
  const [stored, proposed] = [randomUUID(), randomUUID()];
  const id = await mkArtist('ZZZENW Other Stored', { musicbrainz_id: stored });
  await mkProposal(id, { mbid: proposed, confidence: 'EXACT_ID', country: 'Fiji', country_source: 'MusicBrainz' });
  const r = await svc.getReview(pool, id);
  assert.equal(r.match.state, 'needs-approval');
  assert.equal(r.match.stored_mbid, stored); assert.equal(r.match.proposed_mbid, proposed);
  const res = await svc.acceptAll(pool, id);
  assert.ok(!res.applied.includes('match'));
  assert.deepEqual(res.skipped.map((s) => [s.field, s.reason]), [['country', 'locked']]);
  const a = await artistRow(id);
  assert.equal(a.musicbrainz_id, stored); assert.equal(a.country, null);
  assert.equal(await reviewRow(id), undefined);
});

test('Accept all is fill-only: empty values are filled, stored values, a stored Bandcamp url and member status changes are skipped as replace', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW Fill', { country: 'USA', bandcamp_url: 'https://zzzenw-mine.bandcamp.com' });
  await pool.query(`INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,'Old Hand',true,true,'Added by curator')`, [id]);
  await mkProposal(id, { mbid: mb, confidence: 'EXACT_ID', country: 'United States', country_source: 'Wikidata', formed: 1999, formed_source: 'MusicBrainz',
    bandcamp: 'https://zzzenw-other.bandcamp.com', members: [
      { name: 'Old Hand', is_current: false, source: 'MusicBrainz' }, { name: 'New Face', is_current: true, source: 'MusicBrainz' }] });
  const first = await svc.acceptAll(pool, id);
  assert.deepEqual(first.applied.sort(), ['formed_year', 'match', 'member:New Face']);
  const replaced = [['bandcamp_url', 'replace'], ['country', 'replace'], ['member:Old Hand', 'replace']];
  assert.deepEqual(first.skipped.map((s) => [s.field, s.reason]).sort(), replaced);
  let a = await artistRow(id);
  assert.equal(a.musicbrainz_id, mb); assert.equal(a.formed_year, 1999); assert.equal(a.formed_source, 'MusicBrainz');
  assert.equal(a.country, 'USA'); assert.equal(a.country_source, 'Added by curator');
  assert.equal(a.bandcamp_url, 'https://zzzenw-mine.bandcamp.com');
  const m = await membersOf(id);
  assert.deepEqual(m.map((x) => [x.name, x.is_current, x.vegan]), [['Old Hand', true, true], ['New Face', true, false]]);
  // the second run changes nothing and reports the same replace rows
  const snap = [await artistRow(id), await membersOf(id), await reviewRow(id)];
  const second = await svc.acceptAll(pool, id);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped.map((s) => [s.field, s.reason]).sort(), replaced);
  assert.deepEqual([await artistRow(id), await membersOf(id), await reviewRow(id)], snap);
  // a per-row Accept still replaces
  await svc.acceptField(pool, id, 'country');
  a = await artistRow(id);
  assert.equal(a.country, 'United States'); assert.equal(a.country_source, 'Wikidata');
});

test('finish sets and clears finished_at and moves the artist between enr-review and enr-done', async () => {
  const mb = randomUUID();
  const id = await mkArtist('ZZZENW Finish');
  await mkProposal(id, { mbid: mb, confidence: 'HIGH', country: 'Ghana', country_source: 'Wikidata' });
  await svc.decideMatch(pool, id, 'reject');
  assert.ok(await inQueue('enr-review', id)); assert.ok(!(await inQueue('enr-done', id)));
  let r = await svc.finish(pool, id, true);
  assert.ok(r.finished_at);
  assert.equal((await reviewRow(id)).match_decision, 'rejected', 'finish keeps the decision');
  assert.ok(!(await inQueue('enr-review', id))); assert.ok(await inQueue('enr-done', id));
  await svc.decideMatch(pool, id, 'clear');
  assert.ok((await reviewRow(id)).finished_at, 'a decision keeps finished_at');
  r = await svc.finish(pool, id, false);
  assert.equal(r.finished_at, null);
  assert.ok(await inQueue('enr-review', id)); assert.ok(!(await inQueue('enr-done', id)));
  await assert.rejects(svc.finish(pool, id, 'yes'), isCode('BAD_INPUT'));
  const noProp = await mkArtist('ZZZENW Finish None');
  await assert.rejects(svc.finish(pool, noProp, true), isCode('NOT_FOUND'));
  assert.equal(await reviewRow(noProp), undefined);
  // finishing an artist with no review row creates one
  const fresh = await mkArtist('ZZZENW Finish Fresh');
  await mkProposal(fresh, { country: 'Ghana', country_source: 'Wikidata' });
  assert.ok((await svc.finish(pool, fresh, true)).finished_at);
});

async function exercise() {
  const id = await mkArtist('ZZZENW Exercise');
  await mkSong(id, 'ZZZENW exercise song', 2000);
  await pool.query(`INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,'Ex Old',true,false,'MusicBrainz')`, [id]);
  await mkProposal(id, { mbid: randomUUID(), confidence: 'HIGH', country: 'Cuba', country_source: 'Wikidata', last: 2003, last_source: 'Catalogue Albums',
    bandcamp: 'https://zzzenw-ex.bandcamp.com', members: [{ name: 'Ex Old', is_current: false, source: 'MusicBrainz' }, { name: 'Ex New', is_current: true, source: 'MusicBrainz' }] });
  return id;
}
async function runAll(id) {
  await svc.decideMatch(pool, id, 'reject');
  await svc.decideMatch(pool, id, 'clear');
  await svc.acceptField(pool, id, 'last_release_year');
  await svc.decideMatch(pool, id, 'approve');
  await svc.acceptField(pool, id, 'country');
  await svc.acceptMember(pool, id, 'Ex New');
  await svc.acceptAll(pool, id);
  await svc.finish(pool, id, true);
  await svc.finish(pool, id, false);
}

test('none of these touch artist_enrichment_proposals (row count and updated_at unchanged)', async () => {
  const id = await exercise();
  const snap = async () => (await pool.query(`SELECT count(*)::int AS n, max(updated_at) AS mx,
      (SELECT updated_at FROM artist_enrichment_proposals WHERE artist_id = $1) AS mine,
      (SELECT md5(row(proposed_musicbrainz_id, proposed_country, proposed_members::text, review_status)::text) FROM artist_enrichment_proposals WHERE artist_id = $1) AS h
    FROM artist_enrichment_proposals WHERE artist_id IN (SELECT id FROM artists WHERE name LIKE 'ZZZENW%')`, [id])).rows[0];
  // Scoped to this file's sentinel artists: the analysis project writes the rest of the table while it runs, so a table-wide
  // count / max(updated_at) would fail whenever one of its runs is open. Our code only ever addresses a row by artist id.
  const before = await snap();
  await runAll(id);
  assert.deepEqual(await snap(), before);
});

test('no song_artists, songs or lyrics rows change', async () => {
  const id = await exercise();
  const snap = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM song_artists) AS sa, (SELECT count(*)::int FROM songs) AS s,
    (SELECT count(*)::int FROM song_lyrics) AS l,
    (SELECT md5(string_agg(sa.song_id::text, ',' ORDER BY sa.song_id)) FROM song_artists sa WHERE sa.artist_id = $1) AS mine`, [id])).rows[0];
  const before = await snap();
  await runAll(id);
  assert.deepEqual(await snap(), before);
});
