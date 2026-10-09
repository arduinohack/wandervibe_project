const express = require('express');
const Invitation = require('../models/Invitation');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const { v4: uuidv4 } = require('uuid');
const { notifyUsers } = require('../utils/notifications');
const { roleCheck, canonicalMembershipRole } = require('../middleware/roleCheck');
const planInviteRouter = express.Router();
const invitesRouter = express.Router();

const INVITE_ROLES = {
  Collaborator: 'Collaborator',
  VibePlanner: 'Collaborator',
  planner: 'Collaborator',
  Guest: 'Guest',
  Wanderer: 'Guest',
  wanderer: 'Guest',
};

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emailMatch(email) {
  return { email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } };
}

function signupLink(email) {
  return `https://planitvibe.com/signup?email=${encodeURIComponent(email)}`;
}

// POST /api/plans/:planId/invite
// Owner may send Collaborator or Guest. Collaborator may send Guest.
planInviteRouter.post('/:planId/invite', roleCheck(['Owner', 'Collaborator']), async (req, res) => {
  const { planId } = req.params;
  const { role } = req.body;
  const email = normalizeEmail(req.body && req.body.email);
  const storedRole = INVITE_ROLES[role];

  if (!email || !storedRole) {
    return res.status(400).json({ msg: 'Missing email or invalid role' });
  }

  const callerRole = canonicalMembershipRole(req.planUser && req.planUser.role);
  if (storedRole === 'Collaborator' && callerRole !== 'Owner') {
    return res.status(403).json({ msg: 'Only Owner can invite Collaborators' });
  }
  if (storedRole === 'Guest' && callerRole !== 'Owner' && callerRole !== 'Collaborator') {
    return res.status(403).json({ msg: 'Only Owner or Collaborator can invite Guests' });
  }

  try {
    const invitee = await User.findOne(emailMatch(email));
    const existingQuery = invitee
      ? { planId, $or: [{ userId: invitee._id }, { email }] }
      : { planId, email };
    const existing = await Invitation.findOne(existingQuery);
    if (existing) {
      return res.status(400).json({ msg: 'User already invited' });
    }

    const plan = await Plan.findById(planId).select('name').lean();
    const planName = (plan && plan.name) || 'a trip';
    const callerId = req.user.userId || req.user.id;

    const invitation = new Invitation({
      _id: uuidv4(),
      planId,
      invitedBy: callerId,
      role: storedRole,
      email,
      ...(invitee ? { userId: invitee._id } : {}),
    });
    await invitation.save();

    if (invitee) {
      const inviteMessage = `You've been invited to "${planName}" as ${storedRole} on PlanItVibe! Check app to accept.`;
      await notifyUsers([invitee._id], inviteMessage, 'email');
      await notifyUsers(
        [callerId],
        `Invited ${invitee.firstName} ${invitee.lastName} as ${storedRole}.`,
        'email',
      );
    } else {
      const inviteMessage = `You've been invited to "${planName}" as ${storedRole} on PlanItVibe! ${signupLink(email)}`;
      await notifyUsers([email], inviteMessage, 'email');
      await notifyUsers([callerId], `Invited ${email} as ${storedRole}.`, 'email');
    }

    res.status(201).json({ msg: 'Invitation sent!', invitation });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

const INVITE_STATUSES = ['pending', 'accepted', 'rejected'];

// GET /api/invites — invitations where the caller is the invitee
invitesRouter.get('/', async (req, res) => {
  const callerId = req.user.userId || req.user.id;
  const { status } = req.query;

  if (status !== undefined && !INVITE_STATUSES.includes(status)) {
    return res.status(400).json({ msg: 'Invalid status—must be pending, accepted, or rejected' });
  }

  try {
    const filter = { userId: callerId };
    if (status) filter.status = status;

    const invitations = await Invitation.find(filter).sort({ createdAt: -1 }).lean();
    const planIds = [...new Set(invitations.map((invitation) => invitation.planId))];
    const inviterIds = [...new Set(invitations.map((invitation) => invitation.invitedBy))];
    const [plans, inviters] = await Promise.all([
      Plan.find({ _id: { $in: planIds } }).select('name').lean(),
      User.find({ _id: { $in: inviterIds } }).select('firstName lastName email').lean(),
    ]);
    const plansById = new Map(plans.map((plan) => [plan._id, plan]));
    const usersById = new Map(inviters.map((user) => [user._id, user]));

    res.json(invitations.map((invitation) => {
      const plan = plansById.get(invitation.planId);
      const inviter = usersById.get(invitation.invitedBy);
      return {
        ...invitation,
        planName: plan ? plan.name : null,
        inviter: inviter
          ? { firstName: inviter.firstName, lastName: inviter.lastName, email: inviter.email }
          : null,
      };
    }));
  } catch (err) {
    console.error('List invitations error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/invitations/:invitationId/respond (Protected: Accept/reject invite)
invitesRouter.post('/invitations/:invitationId/respond', async (req, res) => {
  const { invitationId } = req.params;
  const { status } = req.body;  // 'accepted' or 'rejected'

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ msg: 'Invalid status—must be accepted or rejected' });
  }

  try {
    // Fetch and check invitation (only invitee can respond)
    const invitation = await Invitation.findById(invitationId);
    if (!invitation || invitation.status !== 'pending') {
      return res.status(404).json({ msg: 'Invitation not found or already responded' });
    }

    if (!invitation.userId || invitation.userId.toString() !== req.user.userId) {
      return res.status(403).json({ msg: 'Access denied: Not your invitation' });
    }

    const storedRole = canonicalMembershipRole(invitation.role);
    if (storedRole) invitation.role = storedRole;
    invitation.status = status;
    await invitation.save();

    if (status === 'accepted') {
      await PlanUser.findOneAndUpdate(
        { planId: invitation.planId, userId: invitation.userId },
        { planId: invitation.planId, userId: invitation.userId, role: invitation.role },
        { upsert: true, new: true }
      );

      // Notify all trip participants (fetch them)
      const tripParticipants = await PlanUser.find({ planId: invitation.planId }).select('userId');
      const participantIds = tripParticipants.map(tu => tu.userId);
      const acceptMsg = `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName} accepted your invite as ${invitation.role}!`;
      await notifyUsers(participantIds, acceptMsg, 'email');
    } else {
      // Rejected: Notify inviter
      const rejectMsg = `${req.user.firstName} ${req.user.lastName} rejected your invite to ${invitation.tripId}.`;
      await notifyUsers([invitation.invitedBy._id], rejectMsg, 'email');
    }

    // Final notify to responder
    const responseMsg = status === 'accepted' ? `Welcome to the trip as ${invitation.role}!` : 'Invite rejected.';
    await notifyUsers([req.user.userId], responseMsg, 'email');

    res.json({ msg: `Invitation ${status}!`, invitation });
  } catch (err) {
    console.error('Respond error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = { planInviteRouter, invitesRouter };