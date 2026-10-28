const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { ALLOWED_MIMES, MAX_BYTES } = require('../utils/attachmentStore');

const attachmentSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  activityId: { type: String, required: true },
  planId: { type: String, required: true },
  uploadedBy: { type: String, required: true },
  filename: { type: String, required: true, maxlength: 180 },
  mimeType: { type: String, enum: ALLOWED_MIMES, required: true },
  size: { type: Number, required: true, min: 1, max: MAX_BYTES },
  storageKey: { type: String, required: true, select: false },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'attachments',
  versionKey: false,
});

attachmentSchema.index({ activityId: 1, createdAt: 1 });
attachmentSchema.index({ planId: 1, createdAt: -1 });

function hideStorageKey(_doc, ret) {
  delete ret.storageKey;
  return ret;
}

attachmentSchema.set('toJSON', { transform: hideStorageKey });
attachmentSchema.set('toObject', { transform: hideStorageKey });

module.exports = mongoose.models.Attachment
  || mongoose.model('Attachment', attachmentSchema);
