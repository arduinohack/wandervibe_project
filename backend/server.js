require('dotenv').config();  // Loads .env vars (e.g., JWT_SECRET, MONGODB_URI)
const express = require('express');
const jwt = require('jsonwebtoken');  // For JWT token handling
const { authMiddleware } = require('./middleware/auth');  // This line
const mongoose = require('mongoose');
const morgan = require('morgan');  // Add this line
const winston = require('winston');  // For app logs
const bcrypt = require('bcryptjs');  // For password hashing
const cors = require('cors');
const logger = require('./utils/logger');  // Add this import
const redis = require('redis');  // Optional for blacklist

const app = express();

// Middleware (runs on every request)
app.use(cors());  // Allows frontend to connect (e.g., from localhost:8080)
app.use(express.json());  // Parses JSON bodies from requests (e.g., { name: 'Paris Trip' })
app.use(cors());  // Allows frontend from localhost:8080 or emulator to call backend
app.use(morgan('dev'));  // Add this line: Logs requests to console

const PORT = process.env.PORT || 3000;

// Example: Startup log
logger.info('Server starting up', { port: process.env.PORT || 3000 });

// Connect to MongoDB
logger.info(process.env.MONGODB_URI);
mongoose.connect(process.env.MONGODB_URI, {  // Fixed: URI first, options second
  bufferTimeoutMS: 5000,  // 5s timeout for buffering (fails fast if DB slow)
  serverSelectionTimeoutMS: 5000,  // 5s for server selection (quick detect if DB down)
  maxPoolSize: 10,  // Limit connections to 10 (prevents overload)
}).then(() => {
  logger.info('Connected to MongoDB');  // Success log
}).catch((err) => {
  logger.error('MongoDB connection error:', err);  // Error log
  // process.exit(1);  // Uncomment to crash server if DB down (optional for prod)
});

// Connection events for debugging
mongoose.connection.on('connected', () => logger.info('Mongoose connected'));
mongoose.connection.on('error', (err) => logger.error('Mongoose error:', err));
mongoose.connection.on('disconnected', () => {
  logger.info('Mongoose disconnected—reconnecting...');
  setTimeout(() => mongoose.connect(process.env.MONGODB_URI), 5000);  // Reconnect after 5s
});

// NEW: Async startup for Redis

(async () => {
  try {
    const redis = require('redis');
    const client = redis.createClient({ url: 'redis://localhost:6379' });
    client.on('error', err => console.log('Redis Client Error', err));
    await client.connect();  // Now safe in async
    logger.info('Redis connected successfully');
    global.redisClient = client;
  } catch (err) {
    logger.error('Redis connection failed:', err);
    // Optional: Graceful fallback (e.g., disable blacklisting)
    global.redisClient = null;
  }

});


// TEMP: One-time test users creation (uncomment to run, then comment out after)
const User = require('./models/User');
const { v4: uuidv4 } = require('uuid');

async function seedTestUsers() {
  const usersToSeed = [
    {
      email: 'test@example.com',
      password: 'testpass',
      firstName: 'Test',
      lastName: 'User',
      phoneNumber: '+1-555-0000',
      address: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TC',
        country: 'USA',
        postalCode: '12345',
      },
      notificationPreferences: {
        email: true,
        sms: false,
      },
      role: 'VibeCoordinator',  // Default for test user
    },
    {
      email: 'jane@example.com',
      password: 'janepass',
      firstName: 'Jane',
      lastName: 'Doe',
      phoneNumber: '+1-555-0001',
      address: {
        street: '456 Jane Ave',
        city: 'Sample Town',
        state: 'ST',
        country: 'USA',
        postalCode: '67890',
      },
      notificationPreferences: {
        email: true,
        sms: true,
      },
      role: 'VibePlanner',  // Assigned role for Jane
    },
  ];

  for (const userData of usersToSeed) {
    try {
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        logger.info(`User ${userData.email} already exists—skipping`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(userData.password, 12);  // Hash password (12 rounds for security)
      const userId = uuidv4();
      const newUser = new User({
        _id: userId,  // Removed: MongoDB handles _id automatically
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        phoneNumber: userData.phoneNumber,
        address: userData.address,
        notificationPreferences: userData.notificationPreferences,
        role: userData.role,
        password: hashedPassword,  // Set hashed password
        createdAt: new Date(),
      });

      await newUser.save();
      logger.info(`Added test user: ${userData.email} / ${userData.password}`);
    } catch (err) {
      logger.error.error('Test user creation error:', err);
    }
  }
}

// Uncomment the line below to run once
// seedTestUsers();

// Mount auth routes (e.g., POST /api/auth/login)
app.use('/api/auth', require('./routes/auth'));

// Mount plans routes WITH authMiddleware (protects all /api/plans/*)
app.use('/api/plans', authMiddleware, require('./routes/plans'));

// Mount events under /api/events (uses events.js handler)
app.use('/api/events', authMiddleware, require('./routes/events'));

// NEW: Mount invites routes WITH authMiddleware (protects all /api/invites/*)
app.use('/api/invites', authMiddleware, require('./routes/invites'));

// Temp test routes for auth (remove after Phase 2 testing)
app.get('/api/test-auth', authMiddleware, (req, res) => {
  res.json({ msg: 'Auth works!', userId: req.user.userId });
});

app.get('/api/protected', authMiddleware, (req, res) => {
  res.json({ msg: 'You\'re in!', userId: req.user.userId });
});

// Basic root route (health check)
app.get('/', (req, res) => {
  res.send('WanderVibe Backend is running!');
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});