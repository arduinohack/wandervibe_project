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
const ApiKey = require('../models/ApiKey');

jest.setTimeout(30000);

const KEYS = '/api/users/me/api-keys';

let mongo;

async function registerAndLogin({ firstName, lastName, email }) {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName, lastName, email, password: 'password1' });
  await clearRegisterInvite(email);
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password1' });
  expect(loginRes.status).toBe(200);
  return {
    token: loginRes.body.token,
    userId: loginRes.body.user._id,
    email,
  };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createPlan(token) {
  const res = await request(app)
    .post('/api/plans')
    .set(bearer(token))
    .send({
      type: 'trip',
      name: 'Paris trip',
      destination: 'Paris',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

async function acceptRole(ownerToken, memberToken, planId, email, role) {
  const inviteRes = await request(app)
    .post(`/api/plans/${planId}/invite`)
    .set(bearer(ownerToken))
    .send({ email, role });
  expect(inviteRes.status).toBe(201);
  const acceptRes = await request(app)
    .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
    .set(bearer(memberToken))
    .send({ status: 'accepted' });
  expect(acceptRes.status).toBe(200);
}

async function createKey(token, name) {
  const res = await request(app)
    .post(KEYS)
    .set(bearer(token))
    .send({ name });
  expect(res.status).toBe(201);
  return res.body;
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
    ApiKey.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('API keys', () => {
  test('create returns the secret once and stores only a hash', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-key@example.com',
    });
    const created = await createKey(ada.token, 'Trip script');

    expect(created.key.startsWith('wv_live_')).toBe(true);
    expect(created.key.length).toBeGreaterThanOrEqual(8 + 43);
    expect(created.prefix).toBe(created.key.slice(0, 8));
    expect(created.name).toBe('Trip script');
    expect(created.id).toBeTruthy();
    expect(created.keyHash).toBeUndefined();

    const stored = await ApiKey.findById(created.id).lean();
    expect(stored.userId).toBe(String(ada.userId));
    expect(stored.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.keyHash).not.toBe(created.key);
    expect(JSON.stringify(stored)).not.toContain(created.key);
    expect(stored.revokedAt == null).toBe(true);
  });

  test('list omits the secret and other users’ keys', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-list@example.com',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace-list@example.com',
    });
    const created = await createKey(ada.token, 'Laptop');

    const listed = await request(app).get(KEYS).set(bearer(ada.token));
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(typeof listed.body[0].createdAt).toBe('string');
    expect(listed.body).toEqual([
      {
        id: created.id,
        name: 'Laptop',
        prefix: 'wv_live_',
        createdAt: listed.body[0].createdAt,
        lastUsedAt: null,
      },
    ]);
    const packed = JSON.stringify(listed.body);
    expect(packed).not.toContain(created.key);
    expect(packed).not.toContain('keyHash');

    const graceList = await request(app).get(KEYS).set(bearer(grace.token));
    expect(graceList.status).toBe(200);
    expect(graceList.body).toEqual([]);

    const stolen = await request(app)
      .delete(`${KEYS}/${created.id}`)
      .set(bearer(grace.token));
    expect(stolen.status).toBe(404);
    expect((await ApiKey.findById(created.id)).revokedAt == null).toBe(true);
  });

  test('a blank name is rejected and an agent key cannot mint another key', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-blank@example.com',
    });
    const blank = await request(app)
      .post(KEYS)
      .set(bearer(ada.token))
      .send({ name: '   ' });
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe('Name is required');

    const created = await createKey(ada.token, 'Agent');
    const minted = await request(app)
      .post(KEYS)
      .set(bearer(created.key))
      .send({ name: 'Second' });
    expect(minted.status).toBe(401);
    expect(minted.body.message).toBe('Token is not valid');
    expect(await ApiKey.countDocuments({ userId: String(ada.userId) })).toBe(1);
  });

  test('a valid key lists the user plans and records lastUsedAt', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-plans@example.com',
    });
    const planId = await createPlan(ada.token);
    const created = await createKey(ada.token, 'Reader');

    const plans = await request(app).get('/api/plans').set(bearer(created.key));
    expect(plans.status).toBe(200);
    expect(plans.body.plans.map((plan) => plan._id)).toContain(planId);

    const one = await request(app)
      .get(`/api/plans/${planId}`)
      .set(bearer(created.key));
    expect(one.status).toBe(200);
    expect(one.body.plan._id).toBe(planId);

    const itinerary = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set(bearer(created.key));
    expect(itinerary.status).toBe(200);
    expect(Array.isArray(itinerary.body.events)).toBe(true);

    const listed = await request(app).get(KEYS).set(bearer(ada.token));
    expect(listed.body[0].lastUsedAt).toBeTruthy();
    expect(JSON.stringify(listed.body)).not.toContain(created.key);
  });

  test('owner and collaborator keys change activities; a guest key cannot', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-edit@example.com',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace-edit@example.com',
    });
    const gus = await registerAndLogin({
      firstName: 'Gus',
      lastName: 'Guest',
      email: 'gus-edit@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, grace.token, planId, grace.email, 'Collaborator');
    await acceptRole(ada.token, gus.token, planId, gus.email, 'Guest');
    const ownerKey = await createKey(ada.token, 'Owner agent');
    const collabKey = await createKey(grace.token, 'Planner agent');
    const guestKey = await createKey(gus.token, 'Guest agent');

    const guestRead = await request(app).get('/api/plans').set(bearer(guestKey.key));
    expect(guestRead.status).toBe(200);
    expect(guestRead.body.plans.map((plan) => plan._id)).toContain(planId);

    const guestWrite = await request(app)
      .post('/api/activities')
      .set(bearer(guestKey.key))
      .send({ planId, name: 'Nope', type: 'tour', durationMinutes: 30 });
    expect(guestWrite.status).toBe(403);
    expect(guestWrite.body.message).toBe('Only Owner or Collaborator can change activities');

    const created = await request(app)
      .post('/api/activities')
      .set(bearer(collabKey.key))
      .send({ planId, name: 'Louvre', type: 'tour', durationMinutes: 90 });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Louvre');
    expect(created.body.planId).toBe(planId);

    const updated = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set(bearer(ownerKey.key))
      .send({ name: 'Louvre visit' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Louvre visit');

    const removed = await request(app)
      .delete(`/api/activities/${created.body._id}`)
      .set(bearer(ownerKey.key));
    expect(removed.status).toBe(200);
    expect(removed.body.message).toBe('Event deleted successfully');
    expect(await Event.findById(created.body._id)).toBeNull();
  });

  test('a revoked key and a bad key are rejected', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-revoke@example.com',
    });
    await createPlan(ada.token);
    const created = await createKey(ada.token, 'Temporary');

    const revoked = await request(app)
      .delete(`${KEYS}/${created.id}`)
      .set(bearer(ada.token));
    expect(revoked.status).toBe(200);
    expect(revoked.body.id).toBe(created.id);
    expect(revoked.body.key).toBeUndefined();

    const listed = await request(app).get(KEYS).set(bearer(ada.token));
    expect(listed.body).toEqual([]);

    const after = await request(app).get('/api/plans').set(bearer(created.key));
    expect(after.status).toBe(401);
    expect(after.body.message).toBe('Token is not valid');

    const bad = await request(app)
      .get('/api/plans')
      .set(bearer('wv_live_this-key-was-never-issued'));
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe('Token is not valid');

    const missing = await request(app).get('/api/plans');
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');
  });

  test('a login JWT still lists plans', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-jwt@example.com',
    });
    const planId = await createPlan(ada.token);
    const plans = await request(app).get('/api/plans').set(bearer(ada.token));
    expect(plans.status).toBe(200);
    expect(plans.body.plans.map((plan) => plan._id)).toContain(planId);
  });
});
