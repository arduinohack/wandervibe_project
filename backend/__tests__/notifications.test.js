jest.mock('../utils/sms', () => ({
  sendSms: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/email/sendEmail', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  selectedProviderName: jest.fn(() => 'console'),
}));

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const { notifyUsers } = require('../utils/notifications');
const { sendSms } = require('../utils/sms');
const { sendEmail } = require('../utils/email/sendEmail');

jest.setTimeout(30000);

let mongo;
const envSnapshot = {
  NODE_ENV: process.env.NODE_ENV,
  NOTIFY_OVERRIDE_SMS: process.env.NOTIFY_OVERRIDE_SMS,
};

async function makeUser({ sms, phoneNumber, email }) {
  return User.create({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email,
    password: 'password1',
    phoneNumber,
    notificationPreferences: { email: true, sms },
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  delete process.env.NOTIFY_OVERRIDE_SMS;
  sendSms.mockClear();
  sendEmail.mockClear();
});

afterEach(async () => {
  if (envSnapshot.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = envSnapshot.NODE_ENV;
  if (envSnapshot.NOTIFY_OVERRIDE_SMS === undefined) delete process.env.NOTIFY_OVERRIDE_SMS;
  else process.env.NOTIFY_OVERRIDE_SMS = envSnapshot.NOTIFY_OVERRIDE_SMS;
  await User.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('notifyUsers SMS', () => {
  test('production with sms enabled texts the user phone', async () => {
    const user = await makeUser({
      sms: true,
      phoneNumber: '+15551234567',
      email: 'ada-sms@example.com',
    });

    await notifyUsers([user._id], 'Your plan "Paris" has been created!');

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith({
      to: '+15551234567',
      body: 'Your plan "Paris" has been created!',
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('sms false does not text', async () => {
    const user = await makeUser({
      sms: false,
      phoneNumber: '+15551234567',
      email: 'ada-nosms@example.com',
    });

    await notifyUsers([user._id], 'You have been invited.');

    expect(sendSms).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('development without an override does not text the user phone', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NOTIFY_OVERRIDE_SMS;
    const user = await makeUser({
      sms: true,
      phoneNumber: '+15551234567',
      email: 'ada-dev@example.com',
    });

    await notifyUsers([user._id], 'You have been invited.');

    expect(sendSms).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalledWith(expect.objectContaining({ to: '+15551234567' }));
  });

  test('an email recipient with no user still uses the same mail path', async () => {
    await notifyUsers(['new.person@example.com'], 'Sign up at https://planitvibe.com/signup?email=new.person%40example.com');

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'new.person@example.com',
      subject: 'WanderVibe Update',
      text: 'Sign up at https://planitvibe.com/signup?email=new.person%40example.com',
    });
    expect(sendSms).not.toHaveBeenCalled();
    expect(await User.findOne({ email: 'new.person@example.com' })).toBeNull();
  });

  test('NOTIFY_OVERRIDE_SMS is the destination when sms is enabled', async () => {
    process.env.NODE_ENV = 'development';
    process.env.NOTIFY_OVERRIDE_SMS = ' +15550001111 ';
    const user = await makeUser({
      sms: true,
      phoneNumber: '+15551234567',
      email: 'ada-override@example.com',
    });

    await notifyUsers([user._id], 'Invite accepted.');

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith({
      to: '+15550001111',
      body: 'Invite accepted.',
    });
    expect(sendSms).not.toHaveBeenCalledWith(expect.objectContaining({ to: '+15551234567' }));
  });
});
