const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  _id: { type: String, required: true, unique: true }, // UUID
  name: { type: String, required: true },
  destination: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  budget: { type: Number, default: 0 },
  planningState: { type: String, enum: ['initial', 'complete'], default: 'initial' },
  timeZone: { type: String, required: true }, // e.g., 'America/New_York'
  notificationSettings: {
    initialFrequency: { type: String, default: 'daily' },
    completeFrequency: { type: String, default: 'weekly' }
  },
  ownerId: { type: String, required: true } // References users._id
}, { timestamps: true });

// Indexes
tripSchema.index({ name: 'text', destination: 'text' });
tripSchema.index({ ownerId: 1 });

module.exports = mongoose.model('Trip', tripSchema);