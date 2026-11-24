const { test, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const pool = require('../database/db');
const svc = require('../services/artistEnrichment');

// Fixture sentinel for this file: ZZZENR. Proposal and review rows cascade from the sentinel artists.
async function mkArtist(name, f = {}) {
  return (await pool.query(
    `INSERT INTO artists (name, data_source, musicbrainz_id, bandcamp_url, country, country_source, formed_year, formed_source,
                          disbanded_year, disbanded_source, last_release_year, last_release_source)
     VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [name, f.musicbrainz_id || null, f.bandcamp_url || null, f.country || null, f.country ? 'Added by curator' : null,
     f.formed_year || null, f.formed_year ? 'Added by curator' : null, f.disbanded_year || null, f.disbanded_year ? 'Added by curator' : null,
     f.last_release_year || null, f.last_release_year ? 'Added by curator' : null])).rows[0].id;
}
async function mkProposal(artistId, p = {}) {
  await pool.query(
    `INSERT INTO artist_enrichment_proposals (artist_id, proposed_musicbrainz_id, mbid_match_method, mbid_confidence, artist_type,
       proposed_country, country_source, country_confidence, proposed_formed_year, formed_source, formed_confidence,
       proposed_disbanded_year, disbanded_source, disbanded_confidence, proposed_last_release_year, last_release_source,
       last_release_confidence, proposed_bandcamp_url, proposed_members, layers_completed, review_status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'{}','pending',CURRENT_TIMESTAMP)`,
    [artistId, p.mbid || null, p.method || (p.mbid ? 'MB_SPOTIFY_URL' : null), p.confidence || (p.mbid ? 'EXACT_ID' : null), p.artist_type || null,
     p.country || null, p.country_source || null, p.country_confidence || null,
     p.formed || null, p.formed_source || null, p.formed_confidence || null,
     p.disbanded || null, p.disbanded_source || null, p.disbanded_confidence || null,
     p.last || null, p.last_source || null, p.last_confidence || null,
     p.bandcamp || null, p.members === undefined ? null : JSON.stringify(p.members)]);
}
async function mkReview(artistId, { decision = null, mbid = null, finished = false } = {}) {
  await pool.query(`INSERT INTO artist_enrichment_review (artist_id, match_decision, matched_mbid, finished_at) VALUES ($1,$2,$3,$4)`,
    [artistId, decision, mbid, finished ? new Date() : null]);
}
async function mkSong(artistId, title, { year = null } = {}) {
  let albumId = null;
  if (year) albumId = (await pool.query(`INSERT INTO albums (name, release_date, data_source) VALUES ($1,$2,'manual') RETURNING id`,
    [`${title} album`, `${year}-06-01`])).rows[0].id;
  const id = (await pool.query(`INSERT INTO songs (title, status, published, album_id, data_source) VALUES ($1,'included',true,$2,'manual') RETURNING id`,
    [title, albumId])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  return id;
}
async function clean() {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZENR%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZENR%'`);
  await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZENR%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZENR%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const isCode = (code) => (e) => e.code === code;
const field = (r, f) => r.fields.find((x) => x.field === f);

test('no proposal -> has_proposal false', async () => {
  const id = await mkArtist('ZZZENR None');
  assert.deepEqual(await svc.getReview(pool, id), { has_proposal: false });
  await assert.rejects(svc.getReview(pool, -1), isCode('NOT_FOUND'));
});

test('equal values are omitted, different shown with current and proposed', async () => {
  const id = await mkArtist('ZZZENR Equal', { country: 'USA', formed_year: 1990, last_release_year: 2010, bandcamp_url: 'https://zzzenr-eq.bandcamp.com' });
  await mkProposal(id, { country: 'United States', country_source: 'Wikidata', country_confidence: 'HIGH',
    formed: 1990, formed_source: 'Wikidata', last: 2012, last_source: 'Catalogue Albums',
    bandcamp: 'https://ZZZENR-eq.bandcamp.com/music' });
  const r = await svc.getReview(pool, id);
  assert.equal(r.has_proposal, true);
  assert.deepEqual(r.fields.map((f) => f.field), ['country', 'last_release_year']);
  const c = field(r, 'country');
  assert.equal(c.current, 'USA'); assert.equal(c.proposed, 'United States');
  assert.equal(c.source, 'Wikidata'); assert.equal(c.confidence, 'HIGH'); assert.equal(c.label, 'Country');
  assert.equal(field(r, 'last_release_year').current, 2010);
  assert.equal(field(r, 'last_release_year').proposed, 2012);
});

test('unknown or null source drops that row but keeps the others', async () => {
  const id = await mkArtist('ZZZENR Source');
  await mkProposal(id, { country: 'Germany', country_source: 'Some Blog', formed: 2001, formed_source: null,
    disbanded: 2015, disbanded_source: 'MusicBrainz', bandcamp: 'https://zzzenr-src.bandcamp.com' });
  const r = await svc.getReview(pool, id);
  assert.deepEqual(r.fields.map((f) => f.field), ['disbanded_year', 'bandcamp_url']);
  const b = field(r, 'bandcamp_url');
  assert.equal(b.source, 'Bandcamp'); assert.equal(b.proposed, 'https://zzzenr-src.bandcamp.com'); assert.equal(b.current, null);
  assert.equal(b.link, 'https://zzzenr-src.bandcamp.com');
});

test('members: new, status change, and an identical member omitted; malformed entry dropped; vegan never in the result', async () => {
  const id = await mkArtist('ZZZENR Members');
  const kept = (await pool.query(`INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,'Ann Ex',true,true,'Added by curator') RETURNING id`, [id])).rows[0].id;
  await pool.query(`INSERT INTO artist_members (artist_id, name, is_current, vegan, source) VALUES ($1,'Bob Same',false,false,'MusicBrainz')`, [id]);
  await mkProposal(id, { members: [
    { name: 'ann ex', is_current: false, source: 'MusicBrainz', vegan: false },
    { name: 'Bob Same', is_current: false, source: 'MusicBrainz' },
    { name: 'Cleo New', is_current: true, source: 'Gemini Web Search', vegan: true, evidence_note: 'x' },
    { name: '', is_current: true, source: 'MusicBrainz' },
    { name: 'No Status', source: 'MusicBrainz' },
    'just a string',
  ] });
  const r = await svc.getReview(pool, id);
  assert.deepEqual(r.members.map((m) => [m.name, m.change]), [['ann ex', 'status'], ['Cleo New', 'new']]);
  assert.deepEqual(r.members[0].existing, { id: kept, is_current: true, vegan: true });
  assert.equal(r.members[1].existing, null);
  for (const m of r.members) assert.ok(!('vegan' in m), 'proposed vegan flag must not pass through');
  assert.equal(r.members[1].source, 'Gemini Web Search');
});

test('state: EXACT_ID pretrusted, HIGH needs-approval, stored equal approved, decision for another id ignored, rejected', async () => {
  const [x, y] = [randomUUID(), randomUUID()];
  assert.equal(svc.matchState({ proposed_musicbrainz_id: null }, null, null), 'none');
  assert.equal(svc.matchState({ proposed_musicbrainz_id: x, mbid_confidence: 'EXACT_ID' }, null, null), 'pretrusted');
  assert.equal(svc.matchState({ proposed_musicbrainz_id: x, mbid_confidence: 'HIGH' }, null, null), 'needs-approval');
  assert.equal(svc.matchState({ proposed_musicbrainz_id: x, mbid_confidence: 'HIGH' }, null, x.toUpperCase()), 'approved');
  assert.equal(svc.matchState({ proposed_musicbrainz_id: x, mbid_confidence: 'HIGH' }, { match_decision: 'approved', matched_mbid: x }, null), 'approved');
  assert.equal(svc.matchState({ proposed_musicbrainz_id: x, mbid_confidence: 'HIGH' }, { match_decision: 'approved', matched_mbid: y }, null), 'needs-approval');
  assert.equal(svc.matchState({ proposed_musicbrainz_id: x, mbid_confidence: 'HIGH' }, { match_decision: 'rejected', matched_mbid: x }, null), 'rejected');
  assert.equal(svc.matchState({ proposed_musicbrainz_id: x, mbid_confidence: 'EXACT_ID' }, { match_decision: 'rejected', matched_mbid: y }, null), 'pretrusted');
  // and through the DB
  const id = await mkArtist('ZZZENR State');
  await mkProposal(id, { mbid: x, confidence: 'HIGH', method: 'MB_TITLE_VERIFIED' });
  await mkReview(id, { decision: 'rejected', mbid: x });
  const r = await svc.getReview(pool, id);
  assert.equal(r.match.state, 'rejected');
  assert.equal(r.match.proposed_mbid, x); assert.equal(r.match.stored_mbid, null);
  assert.equal(r.match.method, 'MB_TITLE_VERIFIED'); assert.equal(r.match.confidence, 'HIGH');
  assert.equal(r.match.url, `https://musicbrainz.org/artist/${x}`);
});

test('MusicBrainz and Wikidata rows are locked until approved; Bandcamp and Catalogue Albums rows never locked', async () => {
  for (const s of ['MusicBrainz', 'Wikidata']) {
    assert.equal(svc.isLocked(s, 'needs-approval'), true);
    assert.equal(svc.isLocked(s, 'rejected'), true);
    assert.equal(svc.isLocked(s, 'none'), true);
    assert.equal(svc.isLocked(s, 'pretrusted'), false);
    assert.equal(svc.isLocked(s, 'approved'), false);
  }
  for (const s of ['Bandcamp', 'Catalogue Albums', 'Gemini Web Search']) assert.equal(svc.isLocked(s, 'needs-approval'), false);
  const mb = randomUUID();
  const id = await mkArtist('ZZZENR Locks');
  await mkProposal(id, { mbid: mb, confidence: 'HIGH', country: 'France', country_source: 'MusicBrainz', formed: 2000, formed_source: 'Wikidata',
    last: 2020, last_source: 'Catalogue Albums', bandcamp: 'https://zzzenr-lock.bandcamp.com', members: [{ name: 'Mo', is_current: true, source: 'MusicBrainz' }] });
  let r = await svc.getReview(pool, id);
  assert.deepEqual(r.fields.map((f) => [f.field, f.locked]), [['country', true], ['formed_year', true], ['last_release_year', false], ['bandcamp_url', false]]);
  assert.equal(r.members[0].locked, true);
  assert.equal(field(r, 'country').link, `https://musicbrainz.org/artist/${mb}`);
  assert.equal(field(r, 'formed_year').link, null);
  await mkReview(id, { decision: 'approved', mbid: mb });
  r = await svc.getReview(pool, id);
  assert.equal(r.match.state, 'approved');
  assert.ok(r.fields.every((f) => !f.locked)); assert.equal(r.members[0].locked, false);
});

test('shared id with another proposal and with a stored id both appear in shared_with and warn', async () => {
  const mb = randomUUID();
  const a = await mkArtist('ZZZENR Share A');
  const b = await mkArtist('ZZZENR Share B');
  const c = await mkArtist('ZZZENR Share C', { musicbrainz_id: mb });
  await mkSong(b, 'ZZZENR share b song');
  await mkProposal(a, { mbid: mb });
  await mkProposal(b, { mbid: mb });
  const r = await svc.getReview(pool, a);
  assert.deepEqual(r.match.shared_with.map((s) => s.id).sort(), [b, c].sort());
  assert.equal(r.match.shared_with.find((s) => s.id === b).songs, 1);
  assert.equal(r.match.shared_with.find((s) => s.id === b).name, 'ZZZENR Share B');
  const w = r.warnings.filter((x) => x.field === 'match');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /ZZZENR Share B/); assert.match(w[0].text, /ZZZENR Share C/);
  // the list flags it too
  const row = (await svc.list(pool, { queue: 'enr-dupes', q: 'ZZZENR Share', limit: 200 })).rows.find((x) => x.id === a);
  assert.equal(row.enrichment.shared, true);
});

test('warnings: last release before catalogue album year, disbanded before last release, formed after first catalogue release, Person with members', async () => {
  const id = await mkArtist('ZZZENR Warn');
  await mkSong(id, 'ZZZENR warn one', { year: 2005 });
  await mkSong(id, 'ZZZENR warn two', { year: 2018 });
  await mkSong(id, 'ZZZENR warn three');
  await mkProposal(id, { artist_type: 'Person', formed: 2008, formed_source: 'Wikidata', disbanded: 2014, disbanded_source: 'Wikidata',
    last: 2016, last_source: 'MusicBrainz', members: [{ name: 'Solo Self', is_current: true, source: 'MusicBrainz' }] });
  const r = await svc.getReview(pool, id);
  assert.equal(r.match.catalogue.songs, 3); assert.equal(r.match.catalogue.live_songs, 3);
  assert.equal(r.match.catalogue.first_year, 2005); assert.equal(r.match.catalogue.last_year, 2018);
  assert.deepEqual(r.match.catalogue.albums, [{ name: 'ZZZENR warn one album', year: 2005 }, { name: 'ZZZENR warn two album', year: 2018 }]);
  const byField = Object.fromEntries(r.warnings.map((w) => [w.field, w.text]));
  assert.deepEqual(Object.keys(byField).sort(), ['disbanded_year', 'formed_year', 'last_release_year', 'members']);
  assert.match(byField.last_release_year, /2016/); assert.match(byField.last_release_year, /2018/);
  assert.match(byField.disbanded_year, /2014/); assert.match(byField.disbanded_year, /2016/);
  assert.match(byField.formed_year, /2008/); assert.match(byField.formed_year, /2005/);
  assert.match(byField.members, /Person/);
  // disbanded is checked against the stored last release when none is proposed
  const id2 = await mkArtist('ZZZENR Warn Two', { last_release_year: 2012 });
  await mkProposal(id2, { disbanded: 2010, disbanded_source: 'MusicBrainz' });
  const r2 = await svc.getReview(pool, id2);
  assert.deepEqual(r2.warnings.map((w) => w.field), ['disbanded_year']);
  assert.match(r2.warnings[0].text, /2012/);
});

test('counts equal list totals for every queue', async () => {
  const done = await mkArtist('ZZZENR Done');
  await mkProposal(done, { country: 'Spain', country_source: 'Wikidata' });
  await mkReview(done, { finished: true });
  const nothing = await mkArtist('ZZZENR Nothing', { country: 'Peru' });
  await mkProposal(nothing, { country: 'Peru', country_source: 'Wikidata' });
  const c = await svc.counts(pool);
  assert.deepEqual(Object.keys(c).sort(), svc.QUEUES.map((q) => q.key).sort());
  for (const q of svc.QUEUES) assert.equal((await svc.list(pool, { queue: q.key, limit: 1 })).total, c[q.key], q.key);
  const ids = async (queue) => (await svc.list(pool, { queue, q: 'ZZZENR', limit: 200 })).rows.map((r) => r.id);
  assert.ok((await ids('enr-done')).includes(done));
  assert.ok(!(await ids('enr-review')).includes(done));
  assert.ok(!(await ids('enr-review')).includes(nothing), 'nothing to review stays out');
});

test('enr-review order: undecided HIGH, then shared, then songs desc', async () => {
  const shared = randomUUID();
  const plain = await mkArtist('ZZZENR Ord Plain');
  const many = await mkArtist('ZZZENR Ord Many');
  const sh = await mkArtist('ZZZENR Ord Shared');
  await mkArtist('ZZZENR Ord Holder', { musicbrainz_id: shared });
  const high = await mkArtist('ZZZENR Ord High');
  const decided = await mkArtist('ZZZENR Ord Decided');
  await mkSong(many, 'ZZZENR ord m1'); await mkSong(many, 'ZZZENR ord m2');
  await mkSong(decided, 'ZZZENR ord d1'); await mkSong(decided, 'ZZZENR ord d2'); await mkSong(decided, 'ZZZENR ord d3');
  await mkProposal(plain, { country: 'Chile', country_source: 'Wikidata' });
  await mkProposal(many, { country: 'Chile', country_source: 'Wikidata' });
  await mkProposal(sh, { mbid: shared });
  const hId = randomUUID(), dId = randomUUID();
  await mkProposal(high, { mbid: hId, confidence: 'HIGH', method: 'MB_TITLE_VERIFIED' });
  await mkProposal(decided, { mbid: dId, confidence: 'HIGH', method: 'MB_TITLE_VERIFIED' });
  await mkReview(decided, { decision: 'rejected', mbid: dId });
  const r = await svc.list(pool, { queue: 'enr-review', q: 'ZZZENR Ord', limit: 200 });
  assert.deepEqual(r.rows.map((x) => x.id), [high, sh, decided, many, plain]);
  assert.equal(r.total, 5);
  const h = r.rows[0];
  assert.deepEqual(h.enrichment, { method: 'MB_TITLE_VERIFIED', confidence: 'HIGH', shared: false });
  assert.deepEqual(Object.keys(h).sort(), ['enrichment', 'id', 'live_songs', 'name', 'songs']);
  const m = await svc.list(pool, { queue: 'enr-match', q: 'ZZZENR Ord', limit: 200 });
  assert.deepEqual(m.rows.map((x) => x.id), [high]);
});

test('search is literal: a name containing % does not act as a wildcard', async () => {
  const pct = await mkArtist('ZZZENR 100% Pure');
  const other = await mkArtist('ZZZENR 100x Pure');
  const und = await mkArtist('ZZZENR a_b');
  const und2 = await mkArtist('ZZZENR axb');
  for (const id of [pct, other, und, und2]) await mkProposal(id, { country: 'Japan', country_source: 'Wikidata' });
  let r = await svc.list(pool, { queue: 'enr-review', q: 'ZZZENR 100%' });
  assert.deepEqual(r.rows.map((x) => x.id), [pct]); assert.equal(r.total, 1);
  r = await svc.list(pool, { queue: 'enr-review', q: 'ZZZENR a_b' });
  assert.deepEqual(r.rows.map((x) => x.id), [und]); assert.equal(r.total, 1);
});

// Global constraint: Layer 4 fields (bio, vegan stance, evidence), website urls, Wikidata ids and Wikipedia extracts are
// neither read nor stored. Scan the service source so a later edit cannot quietly start selecting them.
const EXCLUDED_PROPOSAL_COLS = ['proposed_bio', 'bio_source', 'proposed_vegan_notes', 'artist_vegan_stance', 'propose_no_advocacy_notes',
  'advocacy_confidence', 'evidence_urls', 'evidence_snippets', 'proposed_wikidata_qid', 'proposed_website_url', 'wikipedia_url',
  'wikipedia_extract', 'bandcamp_bio_raw', 'bandcamp_location_raw'];
function proposalReadViolations(src) {
  const bad = [];
  if (/SELECT\s+\*/i.test(src)) bad.push('SELECT *');
  if (/\b[a-z_][a-z0-9_]*\.\*/i.test(src)) bad.push('<alias>.*');
  for (const c of EXCLUDED_PROPOSAL_COLS) if (new RegExp(`\\b${c}\\b`, 'i').test(src)) bad.push(c);
  return bad;
}
test('the service never selects * nor names an excluded proposals column (bio, stance, evidence, website, Wikidata, Wikipedia)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../services/artistEnrichment.js'), 'utf8');
  assert.deepEqual(proposalReadViolations(src), []);
  // the scan itself catches the patterns it is meant to catch
  assert.deepEqual(proposalReadViolations('SELECT * FROM artist_enrichment_proposals'), ['SELECT *']);
  assert.deepEqual(proposalReadViolations('SELECT p.* FROM x p'), ['<alias>.*']);
  assert.deepEqual(proposalReadViolations('SELECT p.wikipedia_extract'), ['wikipedia_extract']);
});

test('unknown queue is BAD_INPUT', async () => {
  await assert.rejects(svc.list(pool, { queue: 'nope' }), isCode('BAD_INPUT'));
  await assert.rejects(svc.list(pool, { queue: 'constructor' }), isCode('BAD_INPUT'));
});
