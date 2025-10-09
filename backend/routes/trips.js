const express = require('express');
const Trip = require('../models/Trip');
const TripUser = require('../models/TripUser');
const User = require('../models/User');
const Event = require('../models/Event');
const { DateTime } = require('luxon');  // For time zone/DST in Day Numbers
const { v4: uuidv4 } = require('uuid');
const { notifyUsers } = require('../utils/notifications');
const router = express.Router();

// POST /api/trips (Protected: Creates trip and assigns VibeCoordinator role)
router.post('/', async (req, res) => {
  const { name, destination, startDate, endDate, timeZone, budget } = req.body;

  // Validate required fields
  if (!name || !destination || !startDate || !endDate || !timeZone) {
    return res.status(400).json({ msg: 'Missing required fields: name, destination, startDate, endDate, timeZone' });
  }

  try {
    // Generate UUID for trip ID
    const tripId = uuidv4();

    // Create the trip document
    const trip = new Trip({
      _id: tripId,
      name,
      destination,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      budget: budget || 0,
      timeZone,
      ownerId: req.user.id  // From auth middleware—creator is owner
    });
    await trip.save();

    // Assign VibeCoordinator role
    const tripUser = new TripUser({
      tripId,
      userId: req.user.id,
      role: 'VibeCoordinator'
    });
    await tripUser.save();

    // Notify the creator
    await notifyUsers([req.user.id], `Your trip "${name}" has been created! ID: ${tripId}`);

    // Success response
    res.status(201).json({ 
      msg: 'Trip created successfully!', 
      trip 
    });
  } catch (err) {
    console.error('Trip creation error:', err);
    res.status(500).json({ msg: 'Server error during trip creation' });
  }
});

// GET /api/trips (Protected: Lists user's trips as owner or participant)
router.get('/', async (req, res) => {
  try {
    // Find trips where user is owner
    const ownedTrips = await Trip.find({ ownerId: req.user.id }).select('name destination startDate endDate planningState timeZone');

    // Find trips where user is participant (via trip_users)
    const participantTrips = await TripUser.find({ userId: req.user.id }).populate('tripId', 'name destination startDate endDate planningState timeZone');
    const participantTripObjs = participantTrips.filter(pt => pt.tripId).map(pt => pt.tripId);  // Filter undefined

    // Combine and dedupe
    const allTrips = [...ownedTrips, ...participantTripObjs];
    const uniqueTrips = Array.from(new Set(allTrips.map(t => t._id.toString()))).map(id => 
      allTrips.find(t => t._id.toString() === id)
    );

    res.json({ 
      msg: 'User trips fetched!', 
      trips: uniqueTrips.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))  // Sort by startDate
    });
  } catch (err) {
    console.error('List trips error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/trips/:tripId/users (Protected: Lists trip participants with roles)
router.get('/:tripId/users', async (req, res) => {
  const { tripId } = req.params;

  try {
    // Check caller is participant
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    // Fetch all trip users, populate with full user details
    const tripUsers = await TripUser.find({ tripId }).populate('userId', 'firstName lastName email');

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
      msg: 'Trip users fetched!', 
      users: formatted,  // Flat list
      grouped  // Role-grouped for UI
    });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/trips/:tripId/remove-user (Protected: Removes user by ID)
router.post('/:tripId/remove-user', async (req, res) => {
  const { tripId } = req.params;
  const { userId: targetUserId } = req.body;

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing userId to remove' });
  }

  try {
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    if (targetUserId === req.user.id) {
      return res.status(400).json({ msg: 'Cannot remove yourself' });
    }

    const targetTripUser = await TripUser.findOne({ tripId, userId: targetUserId });
    if (!targetTripUser) {
      return res.status(404).json({ msg: 'Target user not found on trip' });
    }

    if (callerTripUser.role !== 'VibeCoordinator' && targetTripUser.role !== 'Wanderer') {
      return res.status(403).json({ msg: 'VibePlanners can only remove Wanderers' });
    }

    if (targetTripUser.role === 'VibeCoordinator') {
      return res.status(400).json({ msg: 'Cannot remove VibeCoordinator—use reassign instead' });
    }

    await TripUser.deleteOne({ tripId, userId: targetUserId });

    const removedUser = await User.findById(targetUserId).select('firstName lastName');
    const trip = await Trip.findById(tripId).select('name');

    await notifyUsers([targetUserId], `You've been removed from "${trip.name}" by ${callerTripUser.userId}.`, 'email');
    await notifyUsers([req.user.id], `Removed ${removedUser.firstName} ${removedUser.lastName} from "${trip.name}".`, 'email');

    res.json({ msg: 'User removed successfully!' });
  } catch (err) {
    console.error('Remove user error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/trips/:tripId/reassign-coordinator (Protected: Transfers ownership to VibePlanner)
router.post('/:tripId/reassign-coordinator', async (req, res) => {
  const { tripId } = req.params;
  const { targetUserId } = req.body;

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing targetUserId' });
  }

  try {
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser || callerTripUser.role !== 'VibeCoordinator') {
      return res.status(403).json({ msg: 'Only VibeCoordinator can reassign' });
    }

    const targetTripUser = await TripUser.findOne({ tripId, userId: targetUserId }).populate('userId', 'firstName lastName');
    if (!targetTripUser || targetTripUser.role !== 'VibePlanner') {
      return res.status(400).json({ msg: 'Target must be a VibePlanner' });
    }

    callerTripUser.role = 'VibePlanner';
    targetTripUser.role = 'VibeCoordinator';
    await callerTripUser.save();
    await targetTripUser.save();

    const trip = await Trip.findById(tripId);
    trip.ownerId = targetUserId;
    await trip.save();

    const allParticipants = await TripUser.find({ tripId }).select('userId');
    const participantIds = allParticipants.map(tu => tu.userId);
    const reassignMsg = `Ownership transferred to ${targetTripUser.userId.firstName} ${targetTripUser.userId.lastName}!`;
    await notifyUsers(participantIds, reassignMsg, 'email');

    res.json({ msg: 'Ownership reassigned!', newCoordinator: targetTripUser.userId });
  } catch (err) {
    console.error('Reassign error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/trips/:tripId/itinerary (Protected: Fetches sorted events with Day Numbers)
router.get('/:tripId/itinerary', async (req, res) => {
  const { tripId } = req.params;

  try {
    // Check caller is participant
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    // Fetch trip for timeZone
    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ msg: 'Trip not found' });
    }

    // Fetch and sort events by startTime
    let events = await Event.find({ tripId }).sort({ startTime: 1 });
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