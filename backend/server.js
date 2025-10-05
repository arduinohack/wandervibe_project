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

// Placeholder for auth middleware (Phase 2)
const authMiddleware = (req, res, next) => {
  // TODO: JWT verification
  next();
};

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});