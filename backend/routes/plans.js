const express = require('express');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const User = require('../models/User');
const Event = require('../models/Event');
const { DateTime } = require('luxon');  // For time zone/DST in Day Numbers
const { v4: uuidv4 } = require('uuid');
const { notifyUsers } = require('../utils/notifications');
const router = express.Router();
const logger = require('../utils/logger');  // Added: Borrow exported logger from ../util/logger.js


// POST /api/plans (Protected: Creates plan and assigns VibeCoordinator role)
router.post('/', async (req, res) => {
  const { type, name, destination, startDate, endDate, timeZone, budget } = req.body;

  logger.info('In Post /api/plans - Creates plan and assigns VibeCoordinator role to requestor');
  // Validate required fields
  if (!type || !name) {
    return res.status(400).json({ msg: 'Missing required fields: type, name' });
  }

  try {
    // Generate UUID for plan ID
    const planId = uuidv4();

    logger.info('userId: ', req.user.userId);
    
    // Create the plan document
    const plan = new Plan({
      _id: planId,
      type,
      name,
      destination: req.body.destination,
      startDate: req.body.startDate ? new Date(req.body.startDate) : null,  // FIXED: Allow null
      endDate: req.body.endDate ? new Date(req.body.endDate) : null,  // FIXED: Allow null
      location: req.body.location,
      timeZone: req.body.timeZone,
      budget: req.body.budget || 0,
      autoCalculateStartDate: req.body.autoCalculateStartDate || true,
      autoCalculateEndDate: req.body.autoCalculateEndDate || true,
      ownerId: req.user.userId
    });
    await plan.save();  // Now saves with null dates    // Assign VibeCoordinator role

    const planUser = new PlanUser({
      planId,
      userId: req.user.userId,
      role: 'VibeCoordinator'
    });
    await planUser.save();

    // Notify the creator
    await notifyUsers([req.user.userId], `Your plan "${name}" has been created! ID: ${planId}`);

    // Success response
    res.status(201).json({ 
      msg: 'Plan created successfully!', 
      plan 
    });
  } catch (err) {
    console.error('Plan creation error:', err);
    res.status(500).json({ msg: 'Server error during plan creation' });
  }
});

