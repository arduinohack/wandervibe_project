const express = require('express');
const router = express.Router();
const { Event, Plan } = require('../models/Event'); // Import models
const authMiddleware = require('../middleware/auth'); // Assume you have this for authentication

// GET all events for a plan
router.get('/plan/:planId', authMiddleware, async (req, res) => {
  try {
    const events = await Event.find({ planId: req.params.planId, ownerId: req.user.userId });
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST new event (handles recursive subEvents)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const newEvent = new Event({
      ...req.body,
      ownerId: req.user.userId,
    });
    const savedEvent = await newEvent.save();
    res.status(201).json(savedEvent);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT update event (handles recursive subEvents)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.ownerId !== req.user.userId) return res.status(403).json({ message: 'Permission denied' });

    const updatedEvent = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedEvent);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE event
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.ownerId !== req.user.userId) return res.status(403).json({ message: 'Permission denied' });

    await Event.findByIdAndDelete(req.params.id);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;