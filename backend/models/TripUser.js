const mongoose = require('mongoose');

const tripUserSchema = new mongoose.Schema({
  planId: { type: String, ref: 'Plan', required: true }, // FIXED: Add ref for populate
  userId: { type: String, ref: 'User', required: true },
  role: { type: String, enum: ['VibeCoordinator', 'VibePlanner', 'Wanderer'], required: true }
}, { timestamps: true });

// Unique index for multiple VibePlanners
tripUserSchema.index({ tripId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('TripUser', tripUserSchema);