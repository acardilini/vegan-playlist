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

app.use('/api/spotify', require('./routes/spotify'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/playlists', require('./routes/playlists'));
app.use('/api/youtube', require('./routes/youtube'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/analytics', require('./routes/analytics'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
