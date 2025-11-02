const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/auth.js');  // Token validation
const Event = require('../models/Event.js');  // Your Event model
const Joi = require('joi');  // For validation (npm i joi if missing)

const router = express.Router();

// Validation schema for core event fields
const eventValidationSchema = Joi.object({
  title: Joi.string().required(),
  location: Joi.string().required(),
  type: Joi.string().required(),
  cost: Joi.number().required(),
  startTime: Joi.date().required(),
  duration: Joi.number().default(0),
  planId: Joi.string().required(),
  details: Joi.string().default(''),
  customType: Joi.string().default(''),
  costType: Joi.string().valid('estimated', 'actual').default('estimated'),
  endTime: Joi.date().optional(),
  subEvents: Joi.array().optional(),
  extras: Joi.object().optional(),
});

// Type-specific validation helper
function validateEventSpecific(eventData) {
  const { type, subEvents, flightNumber, airline, roomNumber, checkInDate } = eventData;
  let error = '';

  switch (type) {
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
      if (!title) error = 'Title required';
  }

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
    console.error('Error fetching event:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/events - Create new event
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { error } = eventValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const validationError = validateEventSpecific(req.body);
    if (validationError) return res.status(400).json({ message: validationError });

    const newEvent = new Event({
      ...req.body,
      ownerId: req.user.id,
      createdAt: new Date(),
    });

    await newEvent.save();
    res.status(201).json({ message: 'Event added!', event: newEvent });
  } catch (error) {
    console.error('Error adding event:', error);
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

// DELETE /api/events/:id - Delete event
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.ownerId !== req.user.id) return res.status(403).json({ message: 'Not authorized' });
    res.json({ message: 'Event deleted!' });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;