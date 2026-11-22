const express = require('express');
const pool = require('../database/db');
const stories = require('../services/stories');
const router = express.Router();

// Public, read-only: scrollytelling stories read from backend/data/stories/*.md. The slug never reaches a path
// (services/stories.js looks it up in a Map of the files that exist), so traversal cannot happen.
router.get('/', async (req, res) => {
  try {
    res.json(await stories.listStories(pool));
  } catch (err) {
    console.error('stories list error:', err.code || '', err.message);
    res.status(500).json({ error: 'Stories could not be loaded' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    res.json(await stories.loadStory(pool, req.params.slug));
  } catch (err) {
    if (err instanceof stories.StoryError && err.code === 'NOT_FOUND') return res.status(404).json({ error: 'No such story' });
    // The message names the bad block or token for the curator; the reader only ever sees the generic line.
    console.error('story load error:', req.params.slug, err.code || '', err.message);
    res.status(500).json({ error: 'Story could not be loaded' });
  }
});

module.exports = router;
