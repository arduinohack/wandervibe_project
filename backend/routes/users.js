const express = require('express');
const User = require('../models/User');
const TripUser = require('../models/TripUser');
const Invitation = require('../models/Invitation');
const { adminCheck } = require('../middleware/adminCheck');
const {
  AI_PROVIDER_SET,
  ENCRYPTION_MESSAGE,
  encryptionConfigured,
  encryptApiKey,
} = require('../utils/aiProvider');
const router = express.Router();
const settingsRouter = express.Router();

const PROVIDER_MESSAGE = 'Provider must be xai, openai, anthropic, gemini, or none';

function callerId(req) {
  const id = req.user && (req.user.userId || req.user.id);
  return typeof id === 'string' ? id : '';
}

function settingsBody(user) {
  const provider = AI_PROVIDER_SET.has(user && user.aiProvider) ? user.aiProvider : 'none';
  const encrypted = user && user.aiApiKeyEncrypted;
  return {
    aiProvider: provider,
    hasKey: typeof encrypted === 'string' && encrypted.length > 0,
  };
}

// GET /api/users/me/ai-settings
settingsRouter.get('/me/ai-settings', async (req, res) => {
  try {
    const userId = callerId(req);
    if (!userId) return res.status(401).json({ message: 'No token, authorization denied' });
    const user = await User.findById(userId).select('aiProvider +aiApiKeyEncrypted').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(settingsBody(user));
  } catch (err) {
    const message = err && err.message ? err.message : 'request failed';
    console.error('AI settings read failed:', message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/me/ai-settings
// A blank or missing apiKey clears the stored key. Provider "none" also clears it.
settingsRouter.put('/me/ai-settings', async (req, res) => {
  try {
    const userId = callerId(req);
    if (!userId) return res.status(401).json({ message: 'No token, authorization denied' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : null;
    if (!body || typeof body.aiProvider !== 'string') {
      return res.status(400).json({ message: PROVIDER_MESSAGE });
    }
    const provider = body.aiProvider.trim();
    if (!AI_PROVIDER_SET.has(provider)) {
      return res.status(400).json({ message: PROVIDER_MESSAGE });
    }
    if (Object.prototype.hasOwnProperty.call(body, 'apiKey')
      && body.apiKey != null
      && typeof body.apiKey !== 'string') {
      return res.status(400).json({ message: 'API key must be text' });
    }

    const user = await User.findById(userId).select('_id');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const typed = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const clear = provider === 'none' || !typed;
    let encrypted = '';
    if (!clear) {
      if (!encryptionConfigured()) {
        return res.status(500).json({ message: ENCRYPTION_MESSAGE });
      }
      encrypted = encryptApiKey(typed);
    }

    const update = clear
      ? { $set: { aiProvider: provider }, $unset: { aiApiKeyEncrypted: '' } }
      : { $set: { aiProvider: provider, aiApiKeyEncrypted: encrypted } };
    await User.updateOne({ _id: userId }, update);

    return res.json({
      aiProvider: provider,
      hasKey: !clear,
    });
  } catch (err) {
    const message = err && err.message === ENCRYPTION_MESSAGE
      ? ENCRYPTION_MESSAGE
      : 'Server error';
    if (message === 'Server error') console.error('AI settings save failed');
    return res.status(500).json({ message });
  }
});

// POST /api/users/:userId/delete (Admin-only: Deletes user and cascades)
router.post('/:userId/delete', adminCheck, async (req, res) => {
  const { userId } = req.params;

  try {
    // Self-deletion or admin (adjust as needed)
    if (userId !== req.user.userId && req.user.role !== 'admin') {
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
module.exports.settingsRouter = settingsRouter;