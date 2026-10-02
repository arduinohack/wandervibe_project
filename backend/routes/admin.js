const express = require('express');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');
const ActivityRevision = require('../models/ActivityRevision');
const SupportLog = require('../models/SupportLog');
const { logSupport } = require('../utils/logSupport');

const router = express.Router();

function parseBound(value) {
  if (value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q == null ? '' : req.query.q).trim();
    if (q.length < 2) {
      return res.json({ users: [] });
    }
    const rows = await User.find({
      email: { $regex: escapeRegex(q), $options: 'i' },
    })
      .select('email firstName lastName role')
      .sort({ email: 1 })
      .limit(20)
      .lean();
    const users = rows.map((user) => ({
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const query = {};
    if (req.query.event) query.event = req.query.event;
    if (req.query.level) query.level = req.query.level;
    if (req.query.userId) query.actorUserId = req.query.userId;
    if (req.query.planId) query.planId = req.query.planId;

    const createdAt = {};
    const from = parseBound(req.query.from);
    const to = parseBound(req.query.to);
    if (from === undefined || to === undefined) {
      return res.status(400).json({ message: 'from and to must be ISO dates' });
    }
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lte = to;
    if (from || to) query.createdAt = createdAt;

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;

    let skip = parseInt(req.query.skip, 10);
    if (!Number.isFinite(skip) || skip < 0) skip = 0;

    const direction = String(req.query.dir || '').toLowerCase() === 'asc' ? 1 : -1;
    const docs = await SupportLog.find(query)
      .sort({ createdAt: direction })
      .skip(skip)
      .limit(limit);
    const logs = docs.map((doc) => doc.toObject());
    const userIds = [...new Set(logs.map((row) => row.actorUserId).filter(Boolean))];
    const planIds = [...new Set(logs.map((row) => row.planId).filter(Boolean))];
    const [users, plans] = await Promise.all([
      userIds.length
        ? User.find({ _id: { $in: userIds } }).select('email').lean()
        : [],
      planIds.length
        ? Plan.find({ _id: { $in: planIds } }).select('name').lean()
        : [],
    ]);
    const emailById = new Map(users.map((user) => [String(user._id), user.email || '']));
    const nameById = new Map(plans.map((plan) => [String(plan._id), plan.name || '']));
    for (const row of logs) {
      const storedEmail = typeof row.actorEmail === 'string' ? row.actorEmail.trim() : '';
      const lookedUp = emailById.get(String(row.actorUserId || '')) || '';
      row.actorEmail = storedEmail || lookedUp;
      row.planName = nameById.get(String(row.planId || '')) || '';
    }

    res.json({ logs });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Shared plans block the delete. Another member is not promoted.
router.delete('/users/:userId', async (req, res) => {
  try {
    const targetId = req.params.userId;
    const callerId = String((req.user && (req.user.userId || req.user.id)) || '');
    const target = await User.findById(targetId).select('_id');
    if (!target) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (callerId === String(targetId)) {
      return res.status(409).json({ message: 'You cannot delete your own account' });
    }

    const owned = await Plan.find({ ownerId: targetId }).select('_id name');
    const ownedIds = owned.map((plan) => plan._id);
    const blocking = [];
    if (ownedIds.length) {
      const [otherMembers, pendingOthers] = await Promise.all([
        PlanUser.find({ planId: { $in: ownedIds }, userId: { $ne: targetId } }).select('planId'),
        Invitation.find({
          planId: { $in: ownedIds },
          status: 'pending',
          userId: { $ne: targetId },
        }).select('planId'),
      ]);
      const blockedIds = new Set([
        ...otherMembers.map((row) => String(row.planId)),
        ...pendingOthers.map((row) => String(row.planId)),
      ]);
      for (const plan of owned) {
        if (blockedIds.has(String(plan._id))) {
          blocking.push({ _id: plan._id, name: plan.name });
        }
      }
    }
    if (blocking.length) {
      return res.status(409).json({
        message: 'User owns a plan still shared with someone else',
        plans: blocking,
      });
    }

    await Invitation.deleteMany({ $or: [{ userId: targetId }, { invitedBy: targetId }] });
    await PlanUser.deleteMany({ userId: targetId });

    const stillOwned = await Plan.find({ ownerId: targetId }).select('_id');
    const removable = [];
    for (const plan of stillOwned) {
      const planId = plan._id;
      const remainingMember = await PlanUser.exists({ planId });
      const pendingOther = await Invitation.exists({
        planId,
        status: 'pending',
        userId: { $ne: targetId },
      });
      if (!remainingMember && !pendingOther) removable.push(planId);
    }
    if (removable.length) {
      await Event.deleteMany({ planId: { $in: removable } });
      await ActivityRevision.deleteMany({ planId: { $in: removable } });
      await Invitation.deleteMany({ planId: { $in: removable } });
      await SupportLog.deleteMany({ planId: { $in: removable } });
      await Plan.deleteMany({ _id: { $in: removable } });
    }

    await logSupport({
      level: 'info',
      event: 'UserDeleted',
      actorUserId: callerId,
      message: 'User deleted',
      extra: { deletedUserId: targetId },
    });
    await User.findByIdAndDelete(targetId);

    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(`Admin delete user failed: ${err.message}`);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
