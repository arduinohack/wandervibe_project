const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');  // For password hashing
const User = require('./models/users');  // Your User model

// Connect to MongoDB (use your .env MONGO_URI)
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/wandervibe', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB for seeding');
  return seedUsers();  // Run seeding
}).then(() => {
  console.log('Seeding complete');
  mongoose.connection.close();
}).catch((err) => {
  console.error('Seeding error:', err);
  mongoose.connection.close();
});

async function seedUsers() {
  const usersToSeed = [
    {
      email: 'test@example.com',
      password: 'testpass',
      firstName: 'Test',
      lastName: 'User',
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
      role: 'VibeCoordinator',  // Default for test user
    },
    {
      email: 'jane@example.com',
      password: 'janepass',
      firstName: 'Jane',
      lastName: 'Doe',
      phoneNumber: '+1-555-0001',
      address: {
        street: '456 Jane Ave',
        city: 'Sample Town',
        state: 'ST',
        country: 'USA',
        postalCode: '67890',
      },
      notificationPreferences: {
        email: true,
        sms: true,
      },
      role: 'VibePlanner',  // Assigned role for Jane
    },
  ];

  for (const userData of usersToSeed) {
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      console.log(`User ${userData.email} already exists—skipping`);
      continue;
    }

    const hashedPassword = await bcrypt.hash(userData.password, 12);  // Hash password (12 rounds for security)
    const newUser = new User({
      _id: new mongoose.Types.ObjectId(),  // Generate ID
      firstName: userData.firstName,
      lastName: userData.lastName,
      email: userData.email,
      phoneNumber: userData.phoneNumber,
      address: userData.address,
      notificationPreferences: userData.notificationPreferences,
      password: hashedPassword,  // Set hashed password
      createdAt: new Date(),
    });

    await newUser.save();
    console.log(`Added test user: ${userData.email} / ${userData.password}`);
  }
}