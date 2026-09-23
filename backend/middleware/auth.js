const jwt = require('jsonwebtoken');
//const User = require('../models/User.js');  // Your User model (update if name is different)
const logger = require('../utils/logger.js');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.userId = decoded.userId || decoded.id;
    return next();
  } catch (error) {
    logger.error('Auth error:', error);
    return res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = authMiddleware;  // Export the function