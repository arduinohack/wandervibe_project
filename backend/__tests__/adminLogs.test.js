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
const { shouldSkipRequestLog } = require('../middleware/requestLog');

async function waitForCount(filter, count) {
  for (let i = 0; i < 25; i += 1) {
    const found = await SupportLog.countDocuments(filter);
    if (found >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return SupportLog.countDocuments(filter);
}

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
      actorEmail: 'ada@example.com',
      planId,
      planName: 'Paris',
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

    expect(await waitForCount({ event: /^POST \/api\/plans/ }, 2)).toBeGreaterThanOrEqual(2);
    const limited = await request(app)
      .get('/api/admin/logs?limit=1')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(limited.body.logs).toHaveLength(1);
    expect(limited.body.logs[0].event).toContain('POST');
    expect(limited.body.logs[0].event).toContain('/api/plans');

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

  test('a missing user or plan leaves the name empty and keeps the ids', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });

    await SupportLog.create({
      level: 'info',
      event: 'OrphanPlan',
      actorUserId: 'missing-user',
      planId: 'missing-plan',
      message: 'orphan',
    });

    const listed = await request(app)
      .get('/api/admin/logs')
      .query({ planId: 'missing-plan' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.logs).toHaveLength(1);
    expect(listed.body.logs[0]).toEqual(expect.objectContaining({
      actorUserId: 'missing-user',
      actorEmail: '',
      planId: 'missing-plan',
      planName: '',
    }));
  });

  test('a plan create stores a request row and PlanCreated', async () => {
    const ada = await registerAndLogin();
    const created = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    expect(created.status).toBe(201);

    expect(await waitForCount({ event: /^POST \/api\/plans/ }, 1)).toBeGreaterThanOrEqual(1);
    const requestRow = await SupportLog.findOne({ event: /^POST \/api\/plans/ });
    expect(requestRow.level).toBe('info');
    expect(requestRow.actorUserId).toBe(ada.userId);
    expect(requestRow.message).toBe('201');
    expect(requestRow.extra).toEqual({
      method: 'POST',
      path: '/api/plans',
      statusCode: 201,
    });

    const named = await SupportLog.findOne({ event: 'PlanCreated' });
    expect(named).not.toBeNull();
    expect(named.actorUserId).toBe(ada.userId);
  });

  test('listing admin logs does not store a GET /api/admin/logs row', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });

    const listed = await request(app)
      .get('/api/admin/logs?event=PlanCreated')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(listed.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await SupportLog.countDocuments({ event: /^GET \/api\/admin\/logs/ })).toBe(0);
  });

  test('a missing token on GET /api/plans is a warn row with no actor', async () => {
    const anon = await request(app).get('/api/plans?probe=1');
    expect(anon.status).toBe(401);

    expect(await waitForCount({ message: '401' }, 1)).toBeGreaterThanOrEqual(1);
    const row = await SupportLog.findOne({ message: '401' });
    expect(row.level).toBe('warn');
    expect(row.event).toContain('GET');
    expect(row.event).toContain('/api/plans');
    expect(row.actorUserId).toBeUndefined();
    expect(row.extra).toEqual({
      method: 'GET',
      path: '/api/plans',
      statusCode: 401,
    });
  });

  test('OPTIONS is not stored', async () => {
    const response = await request(app).options('/api/plans');
    expect(response.status).toBeGreaterThanOrEqual(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await SupportLog.countDocuments()).toBe(0);
  });

  test('SUPPORT_LOG_SKIP matches the event string and an empty value adds no skips', async () => {
    expect(shouldSkipRequestLog({ method: 'OPTIONS', originalUrl: '/api/plans' })).toBe(true);
    expect(shouldSkipRequestLog({ method: 'GET', originalUrl: '/api/admin/logs?event=PlanCreated' })).toBe(true);
    expect(shouldSkipRequestLog({ method: 'GET', originalUrl: '/api/plans' })).toBe(false);

    process.env.SUPPORT_LOG_SKIP = 'GET /api/plans, POST /api/auth/login';
    try {
      expect(shouldSkipRequestLog({ method: 'GET', originalUrl: '/api/plans' })).toBe(true);
      expect(shouldSkipRequestLog({ method: 'POST', originalUrl: '/api/auth/login' })).toBe(true);
      expect(shouldSkipRequestLog({ method: 'DELETE', originalUrl: '/api/plans/abc' })).toBe(false);

      const skipped = await request(app).get('/api/plans');
      expect(skipped.status).toBe(401);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await SupportLog.countDocuments({ message: '401' })).toBe(0);
    } finally {
      delete process.env.SUPPORT_LOG_SKIP;
    }

    expect(shouldSkipRequestLog({ method: 'GET', originalUrl: '/api/plans' })).toBe(false);
  });
});

describe('admin user search', () => {
  test('an admin search matches an email substring and omits secrets', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });
    await User.create([
      {
        firstName: 'Ken',
        lastName: 'Allen',
        email: 'ken@example.com',
        password: 'password1',
        role: 'admin',
        resetToken: 'reset-secret',
      },
      {
        firstName: 'Ann',
        lastName: 'Ken',
        email: 'aaa-ken@example.com',
        password: 'password1',
        role: 'member',
      },
      {
        firstName: 'Dot',
        lastName: 'User',
        email: 'a.b@example.com',
        password: 'password1',
      },
      {
        firstName: 'Any',
        lastName: 'Char',
        email: 'axb@example.com',
        password: 'password1',
      },
    ]);

    const found = await request(app)
      .get('/api/admin/users')
      .query({ q: 'ken' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(found.status).toBe(200);
    expect(found.body.users.map((user) => user.email)).toEqual([
      'aaa-ken@example.com',
      'ken@example.com',
    ]);
    const ken = found.body.users.find((user) => user.email === 'ken@example.com');
    expect(Object.keys(ken).sort()).toEqual(['_id', 'email', 'firstName', 'lastName', 'role']);
    expect(ken).toMatchObject({
      firstName: 'Ken',
      lastName: 'Allen',
      role: 'admin',
    });
    expect(ken.password).toBeUndefined();
    expect(ken.resetToken).toBeUndefined();
    expect(ken.__v).toBeUndefined();

    const upper = await request(app)
      .get('/api/admin/users')
      .query({ q: '  KEN' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(upper.body.users.map((user) => user.email)).toContain('ken@example.com');

    const dotted = await request(app)
      .get('/api/admin/users')
      .query({ q: 'a.b' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(dotted.status).toBe(200);
    expect(dotted.body.users.map((user) => user.email)).toEqual(['a.b@example.com']);
  });

  test('a user search shorter than two characters is empty', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });

    const short = await request(app)
      .get('/api/admin/users')
      .query({ q: 'a' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(short.status).toBe(200);
    expect(short.body).toEqual({ users: [] });

    const padded = await request(app)
      .get('/api/admin/users')
      .query({ q: ' a ' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(padded.status).toBe(200);
    expect(padded.body).toEqual({ users: [] });
  });

  test('user search rejects a missing token and a member', async () => {
    const anon = await request(app).get('/api/admin/users?q=ken');
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe('No token, authorization denied');

    const ada = await registerAndLogin();
    const denied = await request(app)
      .get('/api/admin/users?q=ken')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Admin access required');
    expect(denied.body.users).toBeUndefined();
  });
});
