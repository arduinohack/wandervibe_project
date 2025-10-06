const TripUser = require('../models/TripUser');

// Middleware: Checks if req.user.id has required role for tripId
const roleCheck = (requiredRole) => {
  return async (req, res, next) => {
    const { tripId } = req.params;

    try {
      const tripUser = await TripUser.findOne({ tripId, userId: req.user.id });
      if (!tripUser) {
        return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
      }

      // For VibePlanner invites: Only VibeCoordinator
      if (requiredRole === 'VibePlanner' && tripUser.role !== 'VibeCoordinator') {
        return res.status(403).json({ msg: 'Only VibeCoordinator can invite VibePlanners' });
      }

      // For Wanderer invites: VibeCoordinator or VibePlanner
      if (requiredRole === 'Wanderer' && !['VibeCoordinator', 'VibePlanner'].includes(tripUser.role)) {
        return res.status(403).json({ msg: 'Only VibeCoordinator or VibePlanner can invite Wanderers' });
      }

      req.tripUser = tripUser;  // Attach for use in route (e.g., invitedBy)
      next();
    } catch (err) {
      res.status(500).json({ msg: 'Server error checking role' });
    }
  };
};

module.exports = { roleCheck };