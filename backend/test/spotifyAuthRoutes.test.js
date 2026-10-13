const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createRouter } = require('../routes/spotifyAuth');

const PW = 'ZZZPUSH-pw';
let server, base, auth, handled;

before(async () => {
  handled = [];
  let n = 0;
  auth = {
    startAuth: () => ({ url: 'https://accounts.spotify.com/authorize?x=1', state: `s${++n}` }),
    _live: new Set(),
    consumeState(s) { return this._live.delete(s); },
    async handleCallback(code) { if (code === 'bad') throw Object.assign(new Error('x'), { code: 'UPSTREAM' }); handled.push(code); },
    status: () => ({ connected: false }),
  };
  const orig = auth.startAuth;
  auth.startAuth = () => { const r = orig(); auth._live.add(r.state); return r; };
  const app = express();
  app.use('/api/spotify-auth', createRouter(auth, { adminPassword: PW, returnUrl: 'http://app.test/admin' }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/spotify-auth`;
});
after(() => server.close());

const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init });

test('start and status require the admin header', async () => {
  assert.equal((await fetch(base + '/start', { method: 'POST' })).status, 401);
  assert.equal((await get('/status')).status, 401);
  const ok = await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).url, /^https:\/\/accounts\.spotify\.com\/authorize/);
  const st = await get('/status', { headers: { 'X-Admin-Password': PW } });
  assert.deepEqual(await st.json(), { connected: false });
});

test('callback: no/unknown state -> 400 and no token exchange', async () => {
  assert.equal((await get('/callback?code=abc')).status, 400);
  assert.equal((await get('/callback?code=abc&state=nope')).status, 400);
  assert.equal(handled.length, 0);
});

test('callback: valid state exchanges the code once, redirects connected; reuse is 400', async () => {
  const { state } = await (await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } })).json().then(() => ({ state: [...auth._live].pop() }));
  const r = await get(`/callback?code=good&state=${state}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'http://app.test/admin?spotify=connected');
  assert.deepEqual(handled, ['good']);
  assert.equal((await get(`/callback?code=good&state=${state}`)).status, 400);
});

test('callback: user denied -> redirect denied, no exchange; exchange failure -> redirect failed (no code in URL)', async () => {
  await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } });
  const s1 = [...auth._live].pop();
  const denied = await get(`/callback?error=access_denied&state=${s1}`);
  assert.equal(denied.headers.get('location'), 'http://app.test/admin?spotify=denied');
  await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } });
  const s2 = [...auth._live].pop();
  const failed = await get(`/callback?code=bad&state=${s2}`);
  assert.equal(failed.headers.get('location'), 'http://app.test/admin?spotify=failed');
  assert.ok(!failed.headers.get('location').includes('bad'));
});

test('callback: repeated code/state params (arrays) cannot slip through', async () => {
  const before = handled.length;
  assert.equal((await get('/callback?code=a&state=x&state=y')).status, 400);
  await fetch(base + '/start', { method: 'POST', headers: { 'X-Admin-Password': PW } });
  const s = [...auth._live].pop();
  const r = await get(`/callback?code=a&code=b&state=${s}`);
  assert.equal(r.headers.get('location'), 'http://app.test/admin?spotify=denied');
  assert.equal(handled.length, before);
});
