const ActivityRevision = require('../models/ActivityRevision');
const logger = require('../utils/logger');

let lastRevisionMs = 0;

function nextRevisionAt() {
  const now = Date.now();
  lastRevisionMs = Math.max(now, lastRevisionMs + 1);
  return new Date(lastRevisionMs);
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

module.exports = { recordActivityRevision };
