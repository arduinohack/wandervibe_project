const jwt = require('jsonwebtoken');  // For token verification
const logger = require('../utils/logger');  // Add this import

// Middleware to verify JWT token and add user to req
const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');  // Extract token from header
  logger.info('Middleware received token', {
    userId: 'not present',
    event: 'MiddlewareToken',
    context: { token: token }
  });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
    logger.info('Decoded token with secret key', {
      userId: decoded.userId,
      event: 'MiddlewareToken',
      context: { decoded: decoded }
    });

    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    // Check Redis blacklist
    //if (global.redisClient) {
    //  const isBlacklisted = await global.redisClient.get(token);
    //  if (isBlacklisted) {
    //    return res.status(401).json({ msg: 'Token has been blacklisted' });
    //  }
    //}

    req.user = decoded;
    logger.info('Req.user assigned from decoded', {
      userId: req.user.userId,
      event: 'MiddlewareUserAssign',
      context: { token: token }
    });
    next();

  } catch (err) {
    logger.error('Token is not valid', {
      userId: 'not present',
      event: 'MiddlewareToken',
      context: { error: err, token: token }
    });
    res.status(401).json({ msg: 'Token is not valid' });
  }
}


module.exports = { authMiddleware };