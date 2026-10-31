const { v4: uuidv4 } = require('uuid');
const ActivityReaction = require('../models/ActivityReaction');
const { REACTION_TYPES } = ActivityReaction;

const SIMPLE_TYPES = ['up', 'down'];
const POLL_TYPES = ['yes', 'no', 'maybe'];

function emptyCounts() {
  return { up: 0, down: 0, yes: 0, no: 0, maybe: 0 };
}

function groupFor(type) {
  if (SIMPLE_TYPES.includes(type)) return SIMPLE_TYPES;
  if (POLL_TYPES.includes(type)) return POLL_TYPES;
  return null;
}

function readReactionType(body) {
  const type = body && typeof body.type === 'string' ? body.type.trim() : '';
  if (!REACTION_TYPES.includes(type)) {
    return { error: 'Type must be up, down, yes, no, or maybe' };
  }
  return { type };
}

async function reactionSummary(activityId, userId) {
  const rows = await ActivityReaction.find({ activityId: String(activityId) })
    .select('userId type')
    .lean();
  const counts = emptyCounts();
  const mine = new Set();
  const caller = String(userId || '');
  for (const row of rows) {
    if (!REACTION_TYPES.includes(row.type)) continue;
    counts[row.type] += 1;
    if (String(row.userId) === caller) mine.add(row.type);
  }
  return {
    counts,
    myVotes: REACTION_TYPES.filter((type) => mine.has(type)),
  };
}

async function upsertReaction(filter, update) {
  try {
    await ActivityReaction.updateOne(filter, update, {
      upsert: true,
      setDefaultsOnInsert: false,
    });
  } catch (error) {
    if (error && error.code === 11000) {
      await ActivityReaction.updateOne(filter, update);
      return;
    }
    throw error;
  }
}

// A thumbs vote replaces the other thumb. A poll vote replaces the other poll votes.
async function setReaction({ activityId, planId, userId, type }) {
  const id = String(activityId);
  const person = String(userId);
  const group = groupFor(type);
  await upsertReaction(
    { activityId: id, userId: person, type },
    {
      $set: { planId: String(planId), createdAt: new Date() },
      $setOnInsert: { _id: uuidv4() },
    },
  );
  if (!group) return;
  const others = group.filter((item) => item !== type);
  if (!others.length) return;
  await ActivityReaction.deleteMany({
    activityId: id,
    userId: person,
    type: { $in: others },
  });
}

async function clearReaction({ activityId, userId, type }) {
  await ActivityReaction.deleteMany({
    activityId: String(activityId),
    userId: String(userId),
    type,
  });
}

async function removeActivityReactions(activityId) {
  const id = String(activityId || '').trim();
  if (!id) return;
  await ActivityReaction.deleteMany({ activityId: id });
}

async function removePlanReactions(planId) {
  const ids = (Array.isArray(planId) ? planId : [planId])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (!ids.length) return;
  await ActivityReaction.deleteMany({ planId: { $in: ids } });
}

module.exports = {
  REACTION_TYPES,
  emptyCounts,
  readReactionType,
  reactionSummary,
  setReaction,
  clearReaction,
  removeActivityReactions,
  removePlanReactions,
};
