const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const activityRevisionSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  eventId: { type: String, required: true },
  planId: { type: String, required: true },
  userId: { type: String, required: true },
  action: { type: String, enum: ['create', 'update', 'delete'], required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  // Top-level so snapshot stays the activity document. True only for delete.
  deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'activityrevisions',
  versionKey: false,
});

activityRevisionSchema.index({ eventId: 1, createdAt: -1 });

module.exports = mongoose.models.ActivityRevision || mongoose.model('ActivityRevision', activityRevisionSchema);
