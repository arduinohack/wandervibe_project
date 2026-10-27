jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');
const { MATRIX_URL } = require('../utils/itineraryWarnings');

jest.setTimeout(30000);

let mongo;
const previousKey = process.env.GOOGLE_MAPS_API_KEY;
const PLACE_A = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const PLACE_B = 'ChIJplaceB000000000000000';

function matrixOk(seconds) {
  return {
    status: 200,
    data: {
      status: 'OK',
      rows: [{ elements: [{ status: 'OK', duration: { value: seconds } }] }],
    },
  };
}

async function registerAndLogin(email) {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email,
      password: 'password1',
    });
  await clearRegisterInvite(email);
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password1' });
  expect(loginRes.status).toBe(200);
  return loginRes.body.token;
}

async function createPlan(token) {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'trip',
      name: 'Paris trip',
      destination: 'Paris',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

async function createActivity(token, planId, fields) {
  const res = await request(app)
    .post('/api/activities')
    .set('Authorization', `Bearer ${token}`)
    .send({ type: 'dining', planId, ...fields });
  expect(res.status).toBe(201);
  return res.body;
}

async function acceptGuest(ownerToken, guestToken, planId, email) {
  const inviteRes = await request(app)
    .post(`/api/plans/${planId}/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role: 'Guest' });
  expect(inviteRes.status).toBe(201);
  const acceptRes = await request(app)
    .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ status: 'accepted' });
  expect(acceptRes.status).toBe(200);
}

function named(events, name) {
  return events.find((event) => event.name === name);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  axios.get.mockReset();
  axios.post.mockReset();
  if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = previousKey;
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    PlanUser.deleteMany({}),
    Invitation.deleteMany({}),
    Event.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = previousKey;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('GET /api/plans/:planId/itinerary warnings', () => {
  test('overlapping times mark both activities and do not save the flags', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const token = await registerAndLogin('ada-overlap@example.com');
    const planId = await createPlan(token);
    await createActivity(token, planId, {
      name: 'Later lunch',
      startTime: '2030-06-01T11:00:00.000Z',
      endTime: '2030-06-01T13:00:00.000Z',
    });
    const earlier = await createActivity(token, planId, {
      name: 'Earlier lunch',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(named(res.body.events, 'Earlier lunch').overlap).toBe(true);
    expect(named(res.body.events, 'Later lunch').overlap).toBe(true);
    expect(named(res.body.events, 'Earlier lunch').tightTravel).toBe(false);
    expect(named(res.body.events, 'Earlier lunch').travelMinutes).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
    const saved = await Event.findById(earlier._id).lean();
    expect(saved.overlap).toBeUndefined();
    expect(saved.tightTravel).toBeUndefined();
    expect(saved.name).toBe('Earlier lunch');
  });

  test('a short gap with Place IDs marks the later activity', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    axios.get.mockResolvedValue(matrixOk(40 * 60));
    const token = await registerAndLogin('ada-travel@example.com');
    const planId = await createPlan(token);
    await createActivity(token, planId, {
      name: 'Museum',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T11:00:00.000Z',
      googlePlaceId: PLACE_A,
    });
    await createActivity(token, planId, {
      name: 'Lunch',
      startTime: '2030-06-01T11:20:00.000Z',
      endTime: '2030-06-01T12:20:00.000Z',
      googlePlaceId: PLACE_B,
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const museum = named(res.body.events, 'Museum');
    const lunch = named(res.body.events, 'Lunch');
    expect(museum.overlap).toBe(false);
    expect(museum.tightTravel).toBe(false);
    expect(museum.travelMinutes).toBeNull();
    expect(lunch.overlap).toBe(false);
    expect(lunch.tightTravel).toBe(true);
    expect(lunch.travelMinutes).toBe(40);
    const call = axios.get.mock.calls.find((item) => item[0] === MATRIX_URL);
    expect(call).toBeTruthy();
    expect(call[1].params.origins).toBe(`place_id:${PLACE_A}`);
    expect(call[1].params.destinations).toBe(`place_id:${PLACE_B}`);
    expect(call[1].params.mode).toBe('driving');
    expect(JSON.stringify(res.body)).not.toContain('test-key');
    expect(axios.get.mock.calls.filter((item) => item[0] === MATRIX_URL)).toHaveLength(1);
  });

  test('location text is enough for a travel check', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    axios.get.mockResolvedValue(matrixOk(30 * 60));
    const token = await registerAndLogin('ada-loc@example.com');
    const planId = await createPlan(token);
    await createActivity(token, planId, {
      name: 'Cafe',
      location: 'Cafe Paris',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T11:00:00.000Z',
    });
    await createActivity(token, planId, {
      name: 'Park',
      location: 'Luxembourg Gardens',
      startTime: '2030-06-01T11:10:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(named(res.body.events, 'Park').tightTravel).toBe(true);
    expect(named(res.body.events, 'Park').travelMinutes).toBe(30);
    const call = axios.get.mock.calls.find((item) => item[0] === MATRIX_URL);
    expect(call[1].params.origins).toBe('Cafe Paris');
    expect(call[1].params.destinations).toBe('Luxembourg Gardens');
  });

  test('only consecutive pairs are checked', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    axios.get.mockResolvedValue(matrixOk(15 * 60));
    const token = await registerAndLogin('ada-pairs@example.com');
    const planId = await createPlan(token);
    await createActivity(token, planId, {
      name: 'One',
      googlePlaceId: 'place-1',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T11:00:00.000Z',
    });
    await createActivity(token, planId, {
      name: 'Two',
      googlePlaceId: 'place-2',
      startTime: '2030-06-01T12:00:00.000Z',
      endTime: '2030-06-01T13:00:00.000Z',
    });
    await createActivity(token, planId, {
      name: 'Three',
      googlePlaceId: 'place-3',
      startTime: '2030-06-01T14:00:00.000Z',
      endTime: '2030-06-01T15:00:00.000Z',
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(axios.get.mock.calls.filter((item) => item[0] === MATRIX_URL)).toHaveLength(2);
    expect(named(res.body.events, 'One').tightTravel).toBe(false);
    expect(named(res.body.events, 'Two').tightTravel).toBe(false);
    expect(named(res.body.events, 'Three').tightTravel).toBe(false);
  });

  test('a missing Maps key still returns overlap warnings', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const token = await registerAndLogin('ada-nokey@example.com');
    const planId = await createPlan(token);
    await createActivity(token, planId, {
      name: 'Museum',
      googlePlaceId: PLACE_A,
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });
    await createActivity(token, planId, {
      name: 'Lunch',
      googlePlaceId: PLACE_B,
      startTime: '2030-06-01T11:00:00.000Z',
      endTime: '2030-06-01T13:00:00.000Z',
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(named(res.body.events, 'Museum').overlap).toBe(true);
    expect(named(res.body.events, 'Lunch').overlap).toBe(true);
    expect(named(res.body.events, 'Lunch').tightTravel).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a failed travel lookup still returns the itinerary and the overlap', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    axios.get.mockRejectedValue(new Error('network down'));
    const token = await registerAndLogin('ada-fail@example.com');
    const planId = await createPlan(token);
    await createActivity(token, planId, {
      name: 'Museum',
      googlePlaceId: PLACE_A,
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });
    await createActivity(token, planId, {
      name: 'Lunch',
      googlePlaceId: PLACE_B,
      startTime: '2030-06-01T11:00:00.000Z',
      endTime: '2030-06-01T13:00:00.000Z',
    });

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(named(res.body.events, 'Museum').overlap).toBe(true);
    expect(named(res.body.events, 'Lunch').tightTravel).toBe(false);
    expect(named(res.body.events, 'Lunch').travelMinutes).toBeNull();
  });

  test('a guest can read the same warnings', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const owner = await registerAndLogin('ada-guest-warn@example.com');
    const planId = await createPlan(owner);
    await createActivity(owner, planId, {
      name: 'Earlier lunch',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });
    await createActivity(owner, planId, {
      name: 'Later lunch',
      startTime: '2030-06-01T11:00:00.000Z',
      endTime: '2030-06-01T13:00:00.000Z',
    });
    await allowRegister('gus-warn@example.com');
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Gus',
        lastName: 'Guest',
        email: 'gus-warn@example.com',
        password: 'password1',
      });
    await clearRegisterInvite('gus-warn@example.com');
    expect(registerRes.status).toBe(201);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gus-warn@example.com', password: 'password1' });
    expect(loginRes.status).toBe(200);
    await acceptGuest(owner, loginRes.body.token, planId, 'gus-warn@example.com');

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${loginRes.body.token}`);

    expect(res.status).toBe(200);
    expect(named(res.body.events, 'Earlier lunch').overlap).toBe(true);
    expect(named(res.body.events, 'Later lunch').overlap).toBe(true);
  });
});
