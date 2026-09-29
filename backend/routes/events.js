const express = require('express');
const router = express.Router();
const { Event } = require('../models/Event');
const ActivityRevision = require('../models/ActivityRevision');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const authMiddleware = require('../middleware/auth');
const { canonicalMembershipRole } = require('../middleware/roleCheck');
const { applyTypeChange, assertTypeRequirements } = require('../utils/activityTypeFields');
const logger = require('../utils/logger');

let lastRevisionMs = 0;

function nextRevisionAt() {
  const now = Date.now();
  lastRevisionMs = Math.max(now, lastRevisionMs + 1);
  return new Date(lastRevisionMs);
}

async function membershipRole(planId, callerId) {
  const membership = await PlanUser.findOne({ planId, userId: callerId });
  let role = canonicalMembershipRole(membership && membership.role);
  if (!role) {
    const plan = await Plan.findById(planId).select('ownerId');
    if (plan && plan.ownerId === callerId) role = 'Owner';
  }
  return role;
}

async function callerMayEditActivities(planId, callerId) {
  const role = await membershipRole(planId, callerId);
  return role === 'Owner' || role === 'Collaborator';
}

async function callerMayReadHistory(planId, callerId) {
  const role = await membershipRole(planId, callerId);
  return role === 'Owner' || role === 'Collaborator' || role === 'Guest';
}

function revisionPayload(revision) {
  return {
    _id: revision._id,
    eventId: revision.eventId,
    planId: revision.planId,
    userId: revision.userId,
    action: revision.action,
    snapshot: revision.snapshot,
    createdAt: revision.createdAt,
    deleted: revision.deleted === true,
  };
}

// History is secondary: a failed insert must not change the activity response.
async function recordActivityRevision(eventDoc, action, userId) {
  try {
    const snapshot = eventDoc.toObject({ virtuals: false });
    await ActivityRevision.create({
      eventId: String(eventDoc._id),
      planId: eventDoc.planId,
      userId,
      action,
      snapshot,
      deleted: action === 'delete',
      createdAt: nextRevisionAt(),
    });
  } catch (error) {
    logger.error(`Activity revision insert failed: ${error.message}`, {
      userId,
      event: 'ActivityRevisionFailed',
      context: { eventId: String(eventDoc && eventDoc._id), action },
    });
  }
}

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
    const callerId = req.user.userId || req.user.id;
    const planId = req.body && req.body.planId;
    if (!planId) {
      return res.status(400).json({ message: 'planId is required' });
    }
    const allowed = await callerMayEditActivities(planId, callerId);
    if (!allowed) {
      return res.status(403).json({ message: 'Only Owner or Collaborator can change activities' });
    }

    const newEvent = new Event({
      ...req.body,
      ownerId: callerId,
    });
    const savedEvent = await newEvent.save();
    await recordActivityRevision(savedEvent, 'create', callerId);
    res.status(201).json(savedEvent);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Declared before /:id so a later GET /:id cannot swallow history.
router.get('/:id/history', authMiddleware, async (req, res) => {
  try {
    const eventId = req.params.id;
    const revisions = await ActivityRevision.find({ eventId }).sort({ createdAt: -1 });
    if (!revisions.length) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const event = await Event.findById(eventId).select('planId');
    const planId = (event && event.planId) || revisions[0].planId;
    const callerId = req.user.userId || req.user.id;
    const allowed = await callerMayReadHistory(planId, callerId);
    if (!allowed) {
      return res.status(403).json({ message: 'Only plan members can view activity history' });
    }

    res.json(revisions.map(revisionPayload));
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT update event (handles recursive subEvents)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const callerId = req.user.userId || req.user.id;
    const allowed = await callerMayEditActivities(event.planId, callerId);
    if (!allowed) {
      return res.status(403).json({ message: 'Only Owner or Collaborator can change activities' });
    }

    const body = req.body || {};
    const nextType = Object.prototype.hasOwnProperty.call(body, 'type') ? body.type : event.type;
    const fields = applyTypeChange(event.toObject(), nextType, body);
    const requirementError = assertTypeRequirements(fields.type, fields);
    if (requirementError) {
      return res.status(400).json({ message: requirementError.message });
    }

    for (const [key, value] of Object.entries(fields)) {
      event.set(key, value);
    }
    const updatedEvent = await event.save();
    await recordActivityRevision(updatedEvent, 'update', callerId);
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
    const callerId = req.user.userId || req.user.id;
    const allowed = await callerMayEditActivities(event.planId, callerId);
    if (!allowed) {
      return res.status(403).json({ message: 'Only Owner or Collaborator can change activities' });
    }

    await Event.findByIdAndDelete(req.params.id);
    await recordActivityRevision(event, 'delete', callerId);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;