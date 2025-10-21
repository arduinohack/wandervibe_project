const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');  // For password hashing
const User = require('./models/User.js');  // Your User model from Phase 2

// Connect to MongoDB (use your .env MONGO_URI)
mongoose.connect('mongodb+srv://wkenallen:Kallen0103@wandervibe0.yi4peah.mongodb.net/?retryWrites=true&w=majority&appName=WanderVibe0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB');
  return User.findOne({ email: 'test@example.com' });
}).then(async (existingUser) => {
  if (existingUser) {
    console.log('Test user already exists');
    process.exit(0);
  }
  // Create new user
  const hashedPassword = await bcrypt.hash('testpass', 12);  // Hash password (12 rounds for security)
  const testUser = new User({
    _id: new mongoose.Types.ObjectId(),  // Generate ID
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    phoneNumber: '+1-555-0000',
    address: {
      street: '123 Test St',
      city: 'Test City',
      state: 'TC',
      country: 'USA',
      postalCode: '12345',
    },
    notificationPreferences: {
      email: true,
      sms: false,
    },
    createdAt: new Date(),
  });
  testUser.password = hashedPassword;  // Set hashed password (add password field to User schema if missing)
  await testUser.save();
  console.log('Test user added: test@example.com / testpass');
  mongoose.connection.close();
}).catch((err) => {
  console.error('Error adding test user:', err);
  mongoose.connection.close();
});