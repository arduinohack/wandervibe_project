const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const supportLogSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  createdAt: { type: Date, default: Date.now },
  level: { type: String, enum: ['info', 'warn', 'error'], required: true },
  event: { type: String, required: true },
  actorUserId: { type: String },
  planId: { type: String },
  eventId: { type: String },
  invitationId: { type: String },
  message: { type: String, default: '' },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
  collection: 'supportlogs',
  versionKey: false,
});

supportLogSchema.index({ createdAt: -1 });
supportLogSchema.index({ event: 1, createdAt: -1 });
supportLogSchema.index({ actorUserId: 1, createdAt: -1 });

module.exports = mongoose.models.SupportLog || mongoose.model('SupportLog', supportLogSchema);
