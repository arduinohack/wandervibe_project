const PlanUser = require('../models/PlanUser');
const authMiddleware = require('../middleware/auth.js')

// Middleware: Checks the caller's PlanUser role for planId or tripId
const roleCheck =  (requiredRole) => {
  return async (req, res, next) => {

    authMiddleware(req, res, async (err) => {
      if (err) return next(err);

      const planId = req.params.planId || req.params.tripId;

      try {
        const planUser = await PlanUser.findOne({ planId, userId: req.user.userId });
        if (!planUser) {
          return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
        }

        // For VibePlanner invites: Only VibeCoordinator
        if (requiredRole === 'VibePlanner' && planUser.role !== 'VibeCoordinator') {
          return res.status(403).json({ msg: 'Only VibeCoordinator can invite VibePlanners' });
        }

        // For Wanderer invites: VibeCoordinator or VibePlanner
        if (requiredRole === 'Wanderer' && !['VibeCoordinator', 'VibePlanner'].includes(planUser.role)) {
          return res.status(403).json({ msg: 'Only VibeCoordinator or VibePlanner can invite Wanderers' });
        }

        req.planUser = planUser;  // Attach for use in route (e.g., invitedBy)
        return next();
      } catch (error) {
        return res.status(500).json({ msg: 'Server error checking role' });
      }
    });
  };
};

module.exports = { roleCheck };
