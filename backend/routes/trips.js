const express = require('express');
const Trip = require('../models/Trip');  // Our Trip schema
const TripUser = require('../models/TripUser');  // Role assignments
const User = require('../models/User');  // FIXED: Import for fetching user details in notifications
const { v4: uuidv4 } = require('uuid');  // For unique IDs
const { notifyUsers } = require('../utils/notifications');  // Import the function
const router = express.Router();

// POST /api/trips (Protected: Creates trip and assigns VibeCoordinator role)
router.post('/', async (req, res) => {
  // Note: authMiddleware is applied at the route level in server.js—see below
  const { name, destination, startDate, endDate, timeZone, budget } = req.body;

  // Validate required fields (minimizes errors)
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
      startDate: new Date(startDate),  // Converts ISO string to Date
      endDate: new Date(endDate),
      budget: budget || 0,  // Optional, defaults to 0
      timeZone,
      ownerId: req.user.id  // From auth middleware—creator is owner
    });
    await trip.save();

    // Assign VibeCoordinator role (one-to-one with owner)
    const tripUser = new TripUser({
      tripId,
      userId: req.user.id,
      role: 'VibeCoordinator'
    });
    await tripUser.save();

    // NEW: Notify the creator
    await notifyUsers([req.user.id], `Your trip "${name}" has been created! ID: ${tripId}`);
    
    // Success response
    res.status(201).json({ 
      msg: 'Trip created successfully!', 
      trip 
    });
  } catch (err) {
    console.error('Trip creation error:', err);  // Logs for debugging
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
    const participantTripObjs = participantTrips.filter(pt => pt.tripId).map(pt => pt.tripId);  // FIXED: Filter undefined, map to objects
    // Combine and dedupe (owned might overlap if owner is also in trip_users)
    const allTrips = [...ownedTrips, ...participantTrips.map(pt => pt.tripId)];
    const uniqueTrips = Array.from(new Set(allTrips.map(t => t._id))).map(id => 
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
router.get('/:tripId/users', async (req, res) => {  // Note: auth already on mount, but explicit for clarity
  const { tripId } = req.params;

  try {
    // Check caller is participant
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    // Fetch all trip users, populate with full user details
    const tripUsers = await TripUser.find({ tripId }).populate('userId', 'firstName lastName email');  // Joins user fields
    console.log('Raw tripUsers after populate:', JSON.stringify(tripUsers, null, 2));  // DEBUG: See if names are there
    console.log('Populated tripUsers:', JSON.stringify(tripUsers, null, 2));  // DEBUG: Log raw data
    console.log('After populate - tripUsers[0].userId:', tripUsers[0]?.userId);  // DEBUG: See if it's object or string
    
    // Format response (group by role for easy UI)
    const formatted = tripUsers.map(tu => ({
      userId: tu.userId._id,
      name: `${tu.userId.firstName} ${tu.userId.lastName}`,
      email: tu.userId.email,
      role: tu.role
    }));

    // Group for display (e.g., frontend can use this)
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
  const { userId: targetUserId } = req.body;  // ID of user to remove

  // Validate
  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing userId to remove' });
  }

  try {
    // Check caller is participant and has permission
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    // Prevent self-removal
    if (targetUserId === req.user.id) {
      return res.status(400).json({ msg: 'Cannot remove yourself' });
    }

    // Role-based permission (reuse logic similar to roleCheck)
    const targetTripUser = await TripUser.findOne({ tripId, userId: targetUserId });
    if (!targetTripUser) {
      return res.status(404).json({ msg: 'Target user not found on trip' });
    }

    // VibeCoordinator can remove anyone; VibePlanner only Wanderers
    if (callerTripUser.role !== 'VibeCoordinator' && targetTripUser.role !== 'Wanderer') {
      return res.status(403).json({ msg: 'Insufficient permissions to remove this user' });
    }

    // Cannot remove VibeCoordinator (only reassign)
    if (targetTripUser.role === 'VibeCoordinator') {
      return res.status(400).json({ msg: 'Cannot remove VibeCoordinator—use reassign instead' });
    }

    // Remove from trip_users
    await TripUser.deleteOne({ tripId, userId: targetUserId });

    // Notify removed user and caller
    const removedUser = await User.findById(targetUserId);  // Get name for msg
    await notifyUsers([targetUserId], `You\'ve been removed from "${req.trip?.name || 'the trip'}" by ${callerTripUser.userId}.`, 'email');
    await notifyUsers([req.user.id], `Removed ${removedUser.firstName} ${removedUser.lastName} from the trip.`, 'email');

    res.json({ msg: 'User removed successfully!' });
  } catch (err) {
    console.error('Remove user error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/trips/:tripId/remove-user (Protected: Removes user by ID)
router.post('/:tripId/remove-user', async (req, res) => {
  const { tripId } = req.params;
  const { userId: targetUserId } = req.body;  // ID of user to remove

  // Validate input
  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing userId to remove' });
  }

  try {
    // Check caller is participant
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    // Prevent self-removal
    if (targetUserId === req.user.id) {
      return res.status(400).json({ msg: 'Cannot remove yourself' });
    }

    // Fetch target
    const targetTripUser = await TripUser.findOne({ tripId, userId: targetUserId });
    if (!targetTripUser) {
      return res.status(404).json({ msg: 'Target user not found on trip' });
    }

    // Role checks: Coordinator can remove anyone (except Coordinator); Planner only Wanderers
    if (callerTripUser.role !== 'VibeCoordinator') {
      if (targetTripUser.role !== 'Wanderer') {
        return res.status(403).json({ msg: 'VibePlanners can only remove Wanderers' });
      }
    } else if (targetTripUser.role === 'VibeCoordinator') {
      return res.status(400).json({ msg: 'Cannot remove VibeCoordinator—use reassign instead' });
    }

    // Delete from trip_users
    await TripUser.deleteOne({ tripId, userId: targetUserId });

    // Fetch removed user's name for notification
    const removedUser = await User.findById(targetUserId).select('firstName lastName');
    const trip = await Trip.findById(tripId).select('name');

    // Notify removed user and caller
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
  const { targetUserId } = req.body;  // VibePlanner to promote

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing targetUserId' });
  }

  try {
    // Check caller is current Coordinator
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser || callerTripUser.role !== 'VibeCoordinator') {
      return res.status(403).json({ msg: 'Only VibeCoordinator can reassign' });
    }

    // Validate target is VibePlanner
    const targetTripUser = await TripUser.findOne({ tripId, userId: targetUserId }).populate('userId', 'firstName lastName');
    console.log('Target query result:', targetTripUser ? { userId: targetTripUser.userId, role: targetTripUser.role } : 'Not found');  // DEBUG: See what query returns
    if (!targetTripUser || targetTripUser.role !== 'VibePlanner') {
      return res.status(400).json({ msg: 'Target must be a VibePlanner' });
    }

    // Swap roles
    callerTripUser.role = 'VibePlanner';
    targetTripUser.role = 'VibeCoordinator';
    await callerTripUser.save();
    await targetTripUser.save();

    // Update trips ownerId
    const trip = await Trip.findById(tripId);
    trip.ownerId = targetUserId;
    await trip.save();

    // Notify all participants
    const allParticipants = await TripUser.find({ tripId }).select('userId');
    const participantIds = allParticipants.map(tu => tu.userId);
    const reassignMsg = `Ownership transferred to ${targetTripUser.userId.firstName} ${targetTripUser.userId.lastName}—new VibeCoordinator!`;
    await notifyUsers(participantIds, reassignMsg, 'email');

    res.json({ msg: 'Ownership reassigned!', newCoordinator: targetTripUser.userId });
  } catch (err) {
    console.error('Reassign error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;