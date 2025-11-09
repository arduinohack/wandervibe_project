const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/auth.js');  // Token validation
const Event = require('../models/Event.js');  // Your Event model
const Joi = require('joi');  // For validation (npm i joi if missing)
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');  // Add at top if using UUID (npm i uuid)

const router = express.Router();

// Validation schema for core event fields
const eventValidationSchema = Joi.object({
  name: Joi.string().required(),
  location: Joi.string().optional().allow(''),
  type: Joi.string().required(),
  cost: Joi.number().min(0).optional().default(0),
  startTime: Joi.date().optional(),
  duration: Joi.number().min(0).optional().default(0),
  planId: Joi.string().required(),
  details: Joi.string().optional().allow(''),
  customType: Joi.string().optional().allow(''),
  costType: Joi.string().valid('estimated', 'actual').default('estimated'),
  endTime: Joi.date().optional(),
  eventNum: Joi.number().integer().min(0).optional().default(0),
  status: Joi.string().valid('draft', 'complete').default('draft').optional(),
  missingFields: Joi.array().items(Joi.string()).optional().default([]),
  subEvents: Joi.array().optional().default([]),
  extras: Joi.object().optional().default({}),
});

// Type-specific validation helper
function validateEventSpecific(eventData) {
  const { type, customType, subEvents, flightNumber, airline, roomNumber, checkInDate } = eventData;
  let error = '';

  if (type === 'custom' && !customType) {
    error = 'Cusom events require a customType';
  }
  
  /*switch (type) {
    case 'flight':
      if (!flightNumber) error = 'Flight number required';
      if (!airline) error = 'Airline required';
      if (subEvents && subEvents.length < 2) error = 'Flight requires 2 sub-events';
      subEvents?.forEach(se => {
        if (se.subType === 'departure' && !se.gate) error = 'Departure gate required';
        if (se.subType === 'arrival' && !se.baggageClaim) error = 'Arrival baggage claim required';
      });
      break;
    case 'hotel':
      if (!roomNumber) error = 'Room number required';
      if (!checkInDate) error = 'Check-in date required';
      break;
    default:
      if (!name) error = 'Name required';
  }*/

  return error;
}

// GET /api/events - Fetch all events for the user
router.get('/', authMiddleware , async (req, res) => {
  try {
    const userId = req.user.id;
    const events = await Event.find({ planId: { $in: req.user.plans } })
      .populate('planId', 'name')
      .sort({ startTime: 1 });
    res.json({ events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/events/:id - Fetch single event
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate('planId');
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.planId.ownerId !== req.user.id && !event.planId.participants.includes(req.user.id)) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    res.json({ event });
  } catch (error) {
    logger.error('Error fetching event:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/events - Create new event
router.post('/', authMiddleware, async (req, res) => {
  try {

    // Always validate basics (Joi for all, but skip custom for draft)
    const { error, value } = eventValidationSchema.validate(req.body, { allowUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    // Destructure from validated value (defaults applied)
    const { name, location, type, cost, startTime, duration, planId, details, customType, costType, endTime, eventNum, status, missingFields, subEvents, extras } = value;
    
    // Skip additional validation for drafts
    if (status !== 'draft') {
      const validationError = validateEventSpecific(value);
      if (validationError) return res.status(400).json({ message: validationError });
    }

    // Calculate endTime if duration provided
    let calculatedEndTime;
    if (duration && !endTime && startTime) {
      calculatedEndTime = new Date(startTime.getTime() + (duration * 60 * 1000));  // ms = minutes * 60s * 1000ms
    } else if (endTime) {
      calculatedEndTime = new Date(endTime);
    }

    if (calculatedEndTime <= new Date(startTime)) {
      return res.status(400).json({ message: 'endTime must be after startTime' });
    }

    // Create newEvent (fixed: subEvents, req.user.id, logger as console)
    const newEvent = new Event({
      _id: uuidv4(),
      name,
      location,
      type,
      cost: parseFloat(cost) || 0,
      startTime,
      duration: parseInt(duration) || 0,
      planId,
      details,
      customType,
      costType,
      endTime,
      eventNum: parseInt(eventNum) || 0,
      status: status || 'draft',  // FIXED: Default if missing
      missingFields: missingFields || [],
      subEvents: subEvents || [],  // FIXED: Destructured as subEvents
      extras: extras || {},
      ownerId: req.user.userId  // FIXED: req.user.id, not userId
    });

    logger.info('New event before save:', { name: newEvent.name, type: newEvent.type, status: newEvent.status });  // FIXED: Use newEvent

    await newEvent.save();
    res.status(201).json({ message: 'Event added!', event: newEvent });
  } catch (error) {
    logger.error('Error adding event:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message).join(', ');
      return res.status(400).json({ message: `Validation error: ${messages}` });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

//PUT /api/events - reorder events by eventNum for drag/drop changing event order if no no time fields
router.put('/:id/reorder', authMiddleware, async (req, res) => {
  try {
    const { eventNum } = req.body;
    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user.userId },
      { eventNum: parseInt(eventNum) || 0 },
      { new: true }
    );
    if (!event) return res.status(404).json({ message: 'Event not found' });
    res.json({ message: 'Event reordered!', event });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/events/:id - Update event
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.ownerId !== req.user.id) return res.status(403).json({ message: 'Not authorized' });

    const { error } = eventValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const validationError = validateEventSpecific(req.body);
    if (validationError) return res.status(400).json({ message: validationError });

    Object.assign(event, req.body);
    await event.save();
    res.json({ message: 'Event updated!', event });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/events/:id - Delete event if owner
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const deletedEvent = await Event.findOneAndDelete({ 
      _id: req.params.id,  // Match ID
      ownerId: req.user.userId  // FIXED: Combined check with ownerId
    });

    if (!deletedEvent) {
      return res.status(404).json({ message: 'Event not found or unauthorized' });  // 404 for both (secure)
    }

    res.json({ message: 'Event deleted!', deletedEvent });  // Optional: Return deleted for confirmation
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
module.exports = router;