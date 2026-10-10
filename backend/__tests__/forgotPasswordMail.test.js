jest.mock('../utils/email/sendEmail', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  selectedProviderName: jest.fn(() => 'console'),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const { sendEmail } = require('../utils/email/sendEmail');

jest.setTimeout(30000);

let mongo;
const envSnapshot = {
  NODE_ENV: process.env.NODE_ENV,
  NOTIFY_OVERRIDE_EMAIL: process.env.NOTIFY_OVERRIDE_EMAIL,
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  process.env.NOTIFY_OVERRIDE_EMAIL = 'redirect@example.com';
  sendEmail.mockClear();
});

afterEach(async () => {
  if (envSnapshot.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = envSnapshot.NODE_ENV;
  if (envSnapshot.NOTIFY_OVERRIDE_EMAIL === undefined) delete process.env.NOTIFY_OVERRIDE_EMAIL;
  else process.env.NOTIFY_OVERRIDE_EMAIL = envSnapshot.NOTIFY_OVERRIDE_EMAIL;
  await User.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('forgot-password mail', () => {
  test('sends PlanItVibe to the account email through sendEmail', async () => {
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: 'password1',
      });
    expect(registerRes.status).toBe(201);

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.msg).toBe('If the email exists, a reset link has been sent');

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('ada@example.com');
    expect(message.to).not.toBe('redirect@example.com');
    expect(message.to).not.toBe('w.ken.allen@gmail.com');
    expect(message.from).toBeUndefined();
    expect(message.subject).toContain('PlanItVibe');
    expect(message.text).toContain('PlanItVibe');
    expect(message.html).toContain('PlanItVibe');
    expect(message.text).toContain('reset-password?token=');
    expect(message.text).toContain('email=ada@example.com');
  });

  test('an unknown email does not send mail', async () => {
    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'missing@example.com' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.msg).toBe('If the email exists, a reset link has been sent');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
