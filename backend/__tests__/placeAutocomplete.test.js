jest.mock('axios', () => ({
  get: jest.fn(),
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
const { AUTOCOMPLETE_URL } = require('../utils/placeAutocomplete');

jest.setTimeout(30000);

let mongo;
const previousKey = process.env.GOOGLE_MAPS_API_KEY;
const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';

function googleOk() {
  return {
    status: 200,
    data: {
      status: 'OK',
      predictions: [
        {
          description: 'Cafe Paris, Paris, France',
          place_id: PLACE_ID,
          structured_formatting: {
            main_text: 'Cafe Paris',
            secondary_text: 'Paris, France',
          },
        },
        {
          description: 'Skipped',
          place_id: '   ',
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
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  axios.get.mockReset();
  if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = previousKey;
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    PlanUser.deleteMany({}),
    Invitation.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = previousKey;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('GET /api/places/autocomplete', () => {
  test('autocomplete returns places when the key is present', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    axios.get.mockResolvedValue(googleOk());
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-places@example.com',
    });
    await createPlan(ada.token);
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace-places@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(
      ada.token,
      grace.token,
      planId,
      'grace-places@example.com',
      'Collaborator',
    );

    const found = await request(app)
      .get('/api/places/autocomplete')
      .query({ q: 'Cafe Paris' })
      .set('Authorization', `Bearer ${grace.token}`);

    expect(found.status).toBe(200);
    expect(found.body).toEqual([
      {
        placeId: PLACE_ID,
        name: 'Cafe Paris',
        address: 'Paris, France',
      },
    ]);
    expect(axios.get).toHaveBeenCalledTimes(1);
    const url = axios.get.mock.calls[0][0];
    expect(url.startsWith(`${AUTOCOMPLETE_URL}?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('input')).toBe('Cafe Paris');
    expect(params.get('key')).toBe('test-key');
    expect(JSON.stringify(found.body)).not.toContain('test-key');
  });

  test('a missing key returns a clear error and does not call Google', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-nokey@example.com',
    });
    await createPlan(ada.token);

    const missing = await request(app)
      .get('/api/places/autocomplete')
      .query({ q: 'Cafe' })
      .set('Authorization', `Bearer ${ada.token}`);

    expect(missing.status).toBe(503);
    expect(missing.body.message).toBe('Google Maps is not configured');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a guest cannot search places', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-guest-places@example.com',
    });
    const planId = await createPlan(ada.token);
    const gus = await registerAndLogin({
      firstName: 'Gus',
      lastName: 'Guest',
      email: 'gus-places@example.com',
    });
    await acceptRole(ada.token, gus.token, planId, 'gus-places@example.com', 'Guest');

    const denied = await request(app)
      .get('/api/places/autocomplete')
      .query({ q: 'Cafe' })
      .set('Authorization', `Bearer ${gus.token}`);

    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only Owner or Collaborator can search places');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('no token is 401', async () => {
    const missing = await request(app)
      .get('/api/places/autocomplete')
      .query({ q: 'Cafe' });

    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');
    expect(axios.get).not.toHaveBeenCalled();
  });
});
