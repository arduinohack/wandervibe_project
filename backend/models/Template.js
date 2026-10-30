const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const templateSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  ownerId: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  sourcePlanId: { type: String, default: '' },
  type: { type: String, enum: ['trip', 'plan'], required: true },
  destination: { type: String, default: '' },
  location: { type: String, default: '' },
  timeZone: { type: String, default: '' },
  budget: { type: Number, default: 0 },
  hiddenFields: { type: [String], default: [] },
  planningState: {
    type: String,
    enum: ['initial', 'reviewing', 'complete'],
    default: 'initial',
  },
  autoCalculateStartDate: { type: Boolean, default: false },
  autoCalculateEndDate: { type: Boolean, default: false },
  startDate: { type: Date, required: false },
  endDate: { type: Date, required: false },
  // Activity field snapshots. They are not live activity documents.
  activities: { type: mongoose.Schema.Types.Mixed, default: [] },
}, {
  timestamps: true,
  collection: 'templates',
});

templateSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.models.Template || mongoose.model('Template', templateSchema);
