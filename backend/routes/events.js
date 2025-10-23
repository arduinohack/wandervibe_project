const express = require('express');
const Event = require('../models/Event');
const Plan = require('../models/Plan');  // This line
const PlanUser = require('../models/PlanUser');
const { v4: uuidv4 } = require('uuid');
const { notifyUsers } = require('../utils/notifications');
const router = express.Router();
const logger = require('../utils/logger');  // Add this import


// POST /api/events (Protected: Creates event for plan)
router.post('/', async (req, res) => {  // Note: / in events.js becomes /api/events
  const { planId, title, location, details, type, customType, cost, costType, startTime, duration, endTime, originTimeZone, destinationTimeZone, resourceLinks } = req.body;

  // Validate required
  if (!planId || !title || !type || !startTime || (!duration && !endTime)) {
    return res.status(400).json({ msg: 'Missing required: planId, title, type, startTime, and either duration or endTime' });
  }

  // Custom type: Require all details (user provides logic)
  if (type === 'custom') {
    if (!customType || !location || !details) {  // Example: Require extra for custom
      return res.status(400).json({ msg: 'Custom events require customType, location, details' });
    }
    // No special logic—user defines everything
  }

  // For custom types, no extra validation—user-defined
  if (type.startsWith('custom:') && (!title || !startTime || !endTime)) {
    return res.status(400).json({ msg: 'Custom events require title, startTime, endTime' });
  }

  // Calculate endTime if duration provided
  let calculatedEndTime;
  if (duration && !endTime) {
    calculatedEndTime = new Date(startTime.getTime() + (duration * 60 * 1000));  // ms = minutes * 60s * 1000ms
  } else if (endTime) {
    calculatedEndTime = new Date(endTime);
  }

  // Validate endTime > startTime
  if (calculatedEndTime <= new Date(startTime)) {
    return res.status(400).json({ msg: 'endTime must be after startTime' });
  }

  if (type === 'flight' && (!originTimeZone || !destinationTimeZone)) {
    return res.status(400).json({ msg: 'Flights require originTimeZone and destinationTimeZone' });
  }

  // Helper: Auto-populate plan dates from events (earliest start, latest end)
  const updatePlanDates = async (planId) => {
    try {
      const plan = await Plan.findById(planId);  // Fetch Plan to check flags
      if (!plan) {
        logger.info('No plan found for ID:', planId);  // Debug log
        return;  // Skip if not found
      }

      const allEvents = await Event.find({ $or: [{ tripId: planId }, { planId: planId }] }).sort('startTime');
      if (allEvents.length === 0) return;  // No events, no update

      const earliestStart = allEvents[0].startTime;
      const latestEnd = allEvents[allEvents.length - 1].endTime;

      const update = {};
      if (plan.autoCalculateStartDate) update.startDate = earliestStart;
      if (plan.autoCalculateEndDate) update.endDate = latestEnd;

      if (Object.keys(update).length > 0) {
        await Plan.findByIdAndUpdate(planId, update);
        logger.info('Plan dates auto-updated:', update);  // Debug log
      }
    } catch (err) {
      logger.error('updatePlanDates error:', err);  // Log but don't crash
    }
  };

  try {
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
    }

    const eventId = uuidv4();
    const event = new Event({
      _id: eventId,
      planId,
      title,
      type,
      customType: req.body.customType,
      startTime: new Date(startTime),
      endTime,
      duration: duration || null,
      originTimeZone: type === 'flight' ? originTimeZone : undefined,
      destinationTimeZone: type === 'flight' ? destinationTimeZone : undefined,
      location,
      details,
      cost: cost || 0,
      costType: costType || 'estimated',
      resourceLinks: resourceLinks || {}
    });
    await event.save();

    // Call after save
    await updatePlanDates(planId);

    const participants = await PlanUser.find({ planId }).select('userId');
    const participantIds = participants.map(tu => tu.userId);
    await notifyUsers(participantIds, `New event added: ${title} (${type})`, 'email');

    res.status(201).json({ msg: 'Event created!', event });
  } catch (err) {
    console.error('Event creation error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;