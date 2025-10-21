const request = require('supertest');  // For API calls
const app = require('../server');  // Your Express app
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Trip = require('../models/Trip');
const TripUser = require('../models/TripUser');

// Before all tests: Connect to test DB (use a separate one in .env for safety)
beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI_TEST || process.env.MONGODB_URI);  // Add MONGODB_URI_TEST in .env for isolated tests
});

// After all: Clean up
afterAll(async () => {
  await mongoose.connection.close();
});

// Before each test: Clear data to isolate
beforeEach(async () => {
  await Trip.deleteMany({});
  await TripUser.deleteMany({});
  await User.deleteMany({});  // Reset users too
});

describe('Trips API', () => {
  let testUser;
  let token;

  beforeEach(async () => {
    // Create test user
    testUser = new User({
      _id: uuidv4(),
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phoneNumber: '+1234567890',
      notificationPreferences: { email: true, sms: false }
    });
    await testUser.save();

    // Login to get token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com' });
    token = loginRes.body.token;
  });

  test('POST /api/trips creates a trip', async () => {
    const newTrip = {
      name: 'Test Trip',
      destination: 'Test City',
      startDate: '2025-10-10',
      endDate: '2025-10-15',
      timeZone: 'America/New_York',
      budget: 1000
    };

    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send(newTrip)
      .expect(201);  // Expect status 201

    expect(res.body.trip).toHaveProperty('name', 'Test Trip');
    expect(res.body.trip.ownerId).toBe(testUser._id.toString());  // Assigned to creator

    // Verify in DB
    const savedTrip = await Trip.findById(res.body.trip._id);
    expect(savedTrip).toBeTruthy();
  });

  test('GET /api/trips/:tripId/users lists users', async () => {
    // First, create a trip
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'List Test Trip',
        destination: 'Test City',
        startDate: '2025-10-10',
        endDate: '2025-10-15',
        timeZone: 'America/New_York'
      });

    const tripId = tripRes.body.trip._id;

    const res = await request(app)
      .get(`/api/trips/${tripId}/users`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.users).toHaveLength(1);  // Only creator
    expect(res.body.users[0].role).toBe('VibeCoordinator');
    expect(res.body.grouped.VibeCoordinator).toHaveLength(1);  // Grouped check
  });
});