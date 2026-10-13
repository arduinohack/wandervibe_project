jest.mock('../utils/email/sendEmail', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  selectedProviderName: jest.fn(() => 'console'),
}));

jest.mock('../utils/sms', () => ({
  sendSms: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Invitation = require('../models/Invitation');
const { sendEmail } = require('../utils/email/sendEmail');
const { sendSms } = require('../utils/sms');
const logger = require('../utils/logger');

jest.setTimeout(30000);

let mongo;
const envSnapshot = {
  NODE_ENV: process.env.NODE_ENV,
  NOTIFY_OVERRIDE_SMS: process.env.NOTIFY_OVERRIDE_SMS,
  NOTIFY_OVERRIDE_EMAIL: process.env.NOTIFY_OVERRIDE_EMAIL,
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  process.env.NOTIFY_OVERRIDE_SMS = '+15550002222';
  process.env.NOTIFY_OVERRIDE_EMAIL = 'redirect@example.com';
  sendEmail.mockResolvedValue({ id: 'email_1' });
  sendEmail.mockClear();
  sendSms.mockClear();
  logger.info.mockClear();
  logger.error.mockClear();
});

afterEach(async () => {
  if (envSnapshot.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = envSnapshot.NODE_ENV;
  if (envSnapshot.NOTIFY_OVERRIDE_SMS === undefined) delete process.env.NOTIFY_OVERRIDE_SMS;
  else process.env.NOTIFY_OVERRIDE_SMS = envSnapshot.NOTIFY_OVERRIDE_SMS;
  if (envSnapshot.NOTIFY_OVERRIDE_EMAIL === undefined) delete process.env.NOTIFY_OVERRIDE_EMAIL;
  else process.env.NOTIFY_OVERRIDE_EMAIL = envSnapshot.NOTIFY_OVERRIDE_EMAIL;
  await User.deleteMany({});
  await Invitation.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('request-invite', () => {
  test('a missing name or a badly formed email is 400', async () => {
    const missingName = await request(app)
      .post('/api/auth/request-invite')
      .send({ email: 'ada@example.com' });
    expect(missingName.status).toBe(400);
    expect(missingName.body.msg).toBe('Name is required');

    const blankName = await request(app)
      .post('/api/auth/request-invite')
      .send({ name: '   ', email: 'ada@example.com' });
    expect(blankName.status).toBe(400);
    expect(blankName.body.msg).toBe('Name is required');

    const badEmails = ['', '   ', 'not-an-email', 'ada@', 'ada@example', 'a@b', 'ada @example.com'];
    for (const email of badEmails) {
      const res = await request(app)
        .post('/api/auth/request-invite')
        .send({ name: 'Ada Lovelace', email });
      expect(res.status).toBe(400);
      expect(res.body.msg).toBe('Email is not valid');
    }

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(await User.countDocuments()).toBe(0);
    expect(await Invitation.countDocuments()).toBe(0);
  });

  test('an existing account is reported and not notified', async () => {
    await User.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });

    const res = await request(app)
      .post('/api/auth/request-invite')
      .send({ name: 'Ada Lovelace', email: '  Ada@Example.com  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: true });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(await User.countDocuments()).toBe(1);
    expect(await Invitation.countDocuments()).toBe(0);
  });

  test('a new request notifies the operator with the name and email', async () => {
    const res = await request(app)
      .post('/api/auth/request-invite')
      .send({ name: '  Grace Hopper  ', email: ' grace@example.com ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('ken@eratespecialists.com');
    expect(message.to).not.toBe('grace@example.com');
    expect(message.to).not.toBe('redirect@example.com');
    expect(message.text).toContain('Grace Hopper');
    expect(message.text).toContain('grace@example.com');
    expect(message.text).toContain('PlanItVibe');
    expect(message.text).not.toMatch(/https?:\/\//i);
    expect(message.html).not.toMatch(/https?:\/\//i);

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith({
      to: '+14044081476',
      body: 'PlanItVibe invitation request: Grace Hopper',
    });

    const sent = logger.info.mock.calls.find((call) => call[0] === 'Invitation request email sent');
    expect(sent[1].context).toEqual(expect.objectContaining({
      to: 'ken@eratespecialists.com',
      result: { id: 'email_1' },
    }));
    expect(logger.error).not.toHaveBeenCalled();

    expect(await User.countDocuments()).toBe(0);
    expect(await Invitation.countDocuments()).toBe(0);
  });

  test('a mail or SMS failure still returns 200', async () => {
    const mailError = new Error('mailbox unavailable');
    mailError.statusCode = 422;
    mailError.provider = 'resend';
    sendEmail.mockRejectedValueOnce(mailError);

    const mailFailed = await request(app)
      .post('/api/auth/request-invite')
      .send({ name: 'Grace Hopper', email: 'grace@example.com' });

    expect(mailFailed.status).toBe(200);
    expect(mailFailed.body).toEqual({ exists: false });
    expect(sendSms).toHaveBeenCalledTimes(1);
    const failed = logger.error.mock.calls.find((call) => call[0] === 'Invitation request email failed');
    expect(failed[1].context).toEqual(expect.objectContaining({
      to: 'ken@eratespecialists.com',
      result: 'failed',
      provider: 'resend',
      status: 422,
      error: 'mailbox unavailable',
    }));

    sendSms.mockRejectedValueOnce(new Error('text failed'));
    const smsFailed = await request(app)
      .post('/api/auth/request-invite')
      .send({ name: 'Grace Hopper', email: 'grace@example.com' });

    expect(smsFailed.status).toBe(200);
    expect(smsFailed.body).toEqual({ exists: false });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(logger.error.mock.calls.some((call) => call[0] === 'Invitation request SMS failed')).toBe(true);
    expect(await User.countDocuments()).toBe(0);
    expect(await Invitation.countDocuments()).toBe(0);
  });
});
