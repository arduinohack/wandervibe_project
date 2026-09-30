const User = require('../models/User');

// Auth has already run. Read role from the user row so a demotion takes effect.
async function requireAdmin(req, res, next) {
  try {
    const userId = req.user && (req.user.userId || req.user.id);
    if (!userId) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const user = await User.findById(userId).select('role');
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = requireAdmin;
