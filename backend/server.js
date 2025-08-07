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

// Spotify routes
app.use('/api/spotify', require('./routes/spotify'));

// Admin routes
console.log('Loading admin routes - FINAL...');
const adminRouter = require('./routes/admin');
console.log('Admin router loaded, mounting at /api/admin');
app.use('/api/admin', adminRouter);

// Playlist routes
console.log('Loading playlist routes...');
const playlistRouter = require('./routes/playlists');
console.log('Playlist router loaded, mounting at /api/playlists');
app.use('/api/playlists', playlistRouter);

// YouTube routes
console.log('Loading YouTube routes...');
const youtubeRouter = require('./routes/youtube');
console.log('YouTube router loaded, mounting at /api/youtube');
app.use('/api/youtube', youtubeRouter);

// Lyrics routes
console.log('Loading lyrics routes...');
const lyricsRouter = require('./routes/lyrics');
console.log('Lyrics router loaded, mounting at /api/lyrics');
app.use('/api/lyrics', lyricsRouter);

// Song Submissions routes
console.log('Loading song submissions routes...');
const submissionsRouter = require('./routes/submissions');
console.log('Submissions router loaded, mounting at /api/submissions');
app.use('/api/submissions', submissionsRouter);

// Analytics routes
console.log('Loading analytics routes...');
const analyticsRouter = require('./routes/analytics');
console.log('Analytics router loaded, mounting at /api/analytics');
app.use('/api/analytics', analyticsRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
