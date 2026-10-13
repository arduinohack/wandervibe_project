jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');

jest.setTimeout(30000);

let mongo;
let savedXaiKey;

function modelPayload(fields) {
  return {
    data: {
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(fields) }],
        },
      ],
    },
  };
}

async function registerAndLogin({ firstName, lastName, email }) {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName, lastName, email, password: 'password1' });
  await clearRegisterInvite(email);
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password1' });
  expect(loginRes.status).toBe(200);
  return {
    token: loginRes.body.token,
    userId: loginRes.body.user._id,
  };
}

async function createPlan(token) {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'trip',
      name: 'Paris',
      destination: 'Paris',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

async function acceptRole(ownerToken, memberToken, planId, email, role) {
  const inviteRes = await request(app)
    .post(`/api/plans/${planId}/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role });
  expect(inviteRes.status).toBe(201);
  const acceptRes = await request(app)
    .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
    .set('Authorization', `Bearer ${memberToken}`)
    .send({ status: 'accepted' });
  expect(acceptRes.status).toBe(200);
}

beforeAll(async () => {
  savedXaiKey = process.env.XAI_API_KEY;
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(() => {
  delete process.env.XAI_API_KEY;
});

afterEach(async () => {
  jest.restoreAllMocks();
  delete process.env.XAI_API_KEY;
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    PlanUser.deleteMany({}),
    Invitation.deleteMany({}),
    Event.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (savedXaiKey === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = savedXaiKey;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('parse confirmation', () => {
  test('a flight confirmation returns only the values in the text and saves nothing', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await createPlan(ada.token);
    const text = [
      'Thanks for booking.',
      'Confirmation code: ABC123',
      'From: JFK',
      'To: LAX',
      'Departure: 2026-07-02 08:15',
      'Arrival: 2026-07-02 11:40',
    ].join('\n');

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ text, type: 'flight' });

    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({
      bookingReference: 'ABC123',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    });
    expect(await Event.countDocuments({})).toBe(0);
  });

  test('a hotel confirmation returns the name, reference, and dates that are written', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await createPlan(ada.token);
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, grace.token, planId, 'grace@example.com', 'Collaborator');

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set('Authorization', `Bearer ${grace.token}`)
      .send({
        type: 'Hotel',
        text: [
          'Hotel: Hilton Paris',
          'Booking reference: H9981',
          'Check-in: July 2, 2026',
          'Check-out: July 5, 2026',
          'From: JFK',
        ].join('\n'),
      });

    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({
      name: 'Hilton Paris',
      bookingReference: 'H9981',
      start: '2026-07-02',
      end: '2026-07-05',
    });
    expect(parsed.body.origin).toBeUndefined();
    expect(await Event.countDocuments({})).toBe(0);
  });

  test('text with no labeled values returns an empty object', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await createPlan(ada.token);

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        text: 'Your trip to Paris starts soon. Please arrive early.',
        type: 'flight',
      });

    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({});
  });

  test('a guest is 403 and a missing token is 401', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const sam = await registerAndLogin({
      firstName: 'Sam',
      lastName: 'Guest',
      email: 'sam@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, sam.token, planId, 'sam@example.com', 'Guest');

    const denied = await request(app)
      .post('/api/activities/parse-confirmation')
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ text: 'Confirmation code: ABC123', type: 'flight' });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only Owner or Collaborator can parse a confirmation');

    const missing = await request(app)
      .post('/api/activities/parse-confirmation')
      .send({ text: 'Confirmation code: ABC123', type: 'flight' });
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');
    expect(await Event.countDocuments({})).toBe(0);
  });

  test('a flight with a model key returns only values written in the text', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await createPlan(ada.token);
    const text = [
      'Confirmation: CONF-88',
      'Booking reference: ABC123',
      'From: JFK',
      'To: LAX',
      'Departure: 2026-07-02 08:15',
      'Arrival: 2026-07-02 11:40',
    ].join('\n');
    process.env.XAI_API_KEY = 'test-key';
    const post = jest.spyOn(axios, 'post').mockResolvedValue(modelPayload({
      bookingReference: 'ABC123',
      confirmation: 'CONF-88',
      origin: 'New York',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '1999-01-01T00:00',
    }));

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ text, type: 'flight' });

    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({
      bookingReference: 'ABC123',
      confirmation: 'CONF-88',
      destination: 'LAX',
      start: '2026-07-02T08:15',
    });
    expect(parsed.body.origin).toBeUndefined();
    expect(parsed.body.end).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('https://api.x.ai/v1/responses');
    expect(post.mock.calls[0][1].model).toBe('grok-4.7');
    expect(post.mock.calls[0][1].input).toContain(text);
    expect(post.mock.calls[0][2].headers.Authorization).toBe('Bearer test-key');
    expect(await Event.countDocuments({})).toBe(0);
  });

  test('a model failure still returns the labeled parser result and saves nothing', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await createPlan(ada.token);
    const text = [
      'Confirmation code: ABC123',
      'From: JFK',
      'To: LAX',
      'Departure: 2026-07-02 08:15',
      'Arrival: 2026-07-02 11:40',
    ].join('\n');
    process.env.XAI_API_KEY = 'test-key';
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('network down'));

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ text, type: 'flight' });

    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({
      bookingReference: 'ABC123',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    });
    expect(await Event.countDocuments({})).toBe(0);
  });

  test('a hotel confirmation stays on the labeled parser when a model key is set', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await createPlan(ada.token);
    process.env.XAI_API_KEY = 'test-key';
    const post = jest.spyOn(axios, 'post');

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        type: 'hotel',
        text: [
          'Hotel: Hilton Paris',
          'Booking reference: H9981',
          'Check-in: July 2, 2026',
          'Check-out: July 5, 2026',
        ].join('\n'),
      });

    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({
      name: 'Hilton Paris',
      bookingReference: 'H9981',
      start: '2026-07-02',
      end: '2026-07-05',
    });
    expect(post).not.toHaveBeenCalled();
    expect(await Event.countDocuments({})).toBe(0);
  });
});
