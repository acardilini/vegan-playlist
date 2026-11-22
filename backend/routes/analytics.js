const express = require('express');
const pool = require('../database/db');
const dataset = require('../services/dataset');
const router = express.Router();

// The one public analytics read: every live song with the slim fields the Explore > Data charts use.
// (The five old chart routes were deleted with the Chart.js dashboard.)
router.get('/dataset', async (req, res) => {
  try {
    res.json(await dataset.getDataset(pool));
  } catch (err) {
    console.error('Error building dataset:', err.message);
    res.status(500).json({ error: 'Failed to load the dataset' });
  }
});

module.exports = router;
