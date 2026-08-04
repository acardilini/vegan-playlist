const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const router = express.Router();

// Curator-editable page copy. The curator writes prose in backend/data/*.md and a browser
// refresh picks it up — no rebuild, no deploy.
//
// The slug is looked up in this Map and mapped to a filename; the request string never
// reaches path.join. Traversal is therefore impossible by construction rather than by
// sanitising, and a Map (not a plain object) means an inherited key like `constructor`
// cannot resolve to a truthy value.
const PAGES = new Map([
  ['about', 'about.md'],
  ['analysis', 'analysis.md'],
]);

router.get('/:slug', async (req, res) => {
  const file = PAGES.get(req.params.slug);
  if (!file) return res.status(404).json({ error: 'Unknown content page' });
  try {
    const markdown = await fs.readFile(path.join(__dirname, '..', 'data', file), 'utf8');
    res.json({ slug: req.params.slug, markdown });
  } catch (e) {
    console.error('content read error:', e);
    res.status(500).json({ error: 'Failed to load content' });
  }
});

module.exports = router;
