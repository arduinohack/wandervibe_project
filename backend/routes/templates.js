const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Template = require('../models/Template');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const { Event } = require('../models/Event');
const authMiddleware = require('../middleware/auth.js');
const { preparePlanCreate } = require('../utils/planAccess');
const { logSupport } = require('../utils/logSupport');
const {
  readTemplateName,
  readTemplateStart,
  templateFieldsFromPlan,
  shiftedTemplatePlan,
} = require('../utils/planTemplate');

const router = express.Router();

function planGateBody(gate) {
  if (gate && gate.body && typeof gate.body === 'object') return gate.body;
  return { message: gate && gate.message };
}

function callerIdOf(req) {
  return req.user.userId || req.user.id;
}

// GET /api/templates
// Templates owned by the caller. They are not plans and do not count toward the cap.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const callerId = callerIdOf(req);
    const templates = await Template.find({ ownerId: String(callerId) })
      .select('-activities')
      .sort({ createdAt: -1 });
    return res.json({ templates });
  } catch (err) {
    console.error('List templates error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/templates/:templateId/create-plan { name, startDate }
// A new owned plan. Activity days move so the first start lands on startDate.
router.post('/:templateId/create-plan', authMiddleware, async (req, res) => {
  const templateId = String(req.params.templateId || '');
  try {
    const callerId = callerIdOf(req);
    const template = await Template.findOne({
      _id: templateId,
      ownerId: String(callerId),
    }).lean();
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const named = readTemplateName(req.body);
    if (named.error) return res.status(400).json({ message: named.error });
    const start = readTemplateStart(req.body);
    if (start.error) return res.status(400).json({ message: start.error });

    const gate = await preparePlanCreate(callerId);
    if (gate.status !== 200) {
      return res.status(gate.status).json(planGateBody(gate));
    }

    const shifted = shiftedTemplatePlan(template, start.date);
    const newId = uuidv4();
    const fields = templateFieldsFromPlan(template);
    const plan = new Plan({
      ...fields,
      _id: newId,
      name: named.name,
      startDate: shifted.startDate,
      endDate: shifted.endDate,
      ownerId: callerId,
    });
    const copies = shifted.activities.map((activity) => ({
      ...activity,
      _id: uuidv4(),
      planId: newId,
      ownerId: String(callerId),
    }));
    try {
      await plan.save();
      await new PlanUser({ planId: newId, userId: callerId, role: 'Owner' }).save();
      if (copies.length) await Event.insertMany(copies);
    } catch (err) {
      await Event.deleteMany({ planId: newId });
      await PlanUser.deleteMany({ planId: newId });
      await Plan.deleteOne({ _id: newId });
      throw err;
    }

    await logSupport({
      level: 'info',
      event: 'PlanFromTemplate',
      actorUserId: callerId,
      planId: newId,
      message: 'Plan created from template',
      extra: { templateId, name: named.name },
    });

    const saved = await Plan.findById(newId);
    return res.status(201).json({ plan: saved });
  } catch (err) {
    console.error('Create plan from template error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
