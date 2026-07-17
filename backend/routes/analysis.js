const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const analysis = require('../services/analysis');

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
