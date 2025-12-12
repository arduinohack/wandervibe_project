const PlanUser = require('../models/PlanUser');
const Plan = require('../models/Plan');

// Helper to check if user can perform action on plan
async function checkPermission(userId, planId, action) {
  try {
    // Check plan exists
    const plan = await Plan.findById(planId);
    if (!plan) return false;

    // Fetch user's role on this plan
    const userRoleEntry = await PlanUser.findOne({ planId, userId });
    if (!userRoleEntry) return false;  // Not participant—no access

    const role = userRoleEntry.role;
    const isOwner = role === 'VibeCoordinator';
    const isPlanner = role === 'VibePlanner';
    const isWanderer = role === 'Wanderer';

    switch (action) {
      case 'read':
        return isWanderer || isPlanner || isOwner;  // FIXED: Wanderer can read only if assigned as Wanderer
      case 'update':
        return isOwner || isPlanner;  // Planners can update
      case 'delete':
        return isOwner;  // Only owner deletes
      case 'create':
        return isOwner || isPlanner;  // Planners can create events
      default:
        return false;
    }
  } catch (error) {
    console.error('Permission check error:', error);
    return false;
  }
}

module.exports = { checkPermission };