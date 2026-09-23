require('dotenv').config();  // Loads .env vars (e.g., JWT_SECRET, MONGODB_URI)
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const app = require('./app');

const PORT = process.env.PORT || 3000;

logger.info('Server starting up', { port: process.env.PORT || 3000 });

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  bufferTimeoutMS: 5000,  // 5s timeout for buffering (fails fast if DB slow)
  serverSelectionTimeoutMS: 5000,  // 5s for server selection (quick detect if DB down)
  maxPoolSize: 10,  // Limit connections to 10 (prevents overload)
}).then(() => {
  logger.info('Connected to MongoDB');
}).catch((err) => {
  logger.error('MongoDB connection error:', err);
});

// Connection events for debugging
mongoose.connection.on('connected', () => logger.info('Mongoose connected'));
mongoose.connection.on('error', (err) => logger.error('Mongoose error:', err));
mongoose.connection.on('disconnected', () => {
  logger.info('Mongoose disconnected—reconnecting...');
  setTimeout(() => mongoose.connect(process.env.MONGODB_URI), 5000);  // Reconnect after 5s
});

(async () => {
  try {
    const redis = require('redis');
    const client = redis.createClient({ url: 'redis://localhost:6379' });
    client.on('error', err => console.log('Redis Client Error', err));
    await client.connect();
    logger.info('Redis connected successfully');
    global.redisClient = client;
  } catch (err) {
    logger.error('Redis connection failed:', err);
    global.redisClient = null;
  }
})();

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

module.exports = app;
