const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const User = require('../models/User');

jest.setTimeout(30000);

let mongo;

function memoryRedis() {
  const strings = new Map();
  const sets = new Map();

  function live(key) {
    const row = strings.get(key);
    if (!row) return null;
    if (row.expiresAt != null && row.expiresAt <= Date.now()) {
      strings.delete(key);
      return null;
    }
    return row.value;
  }

  return {
    async set(key, value, options) {
      let expiresAt = null;
      if (options && Object.prototype.hasOwnProperty.call(options, 'EX')) {
        expiresAt = Date.now() + Number(options.EX) * 1000;
      }
      strings.set(key, { value: String(value), expiresAt });
    },
    async get(key) {
      return live(key);
    },
    async del(key) {
      strings.delete(key);
      sets.delete(key);
    },
    async sAdd(key, member) {
      let set = sets.get(key);
      if (!set) {
        set = new Set();
        sets.set(key, set);
      }
      set.add(String(member));
    },
    async sMembers(key) {
      const set = sets.get(key);
      if (!set) return [];
      return Array.from(set);
    },
    async sRem(key, member) {
      const set = sets.get(key);
      if (set) set.delete(String(member));
    },
    async expire() {},
  };
}

async function registerAndLogin(email) {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Ada',
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
  return { registerRes, loginRes };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  global.redisClient = memoryRedis();
});

afterEach(async () => {
  await User.deleteMany({});
  global.redisClient = memoryRedis();
});

afterAll(async () => {
  global.redisClient = null;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('refresh tokens', () => {
  test('login and register return an access token and a refresh token', async () => {
    const email = 'refresh-both@example.com';
    const { registerRes, loginRes } = await registerAndLogin(email);

    expect(registerRes.body.msg).toBe('User registered successfully!');
    expect(typeof registerRes.body.token).toBe('string');
    expect(typeof registerRes.body.refreshToken).toBe('string');
    expect(registerRes.body.refreshToken.length).toBeGreaterThan(20);
    expect(registerRes.body.user.email).toBe(email);
    expect(registerRes.body.user.password).toBeUndefined();

    expect(typeof loginRes.body.token).toBe('string');
    expect(typeof loginRes.body.refreshToken).toBe('string');
    expect(loginRes.body.user.email).toBe(email);
    expect(loginRes.body.user.password).toBeUndefined();

    const access = jwt.decode(loginRes.body.token);
    expect(access.userId).toBe(loginRes.body.user._id);
    expect(access.exp - access.iat).toBe(900);
    expect(access.role).toBe('member');

    const registered = jwt.decode(registerRes.body.token);
    expect(registered.userId).toBe(registerRes.body.user._id);
    expect(registered.exp - registered.iat).toBe(900);
    expect(registered.role).toBeUndefined();
  });

  test('refresh rotates the token and the new access token is usable', async () => {
    const email = 'refresh-ok@example.com';
    const { loginRes } = await registerAndLogin(email);
    const oldRefresh = loginRes.body.refreshToken;

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefresh });
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.token).toBe('string');
    expect(refreshed.body.token).not.toBe(loginRes.body.token);
    expect(typeof refreshed.body.refreshToken).toBe('string');
    expect(refreshed.body.refreshToken).not.toBe(oldRefresh);
    expect(refreshed.body.user.password).toBeUndefined();
    expect(refreshed.body.user._id).toBe(loginRes.body.user._id);

    const reused = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefresh });
    expect(reused.status).toBe(401);

    const plans = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${refreshed.body.token}`);
    expect(plans.status).toBe(200);

    const again = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken });
    expect(again.status).toBe(200);
    const plansAgain = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${again.body.token}`);
    expect(plansAgain.status).toBe(200);
  });

  test('a missing, unknown, or expired refresh token is 401', async () => {
    const missing = await request(app).post('/api/auth/refresh').send({});
    expect(missing.status).toBe(401);

    const unknown = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });
    expect(unknown.status).toBe(401);

    const email = 'refresh-expired@example.com';
    const { loginRes } = await registerAndLogin(email);
    const refreshToken = loginRes.body.refreshToken;
    await global.redisClient.set(
      `refresh:${refreshToken}`,
      JSON.stringify({ userId: loginRes.body.user._id, createdAt: new Date().toISOString() }),
      { EX: 0 },
    );
    const expired = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(expired.status).toBe(401);
  });

  test('logout revokes the refresh token', async () => {
    const email = 'refresh-logout@example.com';
    const { loginRes } = await registerAndLogin(email);

    const loggedOut = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .send({ refreshToken: loginRes.body.refreshToken });
    expect(loggedOut.status).toBe(200);

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken });
    expect(refreshed.status).toBe(401);

    const plans = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    expect(plans.status).toBe(401);
  });

  test('logout without a body still revokes the user refresh tokens', async () => {
    const email = 'refresh-logout-set@example.com';
    const { loginRes } = await registerAndLogin(email);

    const loggedOut = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .send({});
    expect(loggedOut.status).toBe(200);

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken });
    expect(refreshed.status).toBe(401);
  });
});
