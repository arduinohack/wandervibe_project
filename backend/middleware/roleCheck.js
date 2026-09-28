const PlanUser = require('../models/PlanUser');
const authMiddleware = require('../middleware/auth.js');

const MEMBERSHIP_ROLES = {
  VibeCoordinator: 'VibeCoordinator',
  coordinator: 'VibeCoordinator',
  VibePlanner: 'VibePlanner',
  planner: 'VibePlanner',
  Wanderer: 'Wanderer',
  wanderer: 'Wanderer',
};

function canonicalMembershipRole(role) {
  if (typeof role !== 'string') return null;
  return MEMBERSHIP_ROLES[role] || null;
}

// requiredRole is one membership role or a list. Short names match the stored Vibe* role.
// The caller must already hold one of those roles. This does not decide which role they may invite.
const roleCheck = (requiredRole) => {
  const allowed = (Array.isArray(requiredRole) ? requiredRole : [requiredRole])
    .map(canonicalMembershipRole)
    .filter(Boolean);

  return async (req, res, next) => {
    authMiddleware(req, res, async (err) => {
      if (err) return next(err);

      const planId = req.params.planId;
      const userId = req.user.userId || req.user.id;

      try {
        const planUser = await PlanUser.findOne({ planId, userId });
        if (!planUser) {
          return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
        }

        const callerRole = canonicalMembershipRole(planUser.role);
        if (!callerRole || !allowed.includes(callerRole)) {
          return res.status(403).json({ msg: 'Access denied: insufficient plan role' });
        }

        req.planUser = planUser;
        return next();
      } catch (error) {
        return res.status(500).json({ msg: 'Server error checking role' });
      }
    });
  };
};

module.exports = { roleCheck, canonicalMembershipRole };
