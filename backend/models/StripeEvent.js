const mongoose = require('mongoose');

// One row per Stripe event id. A retry of the same event hits the unique _id.
const stripeEventSchema = new mongoose.Schema({
  _id: { type: String },
  sessionId: { type: String, default: '' },
  userId: { type: String, default: '' },
  credits: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'stripeevents',
  versionKey: false,
});

module.exports = mongoose.models.StripeEvent
  || mongoose.model('StripeEvent', stripeEventSchema);
