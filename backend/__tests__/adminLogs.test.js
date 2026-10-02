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
    Event.deleteMany({}),
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

  test('a successful login row stores actorEmail and no password', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });

    expect(ada.loginRes.status).toBe(200);
    expect(ada.loginRes.body.user.email).toBe('ada@example.com');
    expect(await waitForCount({ event: 'POST /api/auth/login', message: '200' }, 1)).toBeGreaterThanOrEqual(1);

    const listed = await request(app)
      .get('/api/admin/logs')
      .query({ event: 'POST /api/auth/login' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(listed.status).toBe(200);
    const row = listed.body.logs.find((item) => item.message === '200');
    expect(row).toEqual(expect.objectContaining({
      event: 'POST /api/auth/login',
      level: 'info',
      message: '200',
      actorUserId: ada.userId,
      actorEmail: ada.loginRes.body.user.email,
      planName: '',
    }));
    expect(row.password).toBeUndefined();
    expect(row.extra).toEqual(expect.objectContaining({
      method: 'POST',
      path: '/api/auth/login',
      statusCode: 200,
    }));
    expect(row.extra.password).toBeUndefined();
    expect(row.extra.token).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain('password1');
    expect(JSON.stringify(row)).not.toContain(ada.token);

    const mismatch = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-password' });
    expect(mismatch.status).toBe(400);
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password: 'password1' });
    expect(unknown.status).toBe(400);
    expect(await waitForCount({ event: 'POST /api/auth/login', message: '400' }, 2)).toBeGreaterThanOrEqual(2);

    const failedListed = await request(app)
      .get('/api/admin/logs')
      .query({ event: 'POST /api/auth/login' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(failedListed.status).toBe(200);
    const mismatchRow = failedListed.body.logs.find((item) => item.message === '400' && item.actorUserId === ada.userId);
    expect(mismatchRow).toEqual(expect.objectContaining({
      event: 'POST /api/auth/login',
      actorUserId: ada.userId,
      actorEmail: 'ada@example.com',
    }));
    expect(mismatchRow.password).toBeUndefined();
    expect(mismatchRow.extra.password).toBeUndefined();
    expect(mismatchRow.extra.token).toBeUndefined();
    expect(JSON.stringify(mismatchRow)).not.toContain('wrong-password');
    const unknownRow = failedListed.body.logs.find((item) => item.actorEmail === 'missing@example.com');
    expect(unknownRow).toEqual(expect.objectContaining({
      event: 'POST /api/auth/login',
      message: '400',
      actorEmail: 'missing@example.com',
    }));
    expect(unknownRow.actorUserId == null || unknownRow.actorUserId === '').toBe(true);
    expect(unknownRow.password).toBeUndefined();
    expect(unknownRow.extra.password).toBeUndefined();
    expect(JSON.stringify(unknownRow)).not.toContain('password1');

    const loggedOut = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(loggedOut.status).toBe(200);
    expect(await waitForCount({ event: 'POST /api/auth/logout', message: '200' }, 1)).toBeGreaterThanOrEqual(1);
    const logoutListed = await request(app)
      .get('/api/admin/logs')
      .query({ event: 'POST /api/auth/logout' })
      .set('Authorization', `Bearer ${ada.token}`);
    expect(logoutListed.status).toBe(200);
    const logoutRow = logoutListed.body.logs.find((item) => item.message === '200');
    expect(logoutRow).toEqual(expect.objectContaining({
      event: 'POST /api/auth/logout',
      message: '200',
      actorUserId: ada.userId,
      actorEmail: 'ada@example.com',
    }));
    expect(logoutRow.extra.token).toBeUndefined();
    expect(logoutRow.extra.password).toBeUndefined();
    expect(JSON.stringify(logoutRow)).not.toContain(ada.token);

    const anon = await request(app).post('/api/auth/logout');
    expect(anon.status).toBe(401);
    expect(await waitForCount({ event: 'POST /api/auth/logout', message: '401' }, 1)).toBeGreaterThanOrEqual(1);
    const blankListed = await request(app)
      .get('/api/admin/logs')
      .query({ event: 'POST /api/auth/logout' })
      .set('Authorization', `Bearer ${ada.token}`);
    const blank = blankListed.body.logs.find((item) => item.message === '401');
    expect(blank.actorUserId == null || blank.actorUserId === '').toBe(true);
    expect(blank.actorEmail == null || blank.actorEmail === '').toBe(true);
    expect(blank.extra.token).toBeUndefined();
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

describe('admin user explorer', () => {
  test('an admin sees the account and that user plans without secrets', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });
    const grace = await User.create({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      phoneNumber: '555-0100',
      password: 'password1',
      role: 'member',
      resetToken: 'reset-secret',
    });
    const graceId = String(grace._id);

    await Plan.create({
      _id: 'plan-paris',
      type: 'trip',
      name: 'Paris',
      destination: 'Paris',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-08T00:00:00.000Z'),
      ownerId: graceId,
    });
    await PlanUser.create({ planId: 'plan-paris', userId: graceId, role: 'Owner' });

    await Plan.create({
      _id: 'plan-hall',
      type: 'plan',
      name: 'Reception',
      location: 'Hall',
      ownerId: ada.userId,
    });
    await PlanUser.create({ planId: 'plan-hall', userId: ada.userId, role: 'Owner' });
    await PlanUser.create({ planId: 'plan-hall', userId: graceId, role: 'Guest' });

    await Plan.create({
      _id: 'plan-rome',
      type: 'trip',
      name: 'Rome',
      destination: 'Rome',
      ownerId: ada.userId,
    });

    await Plan.create({
      _id: 'plan-lisbon',
      type: 'trip',
      name: 'Lisbon',
      destination: 'Lisbon',
      ownerId: graceId,
    });

    const found = await request(app)
      .get(`/api/admin/users/${graceId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(found.status).toBe(200);
    expect(Object.keys(found.body).sort()).toEqual([
      '_id',
      'email',
      'firstName',
      'lastName',
      'phoneNumber',
      'plans',
      'role',
    ]);
    expect(found.body).toMatchObject({
      _id: graceId,
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      phoneNumber: '555-0100',
      role: 'member',
    });
    expect(found.body.password).toBeUndefined();
    expect(found.body.resetToken).toBeUndefined();
    expect(found.body.token).toBeUndefined();
    expect(JSON.stringify(found.body)).not.toContain('password1');
    expect(JSON.stringify(found.body)).not.toContain('reset-secret');
    expect(JSON.stringify(found.body)).not.toContain(ada.token);

    expect(found.body.plans.map((plan) => plan._id)).toEqual(['plan-lisbon', 'plan-paris', 'plan-hall']);
    const paris = found.body.plans.find((plan) => plan._id === 'plan-paris');
    expect(Object.keys(paris).sort()).toEqual(['_id', 'endDate', 'name', 'role', 'startDate', 'type']);
    expect(paris).toMatchObject({
      name: 'Paris',
      type: 'trip',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-08T00:00:00.000Z',
      role: 'Owner',
    });
    expect(found.body.plans.find((plan) => plan._id === 'plan-hall')).toMatchObject({
      name: 'Reception',
      type: 'plan',
      startDate: null,
      endDate: null,
      role: 'Guest',
    });
    expect(found.body.plans.find((plan) => plan._id === 'plan-lisbon').role).toBe('Owner');
    expect(found.body.plans.find((plan) => plan._id === 'plan-rome')).toBeUndefined();
  });

  test('explorer allows an admin, rejects a member, and 404s an unknown id', async () => {
    const ada = await registerAndLogin();

    const anon = await request(app).get(`/api/admin/users/${ada.userId}`);
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe('No token, authorization denied');

    const member = await request(app)
      .get(`/api/admin/users/${ada.userId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(member.status).toBe(403);
    expect(member.body.message).toBe('Admin access required');

    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });
    const self = await request(app)
      .get(`/api/admin/users/${ada.userId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(self.status).toBe(200);
    expect(self.body.email).toBe('ada@example.com');
    expect(self.body.plans).toEqual([]);

    const missing = await request(app)
      .get('/api/admin/users/does-not-exist')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('User not found');
  });
});

describe('admin plan explorer', () => {
  test('an admin sees the plan, its members, and its activities', async () => {
    const ada = await registerAndLogin();
    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });
    const grace = await User.create({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password1',
      role: 'member',
      resetToken: 'reset-secret',
    });
    const graceId = String(grace._id);

    await Plan.create({
      _id: 'plan-paris',
      type: 'trip',
      name: 'Paris',
      destination: 'Paris',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-08T00:00:00.000Z'),
      timeZone: 'Europe/Paris',
      ownerId: ada.userId,
    });
    await PlanUser.create({ planId: 'plan-paris', userId: ada.userId, role: 'Owner' });
    await PlanUser.create({ planId: 'plan-paris', userId: graceId, role: 'Guest' });
    await Event.create({
      _id: 'act-late',
      name: 'Dinner',
      type: 'dining',
      planId: 'plan-paris',
      ownerId: ada.userId,
      startTime: new Date('2026-06-02T19:00:00.000Z'),
    });
    await Event.create({
      _id: 'act-early',
      name: 'Train',
      type: 'train',
      planId: 'plan-paris',
      ownerId: ada.userId,
      startTime: new Date('2026-06-01T08:00:00.000Z'),
    });
    await Event.create({
      _id: 'act-other',
      name: 'Elsewhere',
      type: 'tour',
      planId: 'plan-rome',
      ownerId: ada.userId,
      startTime: new Date('2026-06-01T07:00:00.000Z'),
    });

    await Plan.create({
      _id: 'plan-lisbon',
      type: 'trip',
      name: 'Lisbon',
      destination: 'Lisbon',
      ownerId: graceId,
    });

    const found = await request(app)
      .get('/api/admin/plans/plan-paris')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(found.status).toBe(200);
    expect(Object.keys(found.body).sort()).toEqual([
      '_id',
      'activities',
      'destination',
      'endDate',
      'members',
      'name',
      'startDate',
      'timeZone',
      'type',
    ]);
    expect(found.body).toMatchObject({
      _id: 'plan-paris',
      name: 'Paris',
      type: 'trip',
      destination: 'Paris',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-08T00:00:00.000Z',
      timeZone: 'Europe/Paris',
    });
    expect(found.body.password).toBeUndefined();
    expect(found.body.token).toBeUndefined();
    expect(JSON.stringify(found.body)).not.toContain('password1');
    expect(JSON.stringify(found.body)).not.toContain('reset-secret');
    expect(JSON.stringify(found.body)).not.toContain(ada.token);

    expect(found.body.members.map((member) => member.email)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
    expect(Object.keys(found.body.members[0]).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'role',
    ]);
    expect(found.body.members[0]).toMatchObject({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'Owner',
    });
    expect(found.body.members[1]).toMatchObject({
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'Guest',
    });

    expect(found.body.activities.map((activity) => activity._id)).toEqual(['act-early', 'act-late']);
    expect(Object.keys(found.body.activities[0]).sort()).toEqual(['_id', 'name', 'startTime', 'type']);
    expect(found.body.activities[0]).toMatchObject({
      _id: 'act-early',
      name: 'Train',
      type: 'train',
      startTime: '2026-06-01T08:00:00.000Z',
    });
    expect(found.body.activities[1]).toMatchObject({
      name: 'Dinner',
      type: 'dining',
      startTime: '2026-06-02T19:00:00.000Z',
    });

    const ownedOnly = await request(app)
      .get('/api/admin/plans/plan-lisbon')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(ownedOnly.status).toBe(200);
    expect(ownedOnly.body.members).toEqual([
      expect.objectContaining({
        email: 'grace@example.com',
        firstName: 'Grace',
        lastName: 'Hopper',
        role: 'Owner',
      }),
    ]);
    expect(ownedOnly.body.activities).toEqual([]);
  });

  test('plan explorer allows an admin, rejects a member, and 404s an unknown id', async () => {
    const ada = await registerAndLogin();

    const anon = await request(app).get('/api/admin/plans/plan-paris');
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe('No token, authorization denied');

    const member = await request(app)
      .get('/api/admin/plans/plan-paris')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(member.status).toBe(403);
    expect(member.body.message).toBe('Admin access required');

    await User.updateOne({ _id: ada.userId }, { $set: { role: 'admin' } });
    const missing = await request(app)
      .get('/api/admin/plans/does-not-exist')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Plan not found');
  });
});
