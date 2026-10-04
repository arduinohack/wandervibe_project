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
    expect(created.body.startTimeZone).toBe('America/New_York');
    expect(created.body.endTimeZone).toBe('America/New_York');
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

  test('an end zone that differs from the start zone stores the UTC gap', async () => {
    const token = await registerAndLogin('split-zone@example.com');
    const planId = await createPlan(token);

    // 18:00 EDT to 08:00 CEST is 8 hours of UTC, not a 14-hour wall subtraction.
    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'AA 100',
        type: 'flight',
        planId,
        startTime: '2026-07-04T22:00:00.000Z',
        endTime: '2026-07-05T06:00:00.000Z',
        startTimeZone: 'America/New_York',
        endTimeZone: 'Europe/Paris',
      });

    expect(created.status).toBe(201);
    expect(created.body.startTimeZone).toBe('America/New_York');
    expect(created.body.endTimeZone).toBe('Europe/Paris');
    expect(created.body.timeZone).toBe('America/New_York');
    expect(iso(created.body.startTime)).toBe('2026-07-04T22:00:00.000Z');
    expect(iso(created.body.endTime)).toBe('2026-07-05T06:00:00.000Z');
    expect(created.body.durationMinutes).toBe(480);

    const kept = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'AA 200' });
    expect(kept.status).toBe(200);
    expect(kept.body.startTimeZone).toBe('America/New_York');
    expect(kept.body.endTimeZone).toBe('Europe/Paris');
    expect(kept.body.durationMinutes).toBe(480);

    const followed = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Regional',
        type: 'train',
        planId,
        startTime: '2026-07-06T12:00:00.000Z',
        endTime: '2026-07-06T14:00:00.000Z',
        startTimeZone: 'America/Chicago',
      });
    expect(followed.status).toBe(201);
    expect(followed.body.startTimeZone).toBe('America/Chicago');
    expect(followed.body.endTimeZone).toBe('America/Chicago');
    expect(followed.body.durationMinutes).toBe(120);

    const legacy = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'AA 300',
        type: 'flight',
        planId,
        startTime: '2026-07-07T15:00:00.000Z',
        endTime: '2026-07-07T21:00:00.000Z',
        originTimeZone: 'America/New_York',
        destinationTimeZone: 'Europe/Paris',
      });
    expect(legacy.status).toBe(201);
    expect(legacy.body.startTimeZone).toBe('America/New_York');
    expect(legacy.body.endTimeZone).toBe('Europe/Paris');
    expect(legacy.body.durationMinutes).toBe(360);
  });

  test('a cleared start is stored as null and a later start uses the previous end', async () => {
    const token = await registerAndLogin('clear-start@example.com');
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
        startTime: '2026-07-01T13:00:00.000Z',
        endTime: '2026-07-01T14:00:00.000Z',
      });
    expect(second.status).toBe(201);

    const chained = await request(app)
      .put(`/api/activities/${second.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startTime: null });
    expect(chained.status).toBe(200);
    expect(iso(chained.body.startTime)).toBe('2026-07-01T11:00:00.000Z');
    expect(iso(chained.body.endTime)).toBe('2026-07-01T14:00:00.000Z');

    const cleared = await request(app)
      .put(`/api/activities/${first.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startTime: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.startTime ?? null).toBeNull();
    expect(iso(cleared.body.endTime)).toBe('2026-07-01T11:00:00.000Z');
    const storedFirst = await Event.findById(first.body._id).lean();
    expect(storedFirst.startTime ?? null).toBeNull();

    const clearedEnd = await request(app)
      .put(`/api/activities/${second.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ endTime: null, durationMinutes: null });
    expect(clearedEnd.status).toBe(200);
    expect(clearedEnd.body.endTime ?? null).toBeNull();
    expect(clearedEnd.body.durationMinutes ?? null).toBeNull();
    expect(iso(clearedEnd.body.startTime)).toBe('2026-07-01T11:00:00.000Z');

    const kept = await request(app)
      .put(`/api/activities/${second.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Supper' });
    expect(kept.status).toBe(200);
    expect(kept.body.endTime ?? null).toBeNull();
    expect(iso(kept.body.startTime)).toBe('2026-07-01T11:00:00.000Z');

    const walk = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Walk',
        type: 'tour',
        planId,
        startTime: '2026-07-01T16:00:00.000Z',
      });
    expect(walk.status).toBe(201);

    const dinner = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: '2026-07-01T18:00:00.000Z',
        endTime: '2026-07-01T19:00:00.000Z',
      });
    expect(dinner.status).toBe(201);

    const fromStart = await request(app)
      .put(`/api/activities/${dinner.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startTime: null });
    expect(fromStart.status).toBe(200);
    expect(iso(fromStart.body.startTime)).toBe('2026-07-01T16:00:00.000Z');
  });

  test('an insert below stores the target end as the new start', async () => {
    const token = await registerAndLogin('insert-below@example.com');
    const planId = await createPlan(token);

    const flight = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Flight',
        type: 'dining',
        planId,
        startTime: '2026-07-03T09:00:00.000Z',
        endTime: '2026-07-03T11:00:00.000Z',
      });
    expect(flight.status).toBe(201);

    const dinner = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: '2026-07-03T08:00:00.000Z',
        endTime: '2026-07-03T08:30:00.000Z',
      });
    expect(dinner.status).toBe(201);

    const lunch = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lunch',
        type: 'dining',
        planId,
        insertAfter: flight.body._id,
        durationMinutes: 30,
      });

    expect(lunch.status).toBe(201);
    expect(iso(lunch.body.startTime)).toBe('2026-07-03T11:00:00.000Z');
    expect(iso(lunch.body.endTime)).toBe('2026-07-03T11:30:00.000Z');
    expect(lunch.body.durationMinutes).toBe(30);

    const itinerary = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${token}`);
    expect(itinerary.status).toBe(200);
    expect(itinerary.body.events.map((event) => event.name)).toEqual([
      'Flight',
      'Lunch',
      'Dinner',
    ]);
    expect(iso(itinerary.body.events[2].startTime)).toBe('2026-07-03T08:00:00.000Z');
    expect(iso(itinerary.body.events[0].endTime)).toBe('2026-07-03T11:00:00.000Z');
  });
});
