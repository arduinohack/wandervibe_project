const express = require('express');
const Invitation = require('../models/Invitation');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const { notifyUsers } = require('../utils/notifications');
const { roleCheck } = require('../middleware/roleCheck');
const router = express.Router();

// POST /api/trips/:tripId/invite (Protected: Invites user by email as role)
router.post('/trips/:tripId/invite', roleCheck('VibePlanner'), async (req, res) => {  // Note: We'll adjust for Wanderer later
  const { tripId } = req.params;
  const { email, role } = req.body;  // role: 'VibePlanner' or 'Wanderer'

  // Validate
  if (!email || !['VibePlanner', 'Wanderer'].includes(role)) {
    return res.status(400).json({ msg: 'Missing email or invalid role' });
  }

  // For Wanderer: Use looser roleCheck
  if (role === 'Wanderer') {
    // Re-run with Wanderer check (middleware is per-route, so we call it dynamically)
    // Note: For simplicity, we'll use the same middleware—adjust in use below
  }

  try {
    // Find invitee
    const invitee = await User.findOne({ email });
    if (!invitee) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Check if already invited/participant
    const existing = await Invitation.findOne({ tripId, userId: invitee._id });
    if (existing) {
      return res.status(400).json({ msg: 'User already invited' });
    }

    // Create invitation
    const invitationId = uuidv4();
    const invitation = new Invitation({
      _id: invitationId,
      tripId,
      userId: invitee._id,
      invitedBy: req.user.id,  // From auth
      role
    });
    await invitation.save();

    // Notify invitee and inviter
    const inviteMessage = `You\'ve been invited to "${req.trip?.name || 'a trip'}" as ${role}! Check app to accept.`;
    await notifyUsers([invitee._id], inviteMessage, 'email');
    await notifyUsers([req.user.id], `Invited ${invitee.firstName} ${invitee.lastName} as ${role}.`, 'email');

    res.status(201).json({ msg: 'Invitation sent!', invitation });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;