const PlanUser = require('../models/PlanUser');
const authMiddleware = require('../middleware/auth.js')

// Middleware: Checks if req.user.id has required role for planId
const roleCheck =  (requiredRole) => {
  return async (req, res, next) => {

    authMiddleware(req, res, async (err) => {
      if (err) return next(err);

      const { planId } = req.params;

      try {
        const planUser = await PlanUser.findOne({ planId, userId: req.user.id });
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

        if (req.user.role !== requiredRole) {
          return res.status(403).json({ message: `Access denied. Requires ${requiredRole} role` });
        }
      } catch (err) {
        res.status(500).json({ msg: 'Server error checking role' });
      } finally {
        next();
      }
    });
  };
};

module.exports = { roleCheck };