const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // UUID
  planId: { type: String, required: true },
  title: { type: String, required: true },
  location: { type: String },
  details: { type: String },
  type: { type: String, enum: ['flight', 'car', 'dining', 'hotel', 'tour', 'attraction', 'cruise', 'setup', 'ceremony', 'reception', 'vendor', 'custom'], required: true },  // Added 'custom'
  customType: { type: String, required: function() { return this.type === 'custom'; } },  // User-defined name
  cost: { type: Number, default: 0 },
  costType: { type: String, enum: ['estimated', 'actual'], default: 'estimated' },
  startTime: { type: Date, required: true },
  duration: { type: Number, min: 0 }, //duration of event in minutes
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
eventSchema.index({ planId: 1, startTime: 1, endTime: 1 });
eventSchema.index({ title: 'text', details: 'text' });

module.exports = mongoose.model('Event', eventSchema);