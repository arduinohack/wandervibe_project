const express = require('express');
const Trip = require('../models/Trip');  // Our Trip schema
const TripUser = require('../models/TripUser');  // Role assignments
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

module.exports = router;