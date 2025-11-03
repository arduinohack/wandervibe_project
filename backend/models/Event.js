const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');  // Generate UUID

// Sub-event schema for composite events (e.g., flight departure/arrival)
const subEventSchema = new mongoose.Schema({
  name: { type: String, required: true },  // e.g., 'Departure'
  location: { type: String, required: true },
  time: { type: Date, required: true },
  duration: { type: Number, default: 0 },  // Minutes
  details: { type: String, default: '' },
  subType: { type: String, required: true },  // 'departure', 'arrival', etc.

  // Type-specific fields (optional, validated in pre-save)
  gate: { type: String },  // For departure
  baggageClaim: { type: String },  // For arrival
  roomNumber: { type: String },  // For hotel check-in
  // Add more as types evolve (Mongoose ignores unused)
}, {
  _id: false,  // No _id for sub-documents
});

// Main Event schema
const eventSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },  // UUID as string
  title: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, required: true },  // 'flight', 'hotel', etc. (enum-like)
  cost: { type: Number, required: true },
  startTime: { type: Date, required: true },
  duration: { type: Number, default: 0 },  // Minutes
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  details: { type: String, default: '' },
  customType: { type: String, default: '' },  // User-defined type
  costType: { type: String, enum: ['estimated', 'actual'], default: 'estimated' },
  endTime: { type: Date, default: null },  // Optional, calculated if needed
  subEvents: [subEventSchema],  // Nested array for composite events (optional)
  extras: { type: mongoose.Schema.Types.Mixed },  // Dynamic user fields (optional)
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },  // For security
}, {
  timestamps: true,  // Auto createdAt/updatedAt
});

// Pre-save hook for type-specific validation
eventSchema.pre('save', function (next) {
  const e = this;
  let validationError = '';
  switch (e.type) {
    case 'flight':
      if (!e.flightNumber) validationError = 'Flight number required';
      if (!e.airline) validationError = 'Airline required';
      if (e.subEvents && e.subEvents.length < 2) validationError = 'Flight requires 2 sub-events (departure, arrival)';
      e.subEvents.forEach(se => {
        if (se.subType === 'departure' && !se.gate) validationError = 'Departure gate required';
        if (se.subType === 'arrival' && !se.baggageClaim) validationError = 'Arrival baggage claim required';
      });
      break;
    case 'hotel':
      if (!e.roomNumber) validationError = 'Room number required';
      if (!e.checkInDate) validationError = 'Check-in date required';
      break;
    // Add for other types (activity, meal, etc.)
    default:
      // Basic validation
      if (!e.title) validationError = 'Title required';
  }
  if (validationError) return next(new Error(validationError));
  next();
});

// Export the model
module.exports = mongoose.model('Event', eventSchema);