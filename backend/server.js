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