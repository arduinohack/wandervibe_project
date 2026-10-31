const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');

jest.setTimeout(30000);

let mongo;

async function registerAndLogin(email, firstName = 'Ada') {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({
      firstName,
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

function warningsOf(body) {
  return body && Array.isArray(body.warnings) ? body.warnings : null;
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

describe('GET /api/plans/:planId/warnings', () => {
  test('an overlapping pair warns both activities and a separated pair does not', async () => {
    const token = await registerAndLogin('ada-warn-overlap@example.com');
    const planId = await createPlan(token);
    const later = await createActivity(token, planId, {
      name: 'Museum visit',
      startTime: '2030-06-01T11:00:00.000Z',
      endTime: '2030-06-01T13:00:00.000Z',
    });
    const earlier = await createActivity(token, planId, {
      name: 'Lunch',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });
    await createActivity(token, planId, { name: 'Note' });

    const overlapping = await request(app)
      .get(`/api/plans/${planId}/warnings`)
      .set('Authorization', `Bearer ${token}`);

    expect(overlapping.status).toBe(200);
    const warnings = warningsOf(overlapping.body);
    expect(warnings).toEqual([
      {
        type: 'overlap',
        activityId: String(earlier._id),
        otherActivityId: String(later._id),
        message: 'Overlaps with Museum visit',
        severity: 'warning',
      },
      {
        type: 'overlap',
        activityId: String(later._id),
        otherActivityId: String(earlier._id),
        message: 'Overlaps with Lunch',
        severity: 'warning',
      },
    ]);

    const quietId = await createPlan(token);
    await createActivity(token, quietId, {
      name: 'Morning',
      startTime: '2030-06-02T10:00:00.000Z',
      endTime: '2030-06-02T12:00:00.000Z',
    });
    await createActivity(token, quietId, {
      name: 'Afternoon',
      startTime: '2030-06-02T12:00:00.000Z',
      endTime: '2030-06-02T14:00:00.000Z',
    });
    const quiet = await request(app)
      .get(`/api/plans/${quietId}/warnings`)
      .set('Authorization', `Bearer ${token}`);
    expect(quiet.status).toBe(200);
    expect(quiet.body).toEqual({ warnings: [] });
  });

  test('a Place ID pair with less than 30 minutes warns, and 30 minutes does not', async () => {
    const token = await registerAndLogin('ada-warn-gap@example.com');
    const planId = await createPlan(token);
    const museum = await createActivity(token, planId, {
      name: 'Museum',
      googlePlaceId: 'place-museum',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T11:00:00.000Z',
    });
    const dinner = await createActivity(token, planId, {
      name: 'Dinner',
      googlePlaceId: 'place-dinner',
      startTime: '2030-06-01T11:15:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });
    await createActivity(token, planId, {
      name: 'Gallery',
      googlePlaceId: 'place-gallery',
      startTime: '2030-06-01T12:30:00.000Z',
      endTime: '2030-06-01T13:30:00.000Z',
    });
    await createActivity(token, planId, {
      name: 'Walk',
      startTime: '2030-06-01T11:05:00.000Z',
      endTime: '2030-06-01T11:10:00.000Z',
    });

    const found = await request(app)
      .get(`/api/plans/${planId}/warnings`)
      .set('Authorization', `Bearer ${token}`);

    expect(found.status).toBe(200);
    expect(found.body.warnings).toEqual([
      {
        type: 'tight_connection',
        activityId: String(museum._id),
        otherActivityId: String(dinner._id),
        message: 'Only 15 min before Dinner — may be tight',
        severity: 'warning',
      },
      {
        type: 'tight_connection',
        activityId: String(dinner._id),
        otherActivityId: String(museum._id),
        message: 'Only 15 min after Museum — may be tight',
        severity: 'warning',
      },
    ]);
  });

  test('a guest can read warnings and a non-member cannot', async () => {
    const owner = await registerAndLogin('ada-warn-guest@example.com');
    const planId = await createPlan(owner);
    await createActivity(owner, planId, {
      name: 'Lunch',
      startTime: '2030-06-01T10:00:00.000Z',
      endTime: '2030-06-01T12:00:00.000Z',
    });
    await createActivity(owner, planId, {
      name: 'Museum visit',
      startTime: '2030-06-01T11:00:00.000Z',
      endTime: '2030-06-01T13:00:00.000Z',
    });
    const guest = await registerAndLogin('gus-warn@example.com', 'Gus');
    await acceptGuest(owner, guest, planId, 'gus-warn@example.com');
    const stranger = await registerAndLogin('alan-warn@example.com', 'Alan');

    const seen = await request(app)
      .get(`/api/plans/${planId}/warnings`)
      .set('Authorization', `Bearer ${guest}`);
    expect(seen.status).toBe(200);
    expect(seen.body.warnings).toHaveLength(2);
    expect(seen.body.warnings.every((row) => row.type === 'overlap')).toBe(true);

    const denied = await request(app)
      .get(`/api/plans/${planId}/warnings`)
      .set('Authorization', `Bearer ${stranger}`);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Not authorized to read plan');
  });
});
