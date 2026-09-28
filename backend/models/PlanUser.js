const mongoose = require('mongoose');

const planUserSchema = new mongoose.Schema({
  planId: { type: String, ref: 'Plan', required: true },  // Ref to Plan model
  userId: { type: String, ref: 'User', required: true },
  role: { type: String, enum: ['Owner', 'Collaborator', 'Guest'], required: true }
}, { timestamps: true });

// Unique index for multiple roles per plan
planUserSchema.index({ planId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('PlanUser', planUserSchema);