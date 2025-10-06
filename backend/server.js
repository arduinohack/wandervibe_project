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

// TEMP: One-time test users creation (uncomment to run, then comment out after)
const User = require('./models/User');
const { v4: uuidv4 } = require('uuid');

async function createTestUsers() {
  try {
    // First user (trip creator/VibeCoordinator)
    const testUser = await User.findOne({ email: 'test@example.com' });
    if (!testUser) {
      const newTestUser = new User({
        _id: uuidv4(),
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        phoneNumber: '+1234567890',
        notificationPreferences: { email: true, sms: false }
      });
      await newTestUser.save();
      console.log('Test user created with ID:', newTestUser._id);
    }

    // Second user (for inviting as VibePlanner/Wanderer)
    const janeUser = await User.findOne({ email: 'jane@example.com' });
    if (!janeUser) {
      const newJaneUser = new User({
        _id: uuidv4(),
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phoneNumber: '+1987654321',
        notificationPreferences: { email: true, sms: false }
      });
      await newJaneUser.save();
      console.log('Jane Doe test user created with ID:', newJaneUser._id);
    }
  } catch (err) {
    console.error('Test user creation error:', err);
  }
}

// Uncomment the line below to run once
// createTestUsers();

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

// Mount trips routes WITH authMiddleware (protects all /api/trips/*)
app.use('/api/trips', authMiddleware, require('./routes/trips'));

// NEW: Mount invites routes WITH authMiddleware (protects all /api/invites/*)
app.use('/api/invites', authMiddleware, require('./routes/invites'));

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