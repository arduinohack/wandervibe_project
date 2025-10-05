require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const User = require('./models/User');
const { v4: uuidv4 } = require('uuid');  // For IDs

// One-time: Create test user
// Creates 10/5/25, ID:  0ed04152-fb4a-4762-98e7-02f0e357635b
//async function createTestUser() {
//  const testUser = new User({
//    _id: uuidv4(),
//    firstName: 'Test',
//    lastName: 'User',
//    email: 'test@example.com',
//    phoneNumber: '+1234567890',
//    notificationPreferences: { email: true, sms: false }
//  });
//  await testUser.save();
//  console.log('Test user created with ID:', testUser._id);
//}
//createTestUser();

// Basic route
app.get('/', (req, res) => {
  res.send('WanderVibe Backend is running!');
});

app.get('/api/test-auth', authMiddleware, (req, res) => res.json({ msg: 'Auth works!', userId: req.user.id }));

const jwt = require('jsonwebtoken');

// Auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;  // Adds user ID to req
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

// Apply to routes later, e.g., app.use('/api', authMiddleware);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});