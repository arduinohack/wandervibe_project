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
const { activityDateSpan } = require('../utils/activityDateSpan');

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

async function createPlan(token, { startDate, endDate } = {}) {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'trip',
      name: 'Paris',
      destination: 'Paris',
      startDate: startDate || '2026-08-01T00:00:00.000Z',
      endDate: endDate || '2026-08-10T00:00:00.000Z',
      timeZone: 'America/New_York',
    });
  expect(res.status).toBe(201);
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
    Event.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('activityDateSpan', () => {
  test('no activities are both null and a missing end uses start', () => {
    expect(activityDateSpan([])).toEqual({ earliestStart: null, latestEnd: null });
    const start = new Date('2026-10-05T09:00:00.000Z');
    const span = activityDateSpan([{ startTime: start, endTime: null }]);
    expect(span.earliestStart.toISOString()).toBe(start.toISOString());
    expect(span.latestEnd.toISOString()).toBe(start.toISOString());
  });
});

describe('GET /api/plans activity span', () => {
  test('no activities leaves earliestStart and latestEnd null and keeps stored dates', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const created = await createPlan(ada.token);

    const res = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plans)).toBe(true);
    const plan = res.body.plans.find((row) => row._id === created._id);
    expect(plan).toBeTruthy();
    expect(plan.earliestStart).toBeNull();
    expect(plan.latestEnd).toBeNull();
    expect(new Date(plan.startDate).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(new Date(plan.endDate).toISOString()).toBe('2026-08-10T00:00:00.000Z');
    const stored = await Plan.findById(created._id).lean();
    expect(stored.startDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(stored.endDate.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(stored.earliestStart).toBeUndefined();
    expect(stored.latestEnd).toBeUndefined();
  });

  test('earliest start and latest end come from activities; a missing end uses start', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const created = await createPlan(ada.token);
    const planId = created._id;

    const late = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: '2026-10-07T10:00:00.000Z',
        endTime: '2026-10-07T12:00:00.000Z',
      });
    expect(late.status).toBe(201);

    const open = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Walk',
        type: 'tour',
        planId,
        startTime: '2026-10-05T08:00:00.000Z',
      });
    expect(open.status).toBe(201);

    const last = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Show',
        type: 'attraction',
        planId,
        startTime: '2026-10-06T09:00:00.000Z',
        endTime: '2026-10-09T17:00:00.000Z',
      });
    expect(last.status).toBe(201);

    const res = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(res.status).toBe(200);
    const plan = res.body.plans.find((row) => row._id === planId);
    expect(plan.earliestStart).toBe('2026-10-05T08:00:00.000Z');
    expect(plan.latestEnd).toBe('2026-10-09T17:00:00.000Z');
    const stored = await Plan.findById(planId).lean();
    expect(new Date(plan.startDate).toISOString()).toBe(stored.startDate.toISOString());
    expect(new Date(plan.endDate).toISOString()).toBe(stored.endDate.toISOString());
    expect(stored.earliestStart).toBeUndefined();
    expect(stored.latestEnd).toBeUndefined();
  });
});
