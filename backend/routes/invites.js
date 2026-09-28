const express = require('express');
const Invitation = require('../models/Invitation');
const User = require('../models/User');
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

// POST /api/plans/:planId/invite
// Coordinator may invite a planner or wanderer. Planner may invite a wanderer.
planInviteRouter.post('/:planId/invite', roleCheck(['Owner', 'Collaborator']), async (req, res) => {
  const { planId } = req.params;
  const { email, role } = req.body;
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
    // Find invitee
    const invitee = await User.findOne({ email });
    if (!invitee) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Check if already invited/participant
    const existing = await Invitation.findOne({ planId, userId: invitee._id });
    if (existing) {
      return res.status(400).json({ msg: 'User already invited' });
    }

    // Create invitation
    const invitationId = uuidv4();
    const invitation = new Invitation({
      _id: invitationId,
      planId,
      userId: invitee._id,
      invitedBy: req.user.userId || req.user.id,
      role: storedRole
    });
    await invitation.save();

    // Notify invitee and inviter
    const inviteMessage = `You\'ve been invited to "${req.trip?.name || 'a trip'}" as ${storedRole}! Check app to accept.`;
    await notifyUsers([invitee._id], inviteMessage, 'email');
    await notifyUsers([req.user.userId || req.user.id], `Invited ${invitee.firstName} ${invitee.lastName} as ${storedRole}.`, 'email');

    res.status(201).json({ msg: 'Invitation sent!', invitation });
  } catch (err) {
    console.error('Invite error:', err);
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

    if (invitation.userId.toString() !== req.user.userId) {
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