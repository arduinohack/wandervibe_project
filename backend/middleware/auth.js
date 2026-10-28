const jwt = require('jsonwebtoken');
//const User = require('../models/User.js');  // Your User model (update if name is different)
const logger = require('../utils/logger.js');
const ApiKey = require('../models/ApiKey');
const { hashApiKey } = require('../utils/apiKey');

function looksLikeJwt(token) {
  return typeof token === 'string' && token.split('.').length === 3;
}

async function authenticateApiKey(token, req, res, next) {
  try {
    const doc = await ApiKey.findOne({ keyHash: hashApiKey(token), revokedAt: null }).lean();
    if (!doc || !doc.userId) {
      return res.status(401).json({ message: 'Token is not valid' });
    }
    const userId = String(doc.userId);
    req.user = { userId, id: userId };
    req.authType = 'apiKey';
    req.apiKeyId = String(doc._id);
    try {
      await ApiKey.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } });
    } catch (error) {
      logger.error('API key lastUsedAt update failed', {
        userId,
        event: 'AuthApiKey',
        context: { error: error.message },
      });
    }
    return next();
  } catch (error) {
    logger.error('API key lookup failed', {
      userId: 'anonymous',
      event: 'AuthApiKey',
      context: { error: error.message },
    });
    return res.status(401).json({ message: 'Token is not valid' });
  }
}

const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  // Agent keys are wv_live_ plus random text. A login token has three segments.
  if (!looksLikeJwt(token)) {
    return authenticateApiKey(token, req, res, next);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.userId = decoded.userId || decoded.id;
    req.authType = 'jwt';
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