const jwt = require('jsonwebtoken');
//const User = require('../models/User.js');  // Your User model (update if name is different)
const logger = require('../utils/logger.js');

const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.userId = decoded.userId || decoded.id;
  } catch (error) {
    logger.error('Auth error:', error);
    return res.status(401).json({ message: 'Token is not valid' });
  }

  if (!global.redisClient) {
    return next();
  }

  try {
    const flag = await global.redisClient.get(token);
    if (flag === 'blacklisted') {
      logger.info('Token revoked', {
        userId: req.user.userId,
        event: 'AuthRevoked',
        context: {}
      });
      return res.status(401).json({ message: 'Token has been revoked' });
    }
    return next();
  } catch (error) {
    logger.error('Blacklist check failed', {
      userId: req.user.userId,
      event: 'AuthBlacklist',
      context: { error: error.message }
    });
    return next();
  }
};

module.exports = authMiddleware;  // Export the function