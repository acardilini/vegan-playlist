// Spotify user authorisation (sub-project F): the one-time Authorization-Code sign-in that lets the
// backend ADD tracks to the playlist. Only a refresh token is kept, in a gitignored file.
// SECURITY: nothing here may log or rethrow the OAuth code, a token, a request body, or a fetch
// error's message/cause (it can echo the request). Errors carry fixed strings and a `.code`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCOUNTS = 'https://accounts.spotify.com';
const SCOPES = 'playlist-modify-public playlist-modify-private';
const DEFAULT_TOKEN_FILE = path.join(__dirname, '..', '.spotify-token.json');
const DEFAULT_REDIRECT = 'http://127.0.0.1:5000/api/spotify-auth/callback';
const STATE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

function createAuth(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || Date.now;
  const tokenFile = opts.tokenFile || DEFAULT_TOKEN_FILE;
  const cfg = () => ({
    clientId: opts.clientId ?? process.env.SPOTIFY_CLIENT_ID,
    clientSecret: opts.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: opts.redirectUri ?? process.env.SPOTIFY_REDIRECT_URI ?? DEFAULT_REDIRECT,
  });
  const states = new Map(); // state -> expiry ms

  function readToken() {
    try {
      const t = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      return t && typeof t.refresh_token === 'string' && t.refresh_token ? t : null;
    } catch { return null; }
  }
  function writeToken(refresh_token, scope) {
    fs.writeFileSync(tokenFile, JSON.stringify({ refresh_token, scope: scope || SCOPES, obtained_at: new Date(now()).toISOString() }), { mode: 0o600 });
  }

  async function tokenRequest(params) {
    const { clientId, clientSecret } = cfg();
    let res;
    try {
      res = await fetchImpl(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw coded('UPSTREAM', 'could not reach Spotify'); // drops the error: its message can echo the request
    }
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      // REAUTH only for a revoked/expired refresh token; a bad one-time code is just a failed exchange.
      if (params.grant_type === 'refresh_token' && body && body.error === 'invalid_grant') throw coded('REAUTH', 'Spotify authorisation expired — connect again');
      throw coded('UPSTREAM', `Spotify token request failed (HTTP ${res.status})`);
    }
    return body || {};
  }

  return {
    startAuth() {
      for (const [s, exp] of states) if (exp <= now()) states.delete(s); // sweep
      const state = crypto.randomBytes(24).toString('hex');
      states.set(state, now() + STATE_TTL_MS);
      const { clientId, redirectUri } = cfg();
      const url = `${ACCOUNTS}/authorize?` + new URLSearchParams({
        response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirectUri, state,
      });
      return { url, state };
    },
    consumeState(state) {
      if (typeof state !== 'string' || !states.has(state)) return false;
      const exp = states.get(state);
      states.delete(state);
      return exp > now();
    },
    async handleCallback(code) {
      const { redirectUri } = cfg();
      const body = await tokenRequest({ grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri });
      if (!body.refresh_token) throw coded('UPSTREAM', 'Spotify did not return a refresh token');
      writeToken(body.refresh_token, body.scope);
    },
    status() { return { connected: !!readToken() }; },
    async getAccessToken() {
      const tok = readToken();
      if (!tok) throw coded('NOT_CONNECTED', 'Spotify is not connected');
      const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
      if (!body.access_token) throw coded('UPSTREAM', 'Spotify returned no access token');
      if (body.refresh_token && body.refresh_token !== tok.refresh_token) writeToken(body.refresh_token, tok.scope);
      return body.access_token;
    },
  };
}

module.exports = { createAuth, defaultAuth: createAuth() };
