const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend server is running!' });
});

// Spotify routes (we'll add these next)
app.use('/api/spotify', require('./routes/spotify'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});