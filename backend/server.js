require('dotenv').config();  // Loads .env vars (e.g., JWT_SECRET, MONGODB_URI)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');  // For JWT token handling

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware (runs on every request)
app.use(cors());  // Allows frontend to connect (e.g., from localhost:8080)
app.use(express.json());  // Parses JSON bodies from requests (e.g., { name: 'Paris Trip' })

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Auth middleware definition (protects routes by checking JWT token)
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

// Mount auth routes (e.g., POST /api/auth/login)
app.use('/api/auth', require('./routes/auth'));

// NEW: Mount trips routes WITH authMiddleware (protects all /api/trips/*)
app.use('/api/trips', authMiddleware, require('./routes/trips'));

// Temp test routes for auth (remove after Phase 2 testing)
app.get('/api/test-auth', authMiddleware, (req, res) => {
  res.json({ msg: 'Auth works!', userId: req.user.id });
});

app.get('/api/protected', authMiddleware, (req, res) => {
  res.json({ msg: 'You\'re in!', userId: req.user.id });
});

// Basic root route (health check)
app.get('/', (req, res) => {
  res.send('WanderVibe Backend is running!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});