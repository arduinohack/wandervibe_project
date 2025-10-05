const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // UUID
  tripId: { type: String, required: true },
  userId: { type: String, required: true },
  invitedBy: { type: String, required: true },
  role: { type: String, enum: ['VibePlanner', 'Wanderer'], required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' }
}, { timestamps: true });

invitationSchema.index({ tripId: 1, userId: 1, status: 1 });

module.exports = mongoose.model('Invitation', invitationSchema);