const previousRateLimit = process.env.AUTH_RATE_LIMIT;
process.env.AUTH_RATE_LIMIT = '1';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Invitation = require('../models/Invitation');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const {
  resetAuthRateLimits,
  shutdownAuthRateLimits,
  TOO_MANY_ATTEMPTS,
} = require('../middleware/authRateLimit');

jest.setTimeout(30000);

let mongo;

function client(ip) {
  const req = request(app);
  return {
    post(path) {
      const call = req.post(path);
      if (ip) call.set('X-Forwarded-For', ip);
      return call;
    },
    get(path) {
      const call = req.get(path);
      if (ip) call.set('X-Forwarded-For', ip);
      return call;
    },
  };
}

async function postTimes(path, body, times, ip) {
  const responses = [];
  for (let i = 0; i < times; i += 1) {
    responses.push(await client(ip).post(path).send(body));
  }
  return responses;
}

function expectBlocked(res, maxRetryAfter) {
  expect(res.status).toBe(429);
  expect(res.body).toEqual({ message: TOO_MANY_ATTEMPTS });
  const retryAfter = Number(res.headers['retry-after']);
  expect(Number.isFinite(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(maxRetryAfter);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  process.env.AUTH_RATE_LIMIT = '1';
  await resetAuthRateLimits();
  await Promise.all([
    User.deleteMany({}),
    Invitation.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (previousRateLimit == null) delete process.env.AUTH_RATE_LIMIT;
  else process.env.AUTH_RATE_LIMIT = previousRateLimit;
  shutdownAuthRateLimits();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('auth rate limits', () => {
  test('a normal register and login still succeed', async () => {
    const email = 'ada-limit@example.com';
    await allowRegister(email);
    const registerRes = await client('203.0.113.20')
      .post('/api/auth/register')
      .send({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email,
        password: 'password1',
      });
    await clearRegisterInvite(email);
    expect(registerRes.status).toBe(201);

    const loginRes = await client('203.0.113.21')
      .post('/api/auth/login')
      .send({ email, password: 'password1' });
    expect(loginRes.status).toBe(200);
    expect(typeof loginRes.body.token).toBe('string');
    expect(loginRes.body.token.length).toBeGreaterThan(0);
  });

  test('the 6th register from the same IP within an hour is 429', async () => {
    const responses = await postTimes('/api/auth/register', {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-burst@example.com',
      password: 'password1',
    }, 6, '203.0.113.30');

    for (const res of responses.slice(0, 5)) {
      expect(res.status).not.toBe(429);
    }
    expectBlocked(responses[5], 60 * 60);
  });

  test('the 11th login within 15 minutes is 429', async () => {
    const responses = await postTimes('/api/auth/login', {
      email: 'ada-burst@example.com',
      password: 'password1',
    }, 11, '203.0.113.40');

    for (const res of responses.slice(0, 10)) {
      expect(res.status).not.toBe(429);
    }
    expectBlocked(responses[10], 15 * 60);
  });

  test('the 6th forgot-password from the same IP within an hour is 429', async () => {
    const responses = await postTimes('/api/auth/forgot-password', {
      email: 'nobody-limit@example.com',
    }, 6, '203.0.113.50');

    expect(responses[0].status).toBe(200);
    for (const res of responses.slice(0, 5)) {
      expect(res.status).not.toBe(429);
    }
    expectBlocked(responses[5], 60 * 60);
  });

  test('a different IP keeps its own register window', async () => {
    const body = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-other-ip@example.com',
      password: 'password1',
    };
    const blocked = (await postTimes('/api/auth/register', body, 6, '203.0.113.60'))[5];
    expect(blocked.status).toBe(429);

    const other = await client('203.0.113.61').post('/api/auth/register').send(body);
    expect(other.status).not.toBe(429);
  });

  test('other routes are not rate limited', async () => {
    const blocked = (await postTimes('/api/auth/register', {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-routes@example.com',
      password: 'password1',
    }, 6, '203.0.113.70'))[5];
    expect(blocked.status).toBe(429);

    const health = await client('203.0.113.70').get('/');
    expect(health.status).toBe(200);

    const plans = await client('203.0.113.70')
      .post('/api/plans')
      .send({ type: 'trip', name: 'Nope' });
    expect(plans.status).toBe(401);

    const reset = await client('203.0.113.70')
      .post('/api/auth/reset-password')
      .send({});
    expect(reset.status).not.toBe(429);

    const verify = await client('203.0.113.70')
      .post('/api/auth/verify-token')
      .send({});
    expect(verify.status).not.toBe(429);
  });
});
