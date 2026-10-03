jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');

jest.setTimeout(30000);

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
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-10T00:00:00.000Z',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

async function setFlags(token, planId, flags) {
  const res = await request(app)
    .put(`/api/plans/${planId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(flags);
  expect(res.status).toBe(200);
  return res.body.plan;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    PlanUser.deleteMany({}),
    Invitation.deleteMany({}),
    Event.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('plan dates follow activities', () => {
  test('an early activity moves the start and a late activity moves the end', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);
    await setFlags(ada.token, planId, {
      autoCalculateStartDate: true,
      autoCalculateEndDate: true,
    });

    const early = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Arrival',
        type: 'tour',
        planId,
        startTime: '2026-07-01T08:00:00.000Z',
      });
    expect(early.status).toBe(201);

    let stored = await Plan.findById(planId);
    expect(stored.startDate.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(stored.endDate.toISOString()).toBe('2026-07-01T08:00:00.000Z');

    const late = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Departure',
        type: 'tour',
        planId,
        startTime: '2026-07-10T09:00:00.000Z',
        endTime: '2026-07-12T18:00:00.000Z',
      });
    expect(late.status).toBe(201);

    stored = await Plan.findById(planId);
    expect(stored.startDate.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(stored.endDate.toISOString()).toBe('2026-07-12T18:00:00.000Z');

    const moved = await request(app)
      .put(`/api/activities/${late.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Departure',
        type: 'tour',
        endTime: '2026-07-20T18:00:00.000Z',
      });
    expect(moved.status).toBe(200);
    stored = await Plan.findById(planId);
    expect(stored.startDate.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(stored.endDate.toISOString()).toBe('2026-07-20T18:00:00.000Z');
  });

  test('a flag left off keeps the stored date', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);
    const saved = await setFlags(ada.token, planId, {
      autoCalculateStartDate: false,
      autoCalculateEndDate: true,
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-10T00:00:00.000Z',
    });
    expect(saved.autoCalculateStartDate).toBe(false);
    expect(saved.autoCalculateEndDate).toBe(true);

    const early = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Arrival',
        type: 'tour',
        planId,
        startTime: '2026-07-01T08:00:00.000Z',
        endTime: '2026-07-01T12:00:00.000Z',
      });
    expect(early.status).toBe(201);

    let stored = await Plan.findById(planId);
    expect(stored.startDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(stored.endDate.toISOString()).toBe('2026-07-01T12:00:00.000Z');

    const removed = await request(app)
      .delete(`/api/activities/${early.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(removed.status).toBe(200);
    stored = await Plan.findById(planId);
    expect(stored.startDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(stored.endDate.toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });
});
