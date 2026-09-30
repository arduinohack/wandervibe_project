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
const SupportLog = require('../models/SupportLog');

jest.setTimeout(30000);

let mongo;

async function registerAndLogin(extra = {}) {
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
      ...extra,
    });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'ada@example.com', password: 'password1' });
  return {
    registerRes,
    loginRes,
    token: loginRes.body.token,
    userId: loginRes.body.user && loginRes.body.user._id,
  };
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
    SupportLog.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('support logs', () => {
  test('register stores member and ignores a role in the body', async () => {
    const { registerRes, loginRes } = await registerAndLogin({ role: 'admin' });

    expect(registerRes.status).toBe(201);
    expect(loginRes.status).toBe(200);
    const stored = await User.findOne({ email: 'ada@example.com' });
    expect(stored.role).toBe('member');
    expect(loginRes.body.user.role).toBe('member');
  });

  test('logs require a token and reject a member', async () => {
    const anon = await request(app).get('/api/admin/logs');
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe('No token, authorization denied');

    const ada = await registerAndLogin();
    const denied = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.logs).toBeUndefined();
  });

  test('an admin can list the plan-created event, filter it, and limit it', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });

    const created = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    expect(created.status).toBe(201);
    const planId = created.body.plan._id;

    const second = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Rome', destination: 'Rome', timeZone: 'UTC' });
    expect(second.status).toBe(201);

    await SupportLog.create({
      level: 'warn',
      event: 'OtherEvent',
      actorUserId: 'someone-else',
      message: 'manual',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const listed = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.logs)).toBe(true);
    expect(listed.body.logs.length).toBeGreaterThanOrEqual(2);
    const planRow = listed.body.logs.find((row) => row.planId === planId);
    expect(planRow).toEqual(expect.objectContaining({
      event: 'PlanCreated',
      level: 'info',
      actorUserId: ada.userId,
      planId,
      message: 'Plan created',
    }));
    expect(planRow.extra).toEqual(expect.objectContaining({ type: 'trip', name: 'Paris' }));
    expect(planRow.extra.password).toBeUndefined();
    expect(planRow.extra.token).toBeUndefined();

    const filtered = await request(app)
      .get('/api/admin/logs?event=PlanCreated')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.logs.length).toBe(2);
    expect(filtered.body.logs.every((row) => row.event === 'PlanCreated')).toBe(true);

    const byUser = await request(app)
      .get(`/api/admin/logs?userId=${ada.userId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(byUser.body.logs.every((row) => row.actorUserId === ada.userId)).toBe(true);
    expect(byUser.body.logs.find((row) => row.event === 'OtherEvent')).toBeUndefined();

    const limited = await request(app)
      .get('/api/admin/logs?limit=1')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(limited.body.logs).toHaveLength(1);
    expect(limited.body.logs[0].event).toBe('PlanCreated');

    const oldestFirst = await request(app)
      .get('/api/admin/logs?dir=asc&limit=1')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(oldestFirst.body.logs[0].event).toBe('OtherEvent');

    await User.updateOne({ _id: ada.userId }, { $set: { role: 'member' } });
    const demoted = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(demoted.status).toBe(403);
  });
});
