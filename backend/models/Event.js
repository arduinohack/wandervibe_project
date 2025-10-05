const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // UUID
  tripId: { type: String, required: true },
  title: { type: String, required: true },
  location: { type: String },
  details: { type: String },
  type: { type: String, enum: ['flight', 'car', 'dining', 'hotel', 'tour', 'attraction', 'cruise'], required: true },
  cost: { type: Number, default: 0 },
  costType: { type: String, enum: ['estimated', 'actual'], default: 'estimated' },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  originTimeZone: { type: String }, // Required for flights
  destinationTimeZone: { type: String }, // Required for flights
  resourceLinks: {
    maps: String,
    uber: String,
    booking: String
  }
}, { timestamps: true });

// Indexes
eventSchema.index({ tripId: 1, startTime: 1, endTime: 1 });
eventSchema.index({ title: 'text', details: 'text' });

module.exports = mongoose.model('Event', eventSchema);