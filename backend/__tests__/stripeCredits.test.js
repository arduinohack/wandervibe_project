jest.mock('stripe', () => {
  const create = jest.fn();
  const constructEvent = jest.fn();
  const client = {
    checkout: { sessions: { create } },
    webhooks: { constructEvent },
  };
  const Stripe = jest.fn(() => client);
  Stripe.__client = client;
  return Stripe;
});

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Stripe = require('stripe');
const app = require('../app');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const User = require('../models/User');
const StripeEvent = require('../models/StripeEvent');
const { getBalance } = require('../utils/aiCredits');

jest.setTimeout(30000);

const CHECKOUT = '/api/users/me/ai-credits/checkout';
const WEBHOOK = '/api/stripe/webhook';
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_123';
const PRICE_100 = 'price_credits_100';
const PRICE_500 = 'price_credits_500';

let mongo;
const previous = {
  secret: process.env.STRIPE_SECRET_KEY,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
  price100: process.env.STRIPE_PRICE_CREDITS_100,
  price500: process.env.STRIPE_PRICE_CREDITS_500,
};

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function restore(name, value) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

function sessionsCreate() {
  return Stripe.__client.checkout.sessions.create;
}

function constructEvent() {
  return Stripe.__client.webhooks.constructEvent;
}

function paidEvent(eventId, userId, credits) {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${eventId}`,
        payment_status: 'paid',
        client_reference_id: userId,
        metadata: { userId, credits: String(credits) },
      },
    },
  };
}

async function registerAndLogin(email) {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName: 'Ada', lastName: 'Lovelace', email, password: 'password1' });
  await clearRegisterInvite(email);
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password1' });
  expect(loginRes.status).toBe(200);
  return { token: loginRes.body.token, userId: loginRes.body.user._id };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_credit_pack';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_PRICE_CREDITS_100 = PRICE_100;
  process.env.STRIPE_PRICE_CREDITS_500 = PRICE_500;
  Stripe.mockClear();
  sessionsCreate().mockReset();
  constructEvent().mockReset();
});

afterEach(async () => {
  restore('STRIPE_SECRET_KEY', previous.secret);
  restore('STRIPE_WEBHOOK_SECRET', previous.webhook);
  restore('STRIPE_PRICE_CREDITS_100', previous.price100);
  restore('STRIPE_PRICE_CREDITS_500', previous.price500);
  await Promise.all([
    User.deleteMany({}),
    StripeEvent.deleteMany({}),
  ]);
});

afterAll(async () => {
  restore('STRIPE_SECRET_KEY', previous.secret);
  restore('STRIPE_WEBHOOK_SECRET', previous.webhook);
  restore('STRIPE_PRICE_CREDITS_100', previous.price100);
  restore('STRIPE_PRICE_CREDITS_500', previous.price500);
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('Stripe credit packs', () => {
  test('checkout returns a Stripe URL for 100 and 500 credits', async () => {
    const ada = await registerAndLogin('ada@example.com');
    sessionsCreate().mockResolvedValue({ url: CHECKOUT_URL });

    const missing = await request(app)
      .post(CHECKOUT)
      .send({ pack: '100' });
    expect(missing.status).toBe(401);

    const bad = await request(app)
      .post(CHECKOUT)
      .set(bearer(ada.token))
      .send({ pack: 100 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Pack must be 100 or 500');
    expect(sessionsCreate()).not.toHaveBeenCalled();

    const small = await request(app)
      .post(CHECKOUT)
      .set(bearer(ada.token))
      .send({ pack: '100' });
    expect(small.status).toBe(200);
    expect(small.body).toEqual({ url: CHECKOUT_URL });
    expect(sessionsCreate()).toHaveBeenCalledWith({
      mode: 'payment',
      line_items: [{ price: PRICE_100, quantity: 1 }],
      client_reference_id: ada.userId,
      metadata: { userId: ada.userId, credits: '100' },
      success_url: 'https://planitvibe.com/?checkout=success',
      cancel_url: 'https://planitvibe.com/?checkout=cancel',
    });
    expect(Stripe).toHaveBeenCalledWith('sk_test_credit_pack');

    const large = await request(app)
      .post(CHECKOUT)
      .set(bearer(ada.token))
      .send({ pack: '500' });
    expect(large.status).toBe(200);
    expect(large.body).toEqual({ url: CHECKOUT_URL });
    expect(sessionsCreate()).toHaveBeenLastCalledWith(expect.objectContaining({
      line_items: [{ price: PRICE_500, quantity: 1 }],
      metadata: { userId: ada.userId, credits: '500' },
    }));
    expect(await getBalance(ada.userId)).toBe(0);
  });

  test('a paid webhook grants the pack once', async () => {
    const ada = await registerAndLogin('ada@example.com');
    const event = paidEvent('evt_100', ada.userId, 100);
    constructEvent().mockReturnValue(event);

    const granted = await request(app)
      .post(WEBHOOK)
      .set('stripe-signature', 't=1,v1=test')
      .set('Content-Type', 'application/json')
      .send(event);
    expect(granted.status).toBe(200);
    expect(granted.body).toEqual({ received: true });
    expect(Buffer.isBuffer(constructEvent().mock.calls[0][0])).toBe(true);
    expect(constructEvent().mock.calls[0][1]).toBe('t=1,v1=test');
    expect(constructEvent().mock.calls[0][2]).toBe('whsec_test');
    expect(await getBalance(ada.userId)).toBe(100);

    const retry = await request(app)
      .post(WEBHOOK)
      .set('stripe-signature', 't=1,v1=test')
      .set('Content-Type', 'application/json')
      .send(event);
    expect(retry.status).toBe(200);
    expect(await getBalance(ada.userId)).toBe(100);
    expect(await StripeEvent.countDocuments({})).toBe(1);

    const bigger = paidEvent('evt_500', ada.userId, 500);
    constructEvent().mockReturnValue(bigger);
    const second = await request(app)
      .post(WEBHOOK)
      .set('stripe-signature', 't=2,v1=test')
      .set('Content-Type', 'application/json')
      .send(bigger);
    expect(second.status).toBe(200);
    expect(await getBalance(ada.userId)).toBe(600);
  });

  test('an unpaid session and a bad signature do not grant credits', async () => {
    const ada = await registerAndLogin('ada@example.com');
    const unpaid = paidEvent('evt_unpaid', ada.userId, 100);
    unpaid.data.object.payment_status = 'unpaid';
    constructEvent().mockReturnValue(unpaid);
    const skipped = await request(app)
      .post(WEBHOOK)
      .set('stripe-signature', 't=1,v1=test')
      .set('Content-Type', 'application/json')
      .send(unpaid);
    expect(skipped.status).toBe(200);
    expect(await getBalance(ada.userId)).toBe(0);
    expect(await StripeEvent.countDocuments({})).toBe(0);

    const forged = paidEvent('evt_forged', ada.userId, 999);
    constructEvent().mockReturnValue(forged);
    const ignored = await request(app)
      .post(WEBHOOK)
      .set('stripe-signature', 't=1,v1=test')
      .set('Content-Type', 'application/json')
      .send(forged);
    expect(ignored.status).toBe(200);
    expect(await getBalance(ada.userId)).toBe(0);

    constructEvent().mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const bad = await request(app)
      .post(WEBHOOK)
      .set('stripe-signature', 't=1,v1=bad')
      .set('Content-Type', 'application/json')
      .send(paidEvent('evt_bad', ada.userId, 100));
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ message: 'Invalid signature' });
    expect(await getBalance(ada.userId)).toBe(0);
  });
});
