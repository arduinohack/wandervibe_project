const previousGate = process.env.EMAIL_VERIFY_GATE;
process.env.EMAIL_VERIFY_GATE = '1';

jest.mock('../utils/email/sendEmail', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  selectedProviderName: jest.fn(() => 'console'),
}));

jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Invitation = require('../models/Invitation');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const { sendEmail } = require('../utils/email/sendEmail');
const { resetAuthRateLimits } = require('../middleware/authRateLimit');
const { VERIFY_EMAIL_MESSAGE } = require('../utils/planAccess');
const {
  INVALID_LINK,
  ALREADY_VERIFIED,
  VERIFICATION_SENT,
} = require('../utils/emailVerification');

jest.setTimeout(30000);

let mongo;

function tokenFromMail() {
  const message = sendEmail.mock.calls[sendEmail.mock.calls.length - 1][0];
  const match = String(message.text).match(/token=([^\s]+)/);
  if (!match) throw new Error('verification link missing');
  return decodeURIComponent(match[1]);
}

async function register(email) {
  await allowRegister(email);
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email,
    password: 'password1',
  });
  await clearRegisterInvite(email);
  return res;
}

function planBody() {
  return { type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  process.env.EMAIL_VERIFY_GATE = '1';
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  await resetAuthRateLimits();
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    Invitation.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (previousGate == null) delete process.env.EMAIL_VERIFY_GATE;
  else process.env.EMAIL_VERIFY_GATE = previousGate;
  delete process.env.AUTH_RATE_LIMIT;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('email verification', () => {
  test('register sends a verification link and still returns a login token', async () => {
    const res = await register('ada-verify@example.com');
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.user.emailVerifyToken).toBeUndefined();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('ada-verify@example.com');
    expect(message.subject).toContain('PlanItVibe');
    expect(message.text).toContain('https://planitvibe.com/verify-email?token=');
    expect(message.text).toContain('PlanItVibe');
    expect(message.html).toContain('PlanItVibe');

    const login = await request(app).post('/api/auth/login').send({
      email: 'ada-verify@example.com',
      password: 'password1',
    });
    expect(login.status).toBe(200);
  });

  test('a mail failure still lets the new user log in', async () => {
    sendEmail.mockRejectedValueOnce(new Error('resend down'));
    const res = await register('ada-mail-down@example.com');
    expect(res.status).toBe(201);
    expect(res.body.token.length).toBeGreaterThan(0);
    const stored = await User.findOne({ email: 'ada-mail-down@example.com' }).select('emailVerified').lean();
    expect(stored.emailVerified).toBe(false);
  });

  test('an unverified user cannot create a plan until the link is used', async () => {
    const registered = await register('ada-plan@example.com');
    const token = registered.body.token;
    const userId = registered.body.user._id;
    const raw = tokenFromMail();

    const blocked = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send(planBody());
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ message: VERIFY_EMAIL_MESSAGE });
    expect(await Plan.countDocuments({ ownerId: userId })).toBe(0);
    const before = await User.findById(userId).select('trialStartedAt').lean();
    expect(before.trialStartedAt == null).toBe(true);

    const verified = await request(app).post('/api/auth/verify-email').send({ token: raw });
    expect(verified.status).toBe(200);
    expect(verified.body.message).toBe('Email verified.');
    const stored = await User.findById(userId).select('+emailVerifyToken emailVerified emailVerifyExpires').lean();
    expect(stored.emailVerified).toBe(true);
    expect(stored.emailVerifyToken).toBeUndefined();
    expect(stored.emailVerifyExpires).toBeUndefined();

    const created = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send(planBody());
    expect(created.status).toBe(201);
  });

  test('a bad or expired token is rejected', async () => {
    await register('ada-expired@example.com');
    const raw = tokenFromMail();

    const bad = await request(app).post('/api/auth/verify-email').send({ token: 'not-a-real-token' });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ message: INVALID_LINK });

    await User.updateOne(
      { email: 'ada-expired@example.com' },
      { $set: { emailVerifyExpires: new Date(Date.now() - 1000) } },
    );
    const expired = await request(app).post('/api/auth/verify-email').send({ token: raw });
    expect(expired.status).toBe(400);
    expect(expired.body).toEqual({ message: INVALID_LINK });
    const stored = await User.findOne({ email: 'ada-expired@example.com' }).select('emailVerified').lean();
    expect(stored.emailVerified).toBe(false);
  });

  test('resend replaces the link, and a verified account gets a neutral reply', async () => {
    const registered = await register('ada-resend@example.com');
    const raw = tokenFromMail();
    sendEmail.mockClear();

    const resent = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${registered.body.token}`)
      .send({});
    expect(resent.status).toBe(200);
    expect(resent.body).toEqual({ message: VERIFICATION_SENT });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const fresh = tokenFromMail();
    expect(fresh).not.toBe(raw);

    const oldLink = await request(app).post('/api/auth/verify-email').send({ token: raw });
    expect(oldLink.status).toBe(400);

    const verified = await request(app).post('/api/auth/verify-email').send({ token: fresh });
    expect(verified.status).toBe(200);
    sendEmail.mockClear();

    const again = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${registered.body.token}`)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ message: ALREADY_VERIFIED });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('the 6th resend from the same IP within an hour is 429', async () => {
    const registered = await register('ada-resend-limit@example.com');
    process.env.AUTH_RATE_LIMIT = '1';
    await resetAuthRateLimits();
    try {
      const responses = [];
      for (let i = 0; i < 6; i += 1) {
        responses.push(await request(app)
          .post('/api/auth/resend-verification')
          .set('X-Forwarded-For', '203.0.113.80')
          .set('Authorization', `Bearer ${registered.body.token}`)
          .send({}));
      }
      for (const res of responses.slice(0, 5)) {
        expect(res.status).toBe(200);
      }
      expect(responses[5].status).toBe(429);
      expect(responses[5].body.message).toBe('Too many attempts. Try again later.');
      expect(Number(responses[5].headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      delete process.env.AUTH_RATE_LIMIT;
    }
  });

  test('an existing account with no emailVerified field can still create a plan', async () => {
    const existing = await User.create({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace-existing@example.com',
      password: 'password1',
    });
    const stored = await User.findById(existing._id).select('emailVerified').lean();
    expect(stored.emailVerified == null).toBe(true);

    const login = await request(app).post('/api/auth/login').send({
      email: 'grace-existing@example.com',
      password: 'password1',
    });
    expect(login.status).toBe(200);

    const created = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send(planBody());
    expect(created.status).toBe(201);
  });

  test('Plus can create a plan before the email is verified', async () => {
    const registered = await register('ada-plus@example.com');
    await User.updateOne({ _id: registered.body.user._id }, { $set: { plusActive: true } });
    const created = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${registered.body.token}`)
      .send(planBody());
    expect(created.status).toBe(201);
    const stored = await User.findById(registered.body.user._id).select('emailVerified').lean();
    expect(stored.emailVerified).toBe(false);
  });
});
