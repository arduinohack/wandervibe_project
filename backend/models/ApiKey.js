const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const apiKeySchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  userId: { type: String, required: true },
  name: { type: String, required: true },
  keyHash: { type: String, required: true },
  prefix: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date },
  revokedAt: { type: Date },
}, {
  collection: 'apikeys',
  versionKey: false,
});

apiKeySchema.index({ keyHash: 1 }, { unique: true });
apiKeySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.ApiKey || mongoose.model('ApiKey', apiKeySchema);
