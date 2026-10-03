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
const { Event } = require('../models/Event');

jest.setTimeout(30000);

let mongo;

async function registerAndLogin(email) {
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName: 'Ada', lastName: 'Lovelace', email, password: 'password1' });
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
      name: 'Paris',
      destination: 'Paris',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-10T00:00:00.000Z',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

function iso(value) {
  return new Date(value).toISOString();
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
    Event.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('activity start, end, and duration', () => {
  test('a 90 minute duration sets the end 90 minutes after the start', async () => {
    const token = await registerAndLogin('duration-90@example.com');
    const planId = await createPlan(token);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Walk',
        type: 'tour',
        planId,
        startTime: '2026-07-01T10:00:00.000Z',
        durationMinutes: 90,
      });

    expect(created.status).toBe(201);
    expect(iso(created.body.startTime)).toBe('2026-07-01T10:00:00.000Z');
    expect(iso(created.body.endTime)).toBe('2026-07-01T11:30:00.000Z');
    expect(created.body.durationMinutes).toBe(90);
  });

  test('an end two hours after the start sets duration to 120', async () => {
    const token = await registerAndLogin('duration-120@example.com');
    const planId = await createPlan(token);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lunch',
        type: 'dining',
        planId,
        startTime: '2026-07-02T12:00:00.000Z',
        endTime: '2026-07-02T13:00:00.000Z',
      });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ endTime: '2026-07-02T14:00:00.000Z' });

    expect(updated.status).toBe(200);
    expect(iso(updated.body.startTime)).toBe('2026-07-02T12:00:00.000Z');
    expect(iso(updated.body.endTime)).toBe('2026-07-02T14:00:00.000Z');
    expect(updated.body.durationMinutes).toBe(120);
  });

  test('an empty start on add uses the previous activity end', async () => {
    const token = await registerAndLogin('duration-previous@example.com');
    const planId = await createPlan(token);

    const first = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Museum',
        type: 'tour',
        planId,
        startTime: '2026-07-01T09:00:00.000Z',
        endTime: '2026-07-01T11:00:00.000Z',
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lunch',
        type: 'dining',
        planId,
        startTime: '',
        endTime: '2026-07-01T12:30:00.000Z',
      });

    expect(second.status).toBe(201);
    expect(iso(second.body.startTime)).toBe('2026-07-01T11:00:00.000Z');
    expect(second.body.durationMinutes).toBe(90);
  });
});
