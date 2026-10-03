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

  test('a hotel is saved in America/New_York', async () => {
    const token = await registerAndLogin('hotel-zone@example.com');
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'trip',
        name: 'New York',
        destination: 'New York',
        timeZone: 'America/New_York',
      });
    expect(planRes.status).toBe(201);
    const planId = planRes.body.plan._id;

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Inn',
        type: 'hotel',
        planId,
        startTime: '2026-07-04T22:00:00.000Z',
        endTime: '2026-07-05T16:00:00.000Z',
      });

    expect(created.status).toBe(201);
    expect(created.body.type).toBe('hotel');
    expect(created.body.timeZone).toBe('America/New_York');
    expect(created.body.originTimeZone || '').toBe('');
    expect(created.body.destinationTimeZone || '').toBe('');
  });

  test('a PUT that omits start and end leaves the stored times', async () => {
    const token = await registerAndLogin('keep-times@example.com');
    const planId = await createPlan(token);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Inn',
        type: 'hotel',
        planId,
        timeZone: 'America/New_York',
        startTime: '2026-07-04T22:00:00.000Z',
        endTime: '2026-07-05T16:00:00.000Z',
      });
    expect(created.status).toBe(201);

    const later = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: '2026-07-05T23:00:00.000Z',
        endTime: '2026-07-06T01:00:00.000Z',
      });
    expect(later.status).toBe(201);

    const updated = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed inn' });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Renamed inn');
    expect(updated.body.timeZone).toBe('America/New_York');
    expect(iso(updated.body.startTime)).toBe('2026-07-04T22:00:00.000Z');
    expect(iso(updated.body.endTime)).toBe('2026-07-05T16:00:00.000Z');

    const moved = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ endTime: '2026-07-05T18:00:00.000Z' });
    expect(moved.status).toBe(200);
    expect(iso(moved.body.endTime)).toBe('2026-07-05T18:00:00.000Z');

    const storedLater = await Event.findById(later.body._id);
    expect(iso(storedLater.startTime)).toBe('2026-07-05T23:00:00.000Z');
    expect(iso(storedLater.endTime)).toBe('2026-07-06T01:00:00.000Z');
  });
});
