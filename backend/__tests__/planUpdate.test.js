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
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

async function acceptRole(ownerToken, memberToken, planId, email, role) {
  const inviteRes = await request(app)
    .post(`/api/plans/${planId}/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role });
  expect(inviteRes.status).toBe(201);
  const acceptRes = await request(app)
    .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
    .set('Authorization', `Bearer ${memberToken}`)
    .send({ status: 'accepted' });
  expect(acceptRes.status).toBe(200);
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
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('owner plan update', () => {
  test('the owner can edit plan details without changing type or owner', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);

    const updated = await request(app)
      .put(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Lyon',
        destination: 'Lyon',
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-08T00:00:00.000Z',
        timeZone: 'Europe/Paris',
        budget: 2400,
        type: 'plan',
        ownerId: 'someone-else',
      });
    expect(updated.status).toBe(200);
    expect(updated.body.plan.name).toBe('Lyon');
    expect(updated.body.plan.destination).toBe('Lyon');
    expect(updated.body.plan.timeZone).toBe('Europe/Paris');
    expect(updated.body.plan.budget).toBe(2400);
    expect(updated.body.plan.type).toBe('trip');
    expect(updated.body.plan.ownerId).toBe(ada.userId);

    const stored = await Plan.findById(planId);
    expect(stored.name).toBe('Lyon');
    expect(stored.destination).toBe('Lyon');
    expect(stored.timeZone).toBe('Europe/Paris');
    expect(stored.budget).toBe(2400);
    expect(stored.startDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(stored.endDate.toISOString()).toBe('2026-07-08T00:00:00.000Z');
    expect(stored.type).toBe('trip');
    expect(stored.ownerId).toBe(ada.userId);
  });

  test('a collaborator can edit name, destination, budget, and time zone', async () => {
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
    await acceptRole(ada.token, grace.token, planId, 'grace@example.com', 'Collaborator');

    const updated = await request(app)
      .put(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({
        name: 'Rome',
        destination: 'Rome',
        budget: 80.5,
        timeZone: 'Europe/Rome',
        ownerId: grace.userId,
        type: 'plan',
      });
    expect(updated.status).toBe(200);
    expect(updated.body.plan.name).toBe('Rome');
    expect(updated.body.plan.destination).toBe('Rome');
    expect(updated.body.plan.budget).toBe(80.5);
    expect(updated.body.plan.timeZone).toBe('Europe/Rome');
    expect(updated.body.plan.ownerId).toBe(ada.userId);
    expect(updated.body.plan.type).toBe('trip');

    const stored = await Plan.findById(planId);
    expect(stored.name).toBe('Rome');
    expect(stored.destination).toBe('Rome');
    expect(stored.budget).toBe(80.5);
    expect(stored.timeZone).toBe('Europe/Rome');
    expect(stored.ownerId).toBe(ada.userId);
  });

  test('a guest cannot edit the plan', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, alan.token, planId, 'alan@example.com', 'Guest');

    const denied = await request(app)
      .put(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ name: 'Taken' });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only Owner or Collaborator can edit a plan');
    expect((await Plan.findById(planId)).name).toBe('Paris');
  });

  test('an empty name is 400 and a bad budget or time zone is 400', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);

    const blank = await request(app)
      .put(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ name: '   ' });
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe('Name is required');

    const budget = await request(app)
      .put(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ budget: '12' });
    expect(budget.status).toBe(400);
    expect(budget.body.message).toBe('Budget must be a number');

    const zone = await request(app)
      .put(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ timeZone: 'Not a zone' });
    expect(zone.status).toBe(400);
    expect(zone.body.message).toBe('Time zone must be an IANA name');

    const stored = await Plan.findById(planId);
    expect(stored.name).toBe('Paris');
    expect(stored.budget).toBe(0);
    expect(stored.timeZone).toBe('UTC');
  });

  test('an unknown plan is 404', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const missing = await request(app)
      .put('/api/plans/missing-plan')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ name: 'Lyon' });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Plan not found');
  });

  test('edit without a token is 401', async () => {
    const missing = await request(app)
      .put('/api/plans/missing-plan')
      .send({ name: 'Lyon' });
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');
  });
});
