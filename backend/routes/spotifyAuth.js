// Spotify user-auth routes (sub-project F). A SEPARATE router from admin.js on purpose: admin.js
// applies an X-Admin-Password check to every route, and Spotify's redirect back to us is a plain
// browser navigation that cannot send that header. /start and /status keep the header check; the
// callback is guarded by a single-use, 10-minute `state` issued by the authed /start.
const express = require('express');
const { defaultAuth } = require('../services/spotifyAuth');

function createRouter(auth = defaultAuth, { adminPassword, returnUrl } = {}) {
  const router = express.Router();
  const pw = () => adminPassword ?? process.env.ADMIN_PASSWORD;
  const back = () => returnUrl ?? process.env.ADMIN_RETURN_URL ?? 'http://localhost:5173/admin';

  const authed = (req, res, next) => {
    const given = req.headers['x-admin-password'];
    if (!given || given !== pw()) return res.status(401).json({ error: 'Admin authentication required' });
    next();
  };

  router.post('/start', authed, (req, res) => res.json({ url: auth.startAuth().url }));
  router.get('/status', authed, (req, res) => res.json(auth.status()));

  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    // Query values can be arrays/objects (?state=a&state=b); only a non-empty string is acceptable.
    if (typeof state !== 'string' || !state || !auth.consumeState(state)) {
      return res.status(400).send('Invalid or expired state');
    }
    if (error || typeof code !== 'string' || !code) return res.redirect(`${back()}?spotify=denied`);
    try {
      await auth.handleCallback(code);
      res.redirect(`${back()}?spotify=connected`);
    } catch (e) {
      console.error('spotify auth callback failed:', e.code || 'error'); // code only: never the message/cause
      res.redirect(`${back()}?spotify=failed`);
    }
  });
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