// GET /api/plans (Protected: Lists user's plans as owner or participant)
router.get('/', async (req, res) => {
   logger.info('Lists user\'s plans as owner or participant', {
      userId: req.user.userId,
      event: 'GetAPIPlans',
      context: { context: 'n/a' }
    });

  try {
    const userId = req.user.userId;  // From token
    const plans = await Plan.find({ ownerId: userId })  // Or your filter
      .populate('participants');  // Added: Embed PlanUser data (userId, role)
    res.status(200).json({ plans });  // Response now has participants array
  } catch (error) {
    console.error('Fetch plans error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
/*    try {
    // Find plans where user is owner
    const ownedPlans = await Plan.find({ ownerId: req.user.userId }).select('type name destination startDate endDate autoCalculateStartDate autoCalculateEndDate location budget planningState timeZone ownerId');

    // Find plans where user is participant (via plan_users)
    const participantPlans = await PlanUser.find({ userId: req.user.userId }).populate('planId', 'name destination startDate endDate planningState timeZone');
    const participantPlanObjs = participantPlans.filter(pt => pt.planId).map(pt => pt.planId);  // Filter undefined

    // Combine and dedupe
    const allPlans = [...ownedPlans, ...participantPlanObjs];
    const uniquePlans = Array.from(new Set(allPlans.map(t => t._id.toString()))).map(id => 
      allPlans.find(t => t._id.toString() === id)
    );

    res.json({ 
      msg: 'User plans fetched!', 
      plans: uniquePlans.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))  // Sort by startDate
    });
  } catch (err) {
    console.error('List plans error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});
*/

// GET /api/plans/:planId/users (Protected: Lists plan participants with roles)
router.get('/:planId/users', async (req, res) => {
  const { planId } = req.params;
  logger.info('In Get /api/plans/{planID}/users - lists a plans users');

  try {
    // Check caller is participant
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
    }

    // Fetch all plan users, populate with full user details
    const planUsers = await PlanUser.find({ planId }).populate('userId', 'firstName lastName email');

    // Format response
    const formatted = planUsers.map(tu => ({
      userId: tu.userId._id,
      name: `${tu.userId.firstName} ${tu.userId.lastName}`,
      email: tu.userId.email,
      role: tu.role
    }));

    // Group by role
    const grouped = {
      VibeCoordinator: formatted.filter(u => u.role === 'VibeCoordinator'),
      VibePlanners: formatted.filter(u => u.role === 'VibePlanner'),
      Wanderers: formatted.filter(u => u.role === 'Wanderer')
    };

    res.json({ 
      msg: 'Plan users fetched!', 
      users: formatted,  // Flat list
      grouped  // Role-grouped for UI
    });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/plans/:planId/remove-user (Protected: Removes user by ID)
router.post('/:planId/remove-user', async (req, res) => {
  const { planId } = req.params;
  const { userId: targetUserId } = req.body;
  
  logger.info('In Post /api/plans/{planID}/remove-user - removes a user from a plan');

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing userId to remove' });
  }

  try {
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
    }

    if (targetUserId === req.user.userId) {
      return res.status(400).json({ msg: 'Cannot remove yourself' });
    }

    const targetPlanUser = await PlanUser.findOne({ planId, userId: targetUserId });
    if (!targetPlanUser) {
      return res.status(404).json({ msg: 'Target user not found on plan' });
    }

    if (callerPlanUser.role !== 'VibeCoordinator' && targetPlanUser.role !== 'Wanderer') {
      return res.status(403).json({ msg: 'VibePlanners can only remove Wanderers' });
    }

    if (targetPlanUser.role === 'VibeCoordinator') {
      return res.status(400).json({ msg: 'Cannot remove VibeCoordinator—use reassign instead' });
    }

    await PlanUser.deleteOne({ planId, userId: targetUserId });

    const removedUser = await User.findById(targetUserId).select('firstName lastName');
    const plan = await Plan.findById(planId).select('name');

    await notifyUsers([targetUserId], `You've been removed from "${plan.name}" by ${callerPlanUser.userId}.`, 'email');
    await notifyUsers([req.user.userId], `Removed ${removedUser.firstName} ${removedUser.lastName} from "${plan.name}".`, 'email');

    res.json({ msg: 'User removed successfully!' });
  } catch (err) {
    console.error('Remove user error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/plans/:planId/reassign-coordinator (Protected: Transfers ownership to VibePlanner)
router.post('/:planId/reassign-coordinator', async (req, res) => {
  const { planId } = req.params;
  const { targetUserId } = req.body;

  logger.info('In Post /api/plans/{planID}/reassign-coordinator - transfers plan ownership to a plan\'s VibePlanner');

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing targetUserId' });
  }

  try {
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser || callerPlanUser.role !== 'VibeCoordinator') {
      return res.status(403).json({ msg: 'Only VibeCoordinator can reassign' });
    }

    const targetPlanUser = await PlanUser.findOne({ planId, userId: targetUserId }).populate('userId', 'firstName lastName');
    if (!targetPlanUser || targetPlanUser.role !== 'VibePlanner') {
      return res.status(400).json({ msg: 'Target must be a VibePlanner' });
    }

    callerPlanUser.role = 'VibePlanner';
    targetPlanUser.role = 'VibeCoordinator';
    await callerPlanUser.save();
    await targetPlanUser.save();

    const plan = await Plan.findById(planId);
    plan.ownerId = targetUserId;
    await plan.save();

    const allParticipants = await PlanUser.find({ planId }).select('userId');
    const participantIds = allParticipants.map(tu => tu.userId);
    const reassignMsg = `Ownership transferred to ${targetPlanUser.userId.firstName} ${targetPlanUser.userId.lastName}!`;
    await notifyUsers(participantIds, reassignMsg, 'email');

    res.json({ msg: 'Ownership reassigned!', newCoordinator: targetPlanUser.userId });
  } catch (err) {
    console.error('Reassign error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/plans/:planId/itinerary (Protected: Fetches sorted events with Day Numbers)
router.get('/:planId/itinerary', async (req, res) => {
  const { planId } = req.params;

  logger.info('In Get /api/plans/{planID}/itinerary - fetches sorted events with Day Numbers');

  try {
    // Check caller is participant
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
    }

    // Fetch plan for timeZone
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ msg: 'Plan not found' });
    }

    // Fetch and sort events by startTime
    let events = await Event.find({ $or: [{ planId: planId }, { eventPlanId: planId }] });
    events = events.map(event => ({
      ...event.toObject(),
      relevantTimeZone: event.type === 'flight' ? event.destinationTimeZone : plan.timeZone
    }));

    // Compute Day Numbers (loop, compare to previous)
    let dayNumber = 1;
    let previousEnd = null;
    events.forEach(event => {
      const start = DateTime.fromJSDate(event.startTime, { zone: event.relevantTimeZone });
      const isNewDay = !previousEnd || start.startOf('day') > DateTime.fromJSDate(previousEnd, { zone: event.relevantTimeZone }).startOf('day');
      if (isNewDay) dayNumber++;
      event.dayNumber = dayNumber;
      previousEnd = event.endTime;
    });

    // Group by dayNumber
    const grouped = events.reduce((acc, event) => {
      const day = event.dayNumber;
      acc[day] = acc[day] || [];
      acc[day].push(event);
      return acc;
    }, {});

    res.json({ 
      msg: 'Itinerary fetched!', 
      events,  // Flat list with dayNumber
      grouped  // {1: [events], 2: [events], ...}
    });
  } catch (err) {
    console.error('Itinerary error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;