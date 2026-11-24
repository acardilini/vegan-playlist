const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Test-only admin password, set before the router is required (never the real one).
const PW = 'ZZZENT-test-pw';
process.env.ADMIN_PASSWORD = PW;
const pool = require('../database/db');
const adminRouter = require('../routes/admin');

// Fixture sentinel for this file: ZZZENT (artist names). Proposal and review rows cascade from the sentinel artists.
let server, base, lockedId, plainId;
const H = { 'X-Admin-Password': PW, 'Content-Type': 'application/json' };
const call = (method, p, body, headers = H) => fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

async function clean() { await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZENT%'`); }

before(async () => {
  await clean();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
  // A proposal naming a MusicBrainz id the curator has not approved: its fields are locked.
  lockedId = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ('ZZZENT Locked','manual') RETURNING id`)).rows[0].id;
  await pool.query(
    `INSERT INTO artist_enrichment_proposals (artist_id, proposed_musicbrainz_id, mbid_match_method, mbid_confidence, proposed_country, country_source, layers_completed, review_status, updated_at)
     VALUES ($1,'11111111-2222-4333-8444-555555555555','MB_TITLE_VERIFIED','HIGH','Italy','MusicBrainz','{}','pending',TIMESTAMP '2026-01-01 00:00:00')`, [lockedId]);
  plainId = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ('ZZZENT Plain','manual') RETURNING id`)).rows[0].id;
});
after(async () => { await clean(); await new Promise((r) => server.close(r)); await pool.end(); });

const ROUTES = (id) => [
  ['GET', '/enrichment/queues'],
  ['GET', '/enrichment/queue?queue=enr-review'],
  ['GET', `/artists/${id}/enrichment`],
  ['PUT', `/artists/${id}/enrichment/match`, { decision: 'approve' }],
  ['POST', `/artists/${id}/enrichment/accept`, { field: 'country' }],
  ['POST', `/artists/${id}/enrichment/accept-all`, {}],
  ['PUT', `/artists/${id}/enrichment/finish`, { finished: true }],
];

test('every enrichment route requires the admin header', async () => {
  for (const [m, p, b] of ROUTES(lockedId)) {
    const r = await call(m, p, b, { 'Content-Type': 'application/json' });
    assert.equal(r.status, 401, `${m} ${p}`);
    const wrong = await call(m, p, b, { 'X-Admin-Password': 'nope', 'Content-Type': 'application/json' });
    assert.equal(wrong.status, 401, `${m} ${p} wrong password`);
  }
});

test('queues lists the four queues with counts', async () => {
  const r = await call('GET', '/enrichment/queues');
  assert.equal(r.status, 200);
  const { queues } = await r.json();
  assert.deepEqual(queues.map((q) => q.key), ['enr-review', 'enr-match', 'enr-dupes', 'enr-done']);
  for (const q of queues) { assert.equal(typeof q.label, 'string'); assert.equal(typeof q.count, 'number'); }
});

test('queue list takes queue, q, limit and offset; unknown queue is 400', async () => {
  const r = await call('GET', '/enrichment/queue?queue=enr-match&q=ZZZENT&limit=10&offset=0');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.rows.some((x) => x.id === lockedId));
  assert.equal((await call('GET', '/enrichment/queue?queue=nope')).status, 400);
  assert.equal((await call('GET', `/enrichment/queue?queue=enr-match&q=${'x'.repeat(500)}`)).status, 200);
});

test('review of a fixture artist; no proposal reports has_proposal false; unknown artist is 404', async () => {
  const r = await call('GET', `/artists/${lockedId}/enrichment`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.has_proposal, true);
  assert.equal(body.match.state, 'needs-approval');
  const none = await (await call('GET', `/artists/${plainId}/enrichment`)).json();
  assert.equal(none.has_proposal, false);
  assert.equal((await call('GET', '/artists/999999999/enrichment')).status, 404);
  assert.equal((await call('GET', '/artists/abc/enrichment')).status, 404);
});

test('match: a bad decision is 400, an unknown artist is 404', async () => {
  assert.equal((await call('PUT', `/artists/${lockedId}/enrichment/match`, { decision: 'nope' })).status, 400);
  assert.equal((await call('PUT', `/artists/${lockedId}/enrichment/match`, {})).status, 400);
  assert.equal((await call('PUT', '/artists/999999999/enrichment/match', { decision: 'approve' })).status, 404);
});

test('accept: both or neither of field/member is 400; non-strings are 400; a locked row is 409; unknown artist 404', async () => {
  const p = `/artists/${lockedId}/enrichment/accept`;
  assert.equal((await call('POST', p, { field: 'country', member: 'X' })).status, 400);
  assert.equal((await call('POST', p, {})).status, 400);
  assert.equal((await call('POST', p, { field: 5 })).status, 400);
  assert.equal((await call('POST', p, { member: ['x'] })).status, 400);
  assert.equal((await call('POST', p, { field: 'nonsense' })).status, 400);
  assert.equal((await call('POST', p, { field: 'country' })).status, 409);
  assert.equal((await call('POST', '/artists/999999999/enrichment/accept', { field: 'country' })).status, 404);
});

test('accept-all on a locked proposal applies nothing; unknown artist is 404', async () => {
  const r = await call('POST', `/artists/${lockedId}/enrichment/accept-all`, {});
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.applied.length, 0);
  assert.equal((await call('POST', '/artists/999999999/enrichment/accept-all', {})).status, 404);
});

test('finish: a non-boolean is 400; a boolean is accepted; unknown artist is 404', async () => {
  const p = `/artists/${lockedId}/enrichment/finish`;
  assert.equal((await call('PUT', p, { finished: 'yes' })).status, 400);
  assert.equal((await call('PUT', p, {})).status, 400);
  assert.equal((await call('PUT', p, { finished: true })).status, 200);
  assert.equal((await call('PUT', p, { finished: false })).status, 200);
  assert.equal((await call('PUT', '/artists/999999999/enrichment/finish', { finished: true })).status, 404);
});

// ---- privacy: the proposal tables are read and written by one service, reached only through admin.js ----

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const ROOT = path.join(__dirname, '..');

test('only services/artistEnrichment.js names the enrichment tables or is required, apart from admin.js requiring it', () => {
  const allowed = new Set([path.join(ROOT, 'services', 'artistEnrichment.js'), path.join(ROOT, 'routes', 'admin.js')]);
  for (const dir of ['routes', 'services', 'utils']) {
    for (const f of sourceFiles(path.join(ROOT, dir))) {
      if (allowed.has(f)) continue;
      const src = fs.readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f);
      assert.ok(!/artist_enrichment/.test(src), `${rel} must not name the enrichment tables`);
      assert.ok(!/artistEnrichment/.test(src), `${rel} must not require the enrichment service`);
    }
  }
});

test('routes/admin.js requires the service but never names the tables', () => {
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'admin.js'), 'utf8');
  assert.match(src, /require\('\.\.\/services\/artistEnrichment'\)/);
  assert.ok(!/artist_enrichment_proposals/.test(src));
  assert.ok(!/artist_enrichment_review/.test(src));
});
