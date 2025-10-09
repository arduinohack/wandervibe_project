const express = require('express');
const Event = require('../models/Event');
const TripUser = require('../models/TripUser');
const { v4: uuidv4 } = require('uuid');
const { notifyUsers } = require('../utils/notifications');
const router = express.Router();

// POST /api/events (Protected: Creates event for trip)
router.post('/', async (req, res) => {  // Note: / in events.js becomes /api/events
  const { tripId, title, type, startTime, endTime, originTimeZone, destinationTimeZone, location, details, cost, costType, resourceLinks } = req.body;

  if (!tripId || !title || !type || !startTime || !endTime) {
    return res.status(400).json({ msg: 'Missing required fields: tripId, title, type, startTime, endTime' });
  }

  if (type === 'flight' && (!originTimeZone || !destinationTimeZone)) {
    return res.status(400).json({ msg: 'Flights require originTimeZone and destinationTimeZone' });
  }

  try {
    const callerTripUser = await TripUser.findOne({ tripId, userId: req.user.id });
    if (!callerTripUser) {
      return res.status(403).json({ msg: 'Access denied: Not a trip participant' });
    }

    const eventId = uuidv4();
    const event = new Event({
      _id: eventId,
      tripId,
      title,
      type,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      originTimeZone: type === 'flight' ? originTimeZone : undefined,
      destinationTimeZone: type === 'flight' ? destinationTimeZone : undefined,
      location,
      details,
      cost: cost || 0,
      costType: costType || 'estimated',
      resourceLinks: resourceLinks || {}
    });
    await event.save();

    const participants = await TripUser.find({ tripId }).select('userId');
    const participantIds = participants.map(tu => tu.userId);
    await notifyUsers(participantIds, `New event added: ${title} (${type})`, 'email');

    res.status(201).json({ msg: 'Event created!', event });
  } catch (err) {
    console.error('Event creation error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;