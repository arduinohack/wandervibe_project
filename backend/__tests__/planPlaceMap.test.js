jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/placeMap', () => ({
  fetchPlaceMapPng: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const { Event } = require('../models/Event');
const { fetchPlaceMapPng } = require('../utils/placeMap');

jest.setTimeout(30000);

const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

let mongo;

async function registerAndLogin({ firstName, lastName, email }) {
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName, lastName, email, password: 'password1' });
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password1' });
  expect(loginRes.status).toBe(200);
  return {
    token: loginRes.body.token,
    userId: loginRes.body.user._id,
  };
}

async function createPlan(token) {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'trip',
      name: 'Paris',
      destination: 'Paris',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  fetchPlaceMapPng.mockReset();
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    PlanUser.deleteMany({}),
    Event.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('GET /api/plans/:planId/place-map', () => {
  test('no token is 401', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);

    const res = await request(app)
      .get(`/api/plans/${planId}/place-map`)
      .query({ placeId: PLACE_ID });
    expect(res.status).toBe(401);
    expect(fetchPlaceMapPng).not.toHaveBeenCalled();
  });

  test('missing placeId is 400 and an unknown place on the plan is 404', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);

    const missing = await request(app)
      .get(`/api/plans/${planId}/place-map`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(missing.status).toBe(400);

    const unknown = await request(app)
      .get(`/api/plans/${planId}/place-map`)
      .set('Authorization', `Bearer ${ada.token}`)
      .query({ placeId: PLACE_ID });
    expect(unknown.status).toBe(404);
    expect(fetchPlaceMapPng).not.toHaveBeenCalled();
  });

  test('a member gets a PNG around a Place ID stored on the plan', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);
    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Opera',
        type: 'attraction',
        planId,
        location: 'Sydney Opera House',
        googlePlaceId: PLACE_ID,
      });
    expect(created.status).toBe(201);

    fetchPlaceMapPng.mockResolvedValue({
      status: 200,
      png: PNG,
      contentType: 'image/png',
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/place-map`)
      .set('Authorization', `Bearer ${ada.token}`)
      .query({ placeId: PLACE_ID });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.from(res.body).equals(PNG)).toBe(true);
    expect(fetchPlaceMapPng).toHaveBeenCalledWith(PLACE_ID);
  });

  test('forwards 503 when Google Maps is not configured', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);
    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Opera',
        type: 'attraction',
        planId,
        googlePlaceId: PLACE_ID,
      });
    expect(created.status).toBe(201);

    fetchPlaceMapPng.mockResolvedValue({
      status: 503,
      msg: 'Google Maps is not configured',
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/place-map`)
      .set('Authorization', `Bearer ${ada.token}`)
      .query({ placeId: PLACE_ID });
    expect(res.status).toBe(503);
    expect(res.body.msg).toBe('Google Maps is not configured');
  });

  test('a non-member is 403', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(ada.token);

    const res = await request(app)
      .get(`/api/plans/${planId}/place-map`)
      .set('Authorization', `Bearer ${grace.token}`)
      .query({ placeId: PLACE_ID });
    expect(res.status).toBe(403);
    expect(fetchPlaceMapPng).not.toHaveBeenCalled();
  });
});
