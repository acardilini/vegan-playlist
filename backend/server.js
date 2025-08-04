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
console.log('Loading admin routes...');
const adminRouter = require('./routes/admin_simple');
console.log('Admin router loaded, mounting at /api/admin');
app.use('/api/admin', adminRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
