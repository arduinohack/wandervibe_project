const SupportLog = require('../models/SupportLog');

const LEVELS = new Set(['info', 'warn', 'error']);
const SECRET_KEY = /password|token|authorization|api[-_]?key|secret/i;

function cleanExtra(extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(extra)) {
    if (SECRET_KEY.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

// Insert only. A failed write stays on the console and does not fail the request.
async function logSupport(entry = {}) {
  try {
    const level = LEVELS.has(entry.level) ? entry.level : 'info';
    await SupportLog.create({
      level,
      event: entry.event,
      actorUserId: entry.actorUserId,
      planId: entry.planId,
      eventId: entry.eventId,
      invitationId: entry.invitationId,
      message: entry.message,
      extra: cleanExtra(entry.extra),
    });
  } catch (err) {
    console.error(`Support log insert failed: ${err.message}`);
  }
}

module.exports = { logSupport };
