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


// POST /api/plans (Protected: Creates trip and assigns VibeCoordinator role)
router.post('/', async (req, res) => {
  const { type, name, destination, startDate, endDate, timeZone, budget } = req.body;

  // Validate required fields
  if (!type || !name || !destination || !startDate || !endDate || !timeZone) {
    return res.status(400).json({ msg: 'Missing required fields: type, name, destination, startDate, endDate, timeZone' });
  }

  try {
    // Generate UUID for trip ID
    const planId = uuidv4();

    logger.info('userId: ', req.user.userId);
    
    // Create the trip document
    const plan = new Plan({
      _id: planId,
      type,
      name,
      destination,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      budget: budget || 0,
      timeZone,
      ownerId: req.user.userId  // From auth middleware—creator is owner
    });
    await plan.save();

    // Assign VibeCoordinator role
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

// GET /api/plans (Protected: Lists user's trips as owner or participant)
router.get('/', async (req, res) => {
  try {
    // Find trips where user is owner
    const ownedPlans = await Plan.find({ ownerId: req.user.userId }).select('name destination startDate endDate planningState timeZone');

    // Find trips where user is participant (via trip_users)
    const participantPlans = await PlanUser.find({ userId: req.user.userId }).populate('planId', 'name destination startDate endDate planningState timeZone');
    const participantPlanObjs = participantPlans.filter(pt => pt.planId).map(pt => pt.planId);  // Filter undefined

    // Combine and dedupe
    const allPlans = [...ownedPlans, ...participantPlanObjs];
    const uniquePlans = Array.from(new Set(allPlans.map(t => t._id.toString()))).map(id => 
      allPlans.find(t => t._id.toString() === id)
    );

    res.json({ 
      msg: 'User trips fetched!', 
      trips: uniquePlans.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))  // Sort by startDate
    });
  } catch (err) {
    console.error('List trips error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/plans/:planId/users (Protected: Lists trip participants with roles)
router.get('/:planId/users', async (req, res) => {
  const { planId } = req.params;

  try {
    // Check caller is participant
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    // Fetch all trip users, populate with full user details
    const tripUsers = await PlanUser.find({ planId }).populate('userId', 'firstName lastName email');

    // Format response
    const formatted = tripUsers.map(tu => ({
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

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing userId to remove' });
  }

  try {
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    if (targetUserId === req.user.userId) {
      return res.status(400).json({ msg: 'Cannot remove yourself' });
    }

    const targetPlanUser = await PlanUser.findOne({ planId, userId: targetUserId });
    if (!targetPlanUser) {
      return res.status(404).json({ msg: 'Target user not found on trip' });
    }

    if (callerPlanUser.role !== 'VibeCoordinator' && targetPlanUser.role !== 'Wanderer') {
      return res.status(403).json({ msg: 'VibePlanners can only remove Wanderers' });
    }

    if (targetPlanUser.role === 'VibeCoordinator') {
      return res.status(400).json({ msg: 'Cannot remove VibeCoordinator—use reassign instead' });
    }

    await PlanUser.deleteOne({ planId, userId: targetUserId });

    const removedUser = await User.findById(targetUserId).select('firstName lastName');
    const trip = await Plan.findById(planId).select('name');

    await notifyUsers([targetUserId], `You've been removed from "${trip.name}" by ${callerPlanUser.userId}.`, 'email');
    await notifyUsers([req.user.userId], `Removed ${removedUser.firstName} ${removedUser.lastName} from "${trip.name}".`, 'email');

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

    const trip = await Plan.findById(planId);
    trip.ownerId = targetUserId;
    await trip.save();

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

  try {
    // Check caller is participant
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    // Fetch trip for timeZone
    const trip = await Plan.findById(planId);
    if (!trip) {
      return res.status(404).json({ msg: 'Plan not found' });
    }

    // Fetch and sort events by startTime
    let events = await Event.find({ $or: [{ tripId: planId }, { eventPlanId: planId }] });
    events = events.map(event => ({
      ...event.toObject(),
      relevantTimeZone: event.type === 'flight' ? event.destinationTimeZone : trip.timeZone
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