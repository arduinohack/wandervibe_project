const express = require('express');
const router = express.Router();
const { Event } = require('../models/Event');
const ActivityRevision = require('../models/ActivityRevision');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const authMiddleware = require('../middleware/auth');
const { canonicalMembershipRole } = require('../middleware/roleCheck');
const { applyTypeChange, assertTypeRequirements } = require('../utils/activityTypeFields');
const { recordActivityRevision } = require('../utils/recordActivityRevision');
const { syncPlanDates } = require('../utils/syncPlanDates');
const { resolveActivitySchedule, resolveActivityZones } = require('../utils/activityTimes');

function applySchedule(target, schedule) {
  if (schedule.startTime) target.startTime = schedule.startTime;
  else delete target.startTime;
  if (schedule.endTime) target.endTime = schedule.endTime;
  else delete target.endTime;
  if (schedule.durationMinutes == null) delete target.durationMinutes;
  else target.durationMinutes = schedule.durationMinutes;
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

    const schedule = await resolveActivitySchedule({
      isCreate: true,
      planId,
      body: req.body,
    });
    if (schedule.error) {
      return res.status(400).json({ message: schedule.error });
    }
    const payload = { ...req.body, ownerId: callerId };
    applySchedule(payload, schedule);
    const zones = await resolveActivityZones({
      isCreate: true,
      planId,
      body: req.body,
    });
    payload.startTimeZone = zones.startTimeZone;
    payload.endTimeZone = zones.endTimeZone;
    payload.timeZone = zones.timeZone;
    const newEvent = new Event(payload);
    const savedEvent = await newEvent.save();
    await recordActivityRevision(savedEvent, 'create', callerId);
    await syncPlanDates(savedEvent.planId);
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

// Distinct path so a later POST /:id cannot swallow restore.
router.post('/:id/restore', authMiddleware, async (req, res) => {
  try {
    const eventId = req.params.id;
    const revisionId = req.body && req.body.revisionId;
    if (typeof revisionId !== 'string' || revisionId.trim() === '') {
      return res.status(400).json({ message: 'revisionId is required' });
    }

    const revision = await ActivityRevision.findById(revisionId);
    if (!revision) {
      return res.status(404).json({ message: 'Revision not found' });
    }
    if (String(revision.eventId) !== String(eventId)) {
      return res.status(400).json({ message: 'Revision does not belong to this activity' });
    }

    const event = await Event.findById(eventId);
    const planId = (event && event.planId) || revision.planId;
    const callerId = req.user.userId || req.user.id;
    const allowed = await callerMayEditActivities(planId, callerId);
    if (!allowed) {
      return res.status(403).json({ message: 'Only Owner or Collaborator can change activities' });
    }
    if (event && String(revision.planId) !== String(event.planId)) {
      return res.status(400).json({ message: 'Revision does not belong to this activity' });
    }

    // Snapshot is the only activity source. Other body fields are ignored.
    const snapshot = revision.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return res.status(400).json({ message: 'Revision snapshot is missing' });
    }
    const requirementError = assertTypeRequirements(snapshot.type, snapshot);
    if (requirementError) {
      return res.status(400).json({ message: requirementError.message });
    }

    const fields = applyTypeChange(event ? event.toObject({ virtuals: false }) : {}, snapshot.type, snapshot);
    fields.planId = planId;

    let saved;
    if (event) {
      for (const [key, value] of Object.entries(fields)) {
        if (key === '_id') continue;
        event.set(key, value);
      }
      event.planId = planId;
      saved = await event.save();
    } else {
      const payload = { _id: eventId, planId };
      for (const [key, value] of Object.entries(fields)) {
        if (key === '_id' || key === 'planId') continue;
        if (value !== undefined) payload[key] = value;
      }
      saved = await Event.create(payload);
    }

    // Same activity id, including a reinsert after delete: action update.
    await recordActivityRevision(saved, 'update', callerId);
    await syncPlanDates(planId);
    res.json(saved);
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
    const zones = await resolveActivityZones({
      isCreate: false,
      planId: event.planId,
      body,
      existing: event.toObject(),
    });
    fields.startTimeZone = zones.startTimeZone;
    fields.endTimeZone = zones.endTimeZone;
    fields.timeZone = zones.timeZone;
    const requirementError = assertTypeRequirements(fields.type, fields);
    if (requirementError) {
      return res.status(400).json({ message: requirementError.message });
    }

    const schedule = await resolveActivitySchedule({
      isCreate: false,
      planId: event.planId,
      body,
      existingStart: event.startTime,
      existingEnd: event.endTime,
    });
    if (schedule.error) {
      return res.status(400).json({ message: schedule.error });
    }
    applySchedule(fields, schedule);

    for (const [key, value] of Object.entries(fields)) {
      event.set(key, value);
    }
    if (!schedule.startTime) event.startTime = undefined;
    if (!schedule.endTime) event.endTime = undefined;
    if (schedule.durationMinutes == null) event.durationMinutes = undefined;
    else event.durationMinutes = schedule.durationMinutes;
    const updatedEvent = await event.save();
    await recordActivityRevision(updatedEvent, 'update', callerId);
    await syncPlanDates(updatedEvent.planId);
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

    const planId = event.planId;
    await Event.findByIdAndDelete(req.params.id);
    await recordActivityRevision(event, 'delete', callerId);
    await syncPlanDates(planId);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;