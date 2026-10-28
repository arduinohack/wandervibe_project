const previousTest = process.env.TURNSTILE_TEST;
const previousSecret = process.env.TURNSTILE_SECRET_KEY;
const previousGate = process.env.EMAIL_VERIFY_GATE;
process.env.TURNSTILE_TEST = '1';
process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
process.env.EMAIL_VERIFY_GATE = '1';

jest.mock('axios', () => ({
  post: jest.fn(),
}));

jest.mock('../utils/email/sendEmail', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  selectedProviderName: jest.fn(() => 'console'),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');
const app = require('../app');
const User = require('../models/User');
const Invitation = require('../models/Invitation');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const { sendEmail } = require('../utils/email/sendEmail');
const { resetAuthRateLimits } = require('../middleware/authRateLimit');
const { SITEVERIFY_URL, NOT_CONFIGURED, FAILED } = require('../utils/turnstile');

jest.setTimeout(30000);

const SECRET = 'test-turnstile-secret';
let mongo;

function registerBody(email, extra = {}) {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email,
    password: 'password1',
    ...extra,
  };
}

async function register(email, extra = {}) {
  await allowRegister(email);
  const res = await request(app).post('/api/auth/register').send(registerBody(email, extra));
  await clearRegisterInvite(email);
  return res;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  process.env.TURNSTILE_TEST = '1';
  process.env.TURNSTILE_SECRET_KEY = SECRET;
  process.env.EMAIL_VERIFY_GATE = '1';
  axios.post.mockReset();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  await resetAuthRateLimits();
  await Promise.all([
    User.deleteMany({}),
    Invitation.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (previousTest == null) delete process.env.TURNSTILE_TEST;
  else process.env.TURNSTILE_TEST = previousTest;
  if (previousSecret == null) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = previousSecret;
  if (previousGate == null) delete process.env.EMAIL_VERIFY_GATE;
  else process.env.EMAIL_VERIFY_GATE = previousGate;
  delete process.env.AUTH_RATE_LIMIT;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('register Turnstile', () => {
  test('a missing secret returns 503 and does not create a user', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const res = await register('ada-no-secret@example.com', { turnstileToken: 'any-token' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: NOT_CONFIGURED });
    expect(axios.post).not.toHaveBeenCalled();
    expect(await User.countDocuments()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a missing token returns 400', async () => {
    const res = await register('ada-no-token@example.com');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: FAILED });
    expect(axios.post).not.toHaveBeenCalled();
    expect(await User.countDocuments()).toBe(0);
  });

  test('a blank token returns 400', async () => {
    const res = await register('ada-blank-token@example.com', { turnstileToken: '   ' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: FAILED });
    expect(await User.countDocuments()).toBe(0);
  });

  test('a failed siteverify returns 400', async () => {
    axios.post.mockResolvedValue({ data: { success: false, 'error-codes': ['invalid-input-response'] } });
    const res = await register('ada-bad-token@example.com', { turnstileToken: 'expired-token' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: FAILED });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(await User.countDocuments()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a siteverify error returns 400', async () => {
    axios.post.mockRejectedValue(new Error('network down'));
    const res = await register('ada-net@example.com', { turnstileToken: 'some-token' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: FAILED });
    expect(await User.countDocuments()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a successful siteverify creates the account and sends the verification email', async () => {
    axios.post.mockResolvedValue({ data: { success: true } });
    const res = await register('ada-ok@example.com', { turnstileToken: 'valid-token' });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
    expect(res.body.user.emailVerified).toBe(false);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe(SITEVERIFY_URL);
    const params = axios.post.mock.calls[0][1];
    expect(params).toBeInstanceOf(URLSearchParams);
    expect(params.get('secret')).toBe(SECRET);
    expect(params.get('response')).toBe('valid-token');
    expect(params.get('remoteip')).toBeTruthy();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('ada-ok@example.com');
    expect(message.text).toContain('https://planitvibe.com/verify-email?token=');

    const login = await request(app).post('/api/auth/login').send({
      email: 'ada-ok@example.com',
      password: 'password1',
    });
    expect(login.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('the suite bypass still registers without a token', async () => {
    delete process.env.TURNSTILE_TEST;
    const res = await register('ada-bypass@example.com');
    expect(res.status).toBe(201);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
