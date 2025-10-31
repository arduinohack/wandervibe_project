const mongoose = require('mongoose');
const Schema = mongoose.Schema;  // Added: Extract Schema for types like ObjectId
const { v4: uuidv4 } = require('uuid');

const planSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  type: { type: String, enum: ['trip', 'plan'], required: true },  // NEW: Unified type
  name: { type: String, required: true },
  destination: { type: String, required: function() { return this.type === 'trip'; } },  // Conditional
  startDate: { type: Date, required: false },
  endDate: { type: Date, required: false },
  autoCalculateStartDate: { type: Boolean, default: false },  // NEW: Opt-in for auto from earliest event
  autoCalculateEndDate: { type: Boolean, default: false },  // NEW: Opt-in for auto from latest event
  location: { type: String, required: function() { return this.type === 'plan'; } },  // Venue for events
  budget: { type: Number, default: 0 },
  planningState: { type: String, enum: ['initial', 'reviewing', 'complete'], default: 'initial' },
  timeZone: { type: String, required: false },
  ownerId: { type: String, ref: 'User', required: true },
  participants: [{ type: Schema.Types.ObjectId, ref: 'PlanUser', }],
  activityIds: [{ type: String, ref: 'Event' }]  // NEW: For eventPlan activities
}, { timestamps: true });

planSchema.index({ name: 'text', destination: 'text' });
planSchema.index({ ownerId: 1 });

module.exports = mongoose.model('Plan', planSchema);