// Middleware: Checks if req.user.role is 'admin'
const adminCheck = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Admin access required' });
  }
  next();
};

module.exports = { adminCheck };