const mongoose = require('mongoose');

// Sub-schema for address (nested object)
const addressSchema = new mongoose.Schema({
  street: String,
  city: String,
  state: String,
  country: String,
  postalCode: String
});

// Sub-schema for notificationPreferences (nested object with defaults)
const notificationPreferencesSchema = new mongoose.Schema({
  email: { type: Boolean, default: true },
  sms: { type: Boolean, default: false }
});

// Main User schema
const userSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // UUID
  firstName: String,
  lastName: String,
  email: { type: String, unique: true },
  phoneNumber: String,
  address: addressSchema,  // Embed sub-schema
  notificationPreferences: notificationPreferencesSchema,  // Embed sub-schema
  role: { type: String, enum: ['VibeCoordinator', 'VibePlanner', 'Wanderer', 'admin'], default: 'VibeCoordinator' },
  password: { type: String, required: true },  // For login (hashed)
  resetToken: String,  // Temporary token for reset
  resetTokenExpiry: Date,  // Expires in 1h
  createdAt: { type: Date, default: Date.now }
});

// Indexes for search (from requirements)
// userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });
// userSchema.set('bufferCommands', false);  // Disable buffering to avoid timeouts
// userSchema.index({ email: 1 })

module.exports = mongoose.model('User', userSchema);