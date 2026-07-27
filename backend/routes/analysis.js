const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const analysis = require('../services/analysis');
const explore = require('../services/explore');

// Public, read-only qualitative analysis surface. Reads song_lyric_analysis only —
// the local-only full-text and its translated copy stay out of this router
// (see test/lyrics_privacy.test.js).

router.get('/facets', async (req, res) => {
  try {
    res.json(await analysis.facetTree(pool));
  } catch (e) {
    console.error('facets error:', e);
    res.status(500).json({ error: 'Failed to load facets' });
  }
});

// The whole Explore map in one response: spaces, colour-by legends, coverage and points.
// Publish-filtered — unlike the retired public/vector_space.json, which leaked 24 non-live songs.
router.get('/explore/points', async (req, res) => {
  try {
    res.json(await explore.mapPayload(pool));
  } catch (e) {
    console.error('explore points error:', e);
    res.status(500).json({ error: 'Failed to load explore points' });
  }
});

// Two tabs (message / sound) plus the genre fallback, in one response.
router.get('/songs/:id/similar', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad song id' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 6, 24);
    res.json(await explore.similarFor(pool, id, limit));
  } catch (e) {
    console.error('similar songs error:', e);
    res.status(500).json({ error: 'Failed to load similar songs' });
  }
});

router.get('/song/:id', async (req, res) => {
  try {
    const a = await analysis.getSongAnalysis(pool, parseInt(req.params.id));
    if (!a) return res.status(404).json({ error: 'No analysis for this song' });
    res.json(a);
  } catch (e) {
    console.error('song analysis error:', e);
    res.status(500).json({ error: 'Failed to load analysis' });
  }
});

module.exports = router;
