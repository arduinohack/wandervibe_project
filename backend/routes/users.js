const express = require('express');
const User = require('../models/User');
const TripUser = require('../models/TripUser');
const Invitation = require('../models/Invitation');
const { adminCheck } = require('../middleware/adminCheck');
const router = express.Router();

// POST /api/users/:userId/delete (Admin-only: Deletes user and cascades)
router.post('/:userId/delete', adminCheck, async (req, res) => {
  const { userId } = req.params;

  try {
    // Self-deletion or admin (adjust as needed)
    if (userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Admin access required for deleting others' });
    }

    // Cascade: Remove from trip_users (all trips)
    const userRoles = await TripUser.find({ userId }).populate('tripId', 'name ownerId');
    await TripUser.deleteMany({ userId });

    // Remove pending invitations
    await Invitation.deleteMany({ userId });

    // Handle Coordinator trips
    for (const role of userRoles) {
      if (role.role === 'VibeCoordinator') {
        const trip = role.tripId;
        // Find another VibePlanner to transfer to
        const newCoordinator = await TripUser.findOne({ tripId: trip._id, role: 'VibePlanner' }).populate('userId', 'firstName lastName');
        if (newCoordinator) {
          // Transfer: Update ownerId and swap roles
          trip.ownerId = newCoordinator.userId._id;
          await trip.save();

          newCoordinator.role = 'VibeCoordinator';
          await newCoordinator.save();

          // Notify
          const participants = await TripUser.find({ tripId: trip._id }).select('userId');
          const participantIds = participants.map(tu => tu.userId._id);
          await notifyUsers(participantIds, `Ownership transferred to ${newCoordinator.userId.firstName} ${newCoordinator.userId.lastName} due to user deletion.`, 'email');
        } else {
          // No Planners—delete trip
          await Trip.findByIdAndDelete(trip._id);
          // Notify (if any left, but none)
        }
      }
    }

    // Delete user
    await User.findByIdAndDelete(userId);

    res.json({ msg: 'User deleted successfully—trips transferred or deleted' });
  } catch (err) {
    console.error('User deletion error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;