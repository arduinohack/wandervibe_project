const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const flightLegSchema = new mongoose.Schema({
  origin: { type: String, default: '' },
  originTimeZone: { type: String, default: '' },
  departure: { type: Date },
  destination: { type: String, default: '' },
  destinationTimeZone: { type: String, default: '' },
  arrival: { type: Date },
  durationMinutes: { type: Number },
}, { _id: false });

// Main Event schema (recursive for sub-events)
const eventSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },  // Auto-generate UUID string (or omit for ObjectId)
  name: { type: String, required: true },
  location: { type: String, default: '' },  // Fixed: Optional with default
  googlePlaceId: {
    type: String,
    set(value) {
      if (value == null) return '';
      return String(value).trim();
    },
  },
  type: { type: String, required: true },  // 'flight', 'hotel', etc.
  cost: { type: Number, default: 0 },
  startTime: { type: Date },
  timeZone: { type: String, default: '' }, // Kept equal to startTimeZone for older readers
  startTimeZone: { type: String, default: '' },
  endTimeZone: { type: String, default: '' },
  originTimeZone: { type: String },
  destinationTimeZone: { type: String },
  duration: { type: Number, default: 0 },  // Minutes
  durationMinutes: { type: Number },
  endTime: { type: Date },  // Fixed: Optional (no required)
  planId: { type: String, required: true },
  details: { type: String, default: '' },
  customType: { type: String, default: '' },
  costType: { type: String, enum: ['estimated', 'actual'], default: 'estimated' },
  eventNum: { type: Number, default: 0, min: 0 },  // Added: Optional order number within plan for drafts (0 for dated)
  status: { type: String, enum: ['draft', 'complete'], default: 'draft' },  // Added: Draft/complete for incomplete itineraries
  missingFields: [{ type: String }],  // Array of missing field names (e.g., ['flightNumber'])
  serviceProvider: { type: String },           // replaces 'airline', trainline
  bookingReference: { type: String }, // replaces any old PNR field
  urlLinks: [
    {
      linkName: { type: String, default: '' },
      linkUrl: { type: String, required: true },
    }
  ],
  subEvents: [this],  // Recursive: array of nested Events
  extras: { type: mongoose.Schema.Types.Mixed },  // Dynamic user fields
  ownerId: { type: String, required: true },

  // Type-specific fields (optional, validated in pre-save)
  gate: { type: String },  // For departure
  baggageClaim: { type: String },  // For arrival
  roomNumber: { type: String },  // For hotel check-in
  origin: { type: String },
  originCountry: { type: String },
  destination: { type: String },
  confirmation: { type: String },
  legs: { type: [flightLegSchema], default: [] },
  // Yes / No / Maybe replaces the thumbs on this activity. Votes live in activityReactions.
  poll: { type: Boolean, default: false },
  // Add more as types evolve (Mongoose ignores unused)
}, { timestamps: true, collection: 'activities' });  // Auto createdAt/updatedAt. Collection name is activities; the model name stays Event.

// Pre-save hook for type-specific validation
eventSchema.pre('save', function (next) {
  const e = this;
  if (e.status === 'draft') {
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
        if (se.subType == 'arrival' && !se.baggageClaim) validationError = 'Arrival baggage claim required';
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

// Virtual 'id' alias for _id (for API consistency)
eventSchema.virtual('id').get(function () {
  return this._id;
});

// Include virtuals in JSON responses
eventSchema.set('toJSON', { virtuals: true });
eventSchema.set('toObject', { virtuals: true });

// Itinerary and activity lists filter by plan and then start time.
eventSchema.index({ planId: 1, startTime: 1 });

// Guard against redefinition
const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);

// Plan schema extends Event via discriminator
const planSchema = new mongoose.Schema({
  budget: { type: Number, default: 0 },
  planningState: { type: String, default: '' },
  planType: { type: String, enum: ['trip', 'plan'], default: 'trip' }, // Kept
});

const Plan = mongoose.models.Plan || Event.discriminator('Plan', planSchema);

module.exports = { Event, Plan };