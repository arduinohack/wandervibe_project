const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');  // Generate UUID

// Sub-event schema for composite events (e.g., flight departure/arrival)
const subEventSchema = new mongoose.Schema({
  name: { type: String, required: true },  // e.g., 'Departure'
  location: { type: String, default: '' },
  time: { type: Date },
  timeZone: {type: String, default: ''}, // Time zone of time in this subevent
  duration: { type: Number, default: 0 },  // Minutes
  details: { type: String, default: '' },
  subType: { type: String, required: true },  // 'departure', 'arrival', etc.
  extras: { type: mongoose.Schema.Types.Mixed },  // Added: User-defined fields (anything)

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
    _id: { type: String, default: uuidv4 },  // Added: Auto-generate UUID string (or omit for ObjectId)
    name: { type: String, required: true },
    location: { type: String, default: '' },  // Fixed: Optional with default
    type: { type: String, required: true },  // 'flight', 'hotel', etc.
    cost: { type: Number, default: 0 },
    startTime: { type: Date },
    duration: { type: Number, default: 0 },  // Minutes
    planId: { type: String, required: true },
    details: { type: String, default: '' },
    customType: { type: String, default: '' },
    costType: { type: String, enum: ['estimated', 'actual'], default: 'estimated' },
    endTime: { type: Date },  // Fixed: Optional (no required)
    eventNum: { type: Number, default: 0, min: 0 },  // Added: Optional order number within plan for drafts (0 for dated)
    status: { type: String, enum: ['draft', 'complete'], default: 'draft' },  // Added: Draft/complete for incomplete itineraries
    missingFields: [{ type: String }],  // Array of missing field names (e.g., ['flightNumber'])
    subEvents: [subEventSchema],  // Nested array for composite
    extras: { type: mongoose.Schema.Types.Mixed },  // Dynamic user fields
    ownerId: { type: String, required: true },
  }, { timestamps: true });  // Auto createdAt/updatedAt

// Pre-save hook for type-specific validation
eventSchema.pre('save', function (next) {
  const e = this;
  if (e.nastatus === 'draft') {
    return next();  // Skip validation for drafts
  }
  
  /* for now, all validation is to be done at front end.
  // possibly additional validation at backend if status != 'draft'
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
      //if (!e.roomNumber) validationError = 'Room number required'; // Room number not assigned until check in,
      if (!e.checkInDate) validationError = 'Check-in date required';
      break;
    // Add for other types (activity, meal, etc.)
    default:
      // Basic validation
      if (!e.title) validationError = 'Title required';
  }
  if (validationError) return next(new Error(validationError)); */
  next();
});

// Export the model
module.exports = mongoose.model('Event', eventSchema);