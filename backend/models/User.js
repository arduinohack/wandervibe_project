const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');  // Generate UUID
const bcrypt = require('bcryptjs');

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
  _id: { type: String, default: uuidv4 },  // UUID as string (custom ID)
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

// Pre-save hook for password hashing
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);