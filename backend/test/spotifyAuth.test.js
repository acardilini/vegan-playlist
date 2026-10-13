const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuth } = require('../services/spotifyAuth');

// No DB and no network: fetch is injected, the token file lives in a temp dir.
const SECRET_REFRESH = 'ZZZPUSH-REFRESH-TOKEN-xyz';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zzzpush-')), 'token.json');
}
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}
const base = (over = {}) => ({
  clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://127.0.0.1:5000/cb', tokenFile: tmpFile(), ...over,
});

test('startAuth builds the authorize URL with scopes, redirect and a fresh state', () => {
  const a = createAuth(base());
  const { url, state } = a.startAuth();
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:5000/cb');
  assert.equal(u.searchParams.get('scope'), 'playlist-modify-public playlist-modify-private');
  assert.equal(u.searchParams.get('state'), state);
  assert.ok(state.length >= 16);
  assert.notEqual(a.startAuth().state, state);
});

test('consumeState: single-use, unknown/missing rejected, expires after 10 minutes', () => {
  let t = 1_000_000;
  const a = createAuth(base({ now: () => t }));
  const { state } = a.startAuth();
  assert.equal(a.consumeState(state), true);
  assert.equal(a.consumeState(state), false, 'reuse');
  assert.equal(a.consumeState('nope'), false);
  assert.equal(a.consumeState(undefined), false);
  const s2 = a.startAuth().state;
  t += 10 * 60 * 1000 + 1;
  assert.equal(a.consumeState(s2), false, 'expired');
});

test('handleCallback stores the refresh token; status reports connected without exposing it', async () => {
  const f = fakeFetch([{ status: 200, body: { access_token: 'AT', refresh_token: SECRET_REFRESH, scope: 'x' } }]);
  const opts = base({ fetchImpl: f });
  const a = createAuth(opts);
  assert.deepEqual(a.status(), { connected: false });
  await a.handleCallback('the-code');
  assert.deepEqual(a.status(), { connected: true });
  assert.equal(JSON.parse(fs.readFileSync(opts.tokenFile, 'utf8')).refresh_token, SECRET_REFRESH);
  const sent = f.calls[0].init.body.toString();
  assert.match(sent, /grant_type=authorization_code/);
  assert.match(sent, /code=the-code/);
  assert.match(f.calls[0].init.headers.Authorization, /^Basic /);
  assert.ok(!JSON.stringify(a.status()).includes(SECRET_REFRESH));
});

test('handleCallback failure throws UPSTREAM and stores nothing; message leaks neither code nor token', async () => {
  const opts = base({ fetchImpl: fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]) });
  const a = createAuth(opts);
  await assert.rejects(() => a.handleCallback('secret-code-123'), (e) => {
    assert.equal(e.code, 'UPSTREAM');
    assert.ok(!e.message.includes('secret-code-123'));
    return true;
  });
  assert.equal(fs.existsSync(opts.tokenFile), false);
});

test('getAccessToken: NOT_CONNECTED without a file; corrupt file also NOT_CONNECTED', async () => {
  const opts = base({ fetchImpl: fakeFetch([]) });
  const a = createAuth(opts);
  await assert.rejects(() => a.getAccessToken(), { code: 'NOT_CONNECTED' });
  fs.writeFileSync(opts.tokenFile, '{not json');
  assert.deepEqual(a.status(), { connected: false });
  await assert.rejects(() => a.getAccessToken(), { code: 'NOT_CONNECTED' });
  fs.writeFileSync(opts.tokenFile, JSON.stringify({ refresh_token: '' }));
  assert.deepEqual(a.status(), { connected: false });
});

test('getAccessToken refreshes, and persists a rotated refresh token when Spotify sends one', async () => {
  const opts = base();
  fs.writeFileSync(opts.tokenFile, JSON.stringify({ refresh_token: 'old' }));
  const f = fakeFetch([
    { status: 200, body: { access_token: 'AT1' } },
    { status: 200, body: { access_token: 'AT2', refresh_token: 'rotated' } },
  ]);
  const a = createAuth({ ...opts, fetchImpl: f });
  assert.equal(await a.getAccessToken(), 'AT1');
  assert.equal(JSON.parse(fs.readFileSync(opts.tokenFile, 'utf8')).refresh_token, 'old');
  assert.equal(await a.getAccessToken(), 'AT2');
  assert.equal(JSON.parse(fs.readFileSync(opts.tokenFile, 'utf8')).refresh_token, 'rotated');
  assert.match(f.calls[0].init.body.toString(), /grant_type=refresh_token/);
});

test('a revoked refresh token (invalid_grant) is REAUTH; network failure is UPSTREAM', async () => {
  const opts = base();
  fs.writeFileSync(opts.tokenFile, JSON.stringify({ refresh_token: SECRET_REFRESH }));
  const revoked = createAuth({ ...opts, fetchImpl: fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]) });
  await assert.rejects(() => revoked.getAccessToken(), { code: 'REAUTH' });
  const down = createAuth({ ...opts, fetchImpl: fakeFetch([new Error(`boom ${SECRET_REFRESH}`)]) });
  await assert.rejects(() => down.getAccessToken(), (e) => {
    assert.equal(e.code, 'UPSTREAM');
    assert.ok(!e.message.includes(SECRET_REFRESH), 'fetch error message must not be rethrown');
    return true;
  });
});
