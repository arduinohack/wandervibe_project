require('dotenv').config();  // Loads .env vars (e.g., JWT_SECRET, MONGODB_URI)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');  // NEW: For JWT token handling

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware (runs on every request)
app.use(cors());  // Allows frontend to connect
app.use(express.json());  // Parses JSON bodies (e.g., { email: 'test' })

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// NEW: Auth middleware definition (protects routes)
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;  // Attaches { id: 'user-uuid' } to req for use in routes
    next();  // Proceeds to the actual route handler
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

// NEW: Mount the auth routes (login endpoint)
app.use('/api/auth', require('./routes/auth'));

// NEW: Temp test routes for auth (remove after testing Phase 2)
app.get('/api/test-auth', authMiddleware, (req, res) => {
  res.json({ msg: 'Auth works!', userId: req.user.id });
});

app.get('/api/protected', authMiddleware, (req, res) => {
  res.json({ msg: 'You\'re in!', userId: req.user.id });
});

// Basic root route (unchanged)
app.get('/', (req, res) => {
  res.send('WanderVibe Backend is running!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// // One-time: Create test user (uncomment to run once)
// Test User Created 10/5/25, ID:  0ed04152-fb4a-4762-98e7-02f0e357635b
// const User = require('./models/User');
// const { v4: uuidv4 } = require('uuid');
// async function createTestUser() { ... }
// createTestUser();