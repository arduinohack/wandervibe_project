jest.mock('../utils/email/sendEmail', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  selectedProviderName: jest.fn(() => 'console'),
}));

jest.mock('../utils/sms', () => ({
  sendSms: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Invitation = require('../models/Invitation');
const { sendEmail } = require('../utils/email/sendEmail');
const { sendSms } = require('../utils/sms');

jest.setTimeout(30000);

let mongo;
const envSnapshot = {
  NODE_ENV: process.env.NODE_ENV,
  INVITE_REQUEST_EMAIL: process.env.INVITE_REQUEST_EMAIL,
  NOTIFY_OVERRIDE_SMS: process.env.NOTIFY_OVERRIDE_SMS,
  NOTIFY_OVERRIDE_EMAIL: process.env.NOTIFY_OVERRIDE_EMAIL,
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  process.env.INVITE_REQUEST_EMAIL = 'operator@example.com';
  process.env.NOTIFY_OVERRIDE_SMS = '+15550002222';
  process.env.NOTIFY_OVERRIDE_EMAIL = 'redirect@example.com';
  sendEmail.mockClear();
  sendSms.mockClear();
});

afterEach(async () => {
  if (envSnapshot.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = envSnapshot.NODE_ENV;
  if (envSnapshot.INVITE_REQUEST_EMAIL === undefined) delete process.env.INVITE_REQUEST_EMAIL;
  else process.env.INVITE_REQUEST_EMAIL = envSnapshot.INVITE_REQUEST_EMAIL;
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
  test('a badly formed email is 400 and sends nothing', async () => {
    const bad = ['', '   ', 'not-an-email', 'ada@', 'ada@example', 'a@b', 'ada @example.com'];
    for (const email of bad) {
      const res = await request(app)
        .post('/api/auth/request-invite')
        .send({ email });
      expect(res.status).toBe(400);
      expect(res.body.msg).toBe('Email is not valid');
    }

    const missing = await request(app).post('/api/auth/request-invite').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.msg).toBe('Email is not valid');

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(await User.countDocuments()).toBe(0);
    expect(await Invitation.countDocuments()).toBe(0);
  });

  test('a valid email tells the operator and does not reveal an account', async () => {
    await User.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });

    const known = await request(app)
      .post('/api/auth/request-invite')
      .send({ email: '  ada@example.com  ' });
    const unknown = await request(app)
      .post('/api/auth/request-invite')
      .send({ email: 'nobody@example.com' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual({ msg: 'Request received' });
    expect(unknown.body).toEqual(known.body);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map((call) => call[0].to);
    expect(recipients).toEqual(['operator@example.com', 'operator@example.com']);
    expect(recipients).not.toContain('ada@example.com');
    expect(recipients).not.toContain('nobody@example.com');
    expect(recipients).not.toContain('redirect@example.com');

    const texts = sendEmail.mock.calls.map((call) => call[0].text);
    expect(texts[0]).toContain('ada@example.com');
    expect(texts[1]).toContain('nobody@example.com');
    expect(texts.join('\n')).toContain('PlanItVibe');

    expect(sendSms).toHaveBeenCalledTimes(2);
    expect(sendSms).toHaveBeenNthCalledWith(1, {
      to: '+15550002222',
      body: expect.stringContaining('ada@example.com'),
    });
    expect(sendSms).toHaveBeenNthCalledWith(2, {
      to: '+15550002222',
      body: expect.stringContaining('nobody@example.com'),
    });

    expect(await User.countDocuments()).toBe(1);
    expect(await Invitation.countDocuments()).toBe(0);
  });

  test('an empty invite address uses the operator email', async () => {
    process.env.INVITE_REQUEST_EMAIL = '   ';

    const res = await request(app)
      .post('/api/auth/request-invite')
      .send({ email: 'ada@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Request received' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ken@eratespecialists.com',
      text: expect.stringContaining('ada@example.com'),
    }));
    expect(sendEmail).not.toHaveBeenCalledWith(expect.objectContaining({
      to: 'ada@example.com',
    }));
    expect(await User.countDocuments()).toBe(0);
    expect(await Invitation.countDocuments()).toBe(0);
  });

  test('sms is skipped when no operator phone is set', async () => {
    delete process.env.NOTIFY_OVERRIDE_SMS;

    const res = await request(app)
      .post('/api/auth/request-invite')
      .send({ email: 'ada@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Request received' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendSms).not.toHaveBeenCalled();
    expect(await User.countDocuments()).toBe(0);
    expect(await Invitation.countDocuments()).toBe(0);
  });
});
