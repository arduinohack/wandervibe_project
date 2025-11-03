const jwt = require('jsonwebtoken');
//const User = require('../models/User.js');  // Your User model (update if name is different)
const logger = require('../utils/logger.js');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    logger.info('Middleware received token', {
      userId: 'not present',
      event: 'MiddlewareToken',
      context: { token: token }
    });

    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }


    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    logger.info('Decoded token with secret key', {
      userId: decoded.userId,
      event: 'MiddlewareToken',
      context: { decoded: decoded }
    });

    req.user = decoded;
    logger.info('Req.user assigned from decoded', {
      userId: req.user.userId,
      event: 'MiddlewareUserAssign',
      context: { token: token }
    });
  } catch (error) {
    logger.error('Auth error:', error);
    res.status(401).json({ message: 'Token is not valid' });
  } finally {
    next();
  }
};

module.exports = authMiddleware;  // Export the function