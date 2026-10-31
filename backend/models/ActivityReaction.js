const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const REACTION_TYPES = ['up', 'down', 'yes', 'no', 'maybe'];

const activityReactionSchema = new mongoose.Schema({
  _id: { type: String, default: () => uuidv4() },
  activityId: { type: String, required: true },
  planId: { type: String, required: true },
  userId: { type: String, required: true },
  type: { type: String, enum: REACTION_TYPES, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'activityReactions',
  versionKey: false,
});

// One vote per person, activity, and type. A later vote of that type replaces it.
activityReactionSchema.index(
  { activityId: 1, userId: 1, type: 1 },
  { unique: true },
);

const ActivityReaction = mongoose.models.ActivityReaction
  || mongoose.model('ActivityReaction', activityReactionSchema);

module.exports = ActivityReaction;
module.exports.REACTION_TYPES = REACTION_TYPES;
