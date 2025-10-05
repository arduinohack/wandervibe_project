const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  street: String,
  city: String,
  state: String,
  country: String,
  postalCode: String
});

const notificationPreferencesSchema = new mongoose.Schema({
  email: { type: Boolean, default: true },
  sms: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // UUID
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String },
  address: addressSchema,
  notificationPreferences: notificationPreferencesSchema
}, { timestamps: true });

// Indexes
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

module.exports = mongoose.model('User', userSchema);