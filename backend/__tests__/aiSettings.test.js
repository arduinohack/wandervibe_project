jest.mock('axios', () => ({
  post: jest.fn(),
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
const { SEARCH_URL, XAI_ENDPOINT } = require('../utils/placeSuggest');

jest.setTimeout(30000);

const SECRET = '0123456789abcdef0123456789abcdef';
const USER_KEY = 'user-xai-key-9f3c2a7b-do-not-echo';
const SERVER_KEY = 'server-xai-key-should-be-fallback';
const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const SETTINGS = '/api/users/me/ai-settings';

let mongo;
const previousXai = process.env.XAI_API_KEY;
const previousSecret = process.env.AI_KEY_ENCRYPTION_SECRET;
const previousGoogle = process.env.GOOGLE_MAPS_API_KEY;

function modelPayload(fields) {
  return {
    status: 200,
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

function googleOk() {
  return {
    status: 200,
    data: {
      places: [
        {
          id: PLACE_ID,
          displayName: { text: 'Cafe Paris' },
          formattedAddress: 'Paris, France',
          rating: 4.6,
          userRatingCount: 120,
          priceLevel: 'PRICE_LEVEL_MODERATE',
          types: ['restaurant', 'food'],
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
  const userId = loginRes.body.user._id;
  await User.updateOne({ _id: userId }, { $set: { aiCredits: 20 } });
  return {
    token: loginRes.body.token,
    userId,
    email,
  };
}

async function createPlan(token) {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'trip',
      name: 'Paris trip',
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

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function xaiCalls() {
  return axios.post.mock.calls.filter((call) => call[0] === XAI_ENDPOINT);
}

function bearer(call) {
  return call && call[2] && call[2].headers && call[2].headers.Authorization;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(() => {
  process.env.AI_KEY_ENCRYPTION_SECRET = SECRET;
  delete process.env.XAI_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  axios.post.mockReset();
  axios.get.mockReset();
});

afterEach(async () => {
  if (previousXai == null) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = previousXai;
  if (previousSecret == null) delete process.env.AI_KEY_ENCRYPTION_SECRET;
  else process.env.AI_KEY_ENCRYPTION_SECRET = previousSecret;
  if (previousGoogle == null) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = previousGoogle;
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    PlanUser.deleteMany({}),
    Invitation.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (previousXai == null) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = previousXai;
  if (previousSecret == null) delete process.env.AI_KEY_ENCRYPTION_SECRET;
  else process.env.AI_KEY_ENCRYPTION_SECRET = previousSecret;
  if (previousGoogle == null) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = previousGoogle;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('AI settings', () => {
  test('a logged-in user can save a key and GET hides it', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-ai@example.com',
    });

    const saved = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ aiProvider: 'xai', hasKey: true });
    expect(Object.keys(saved.body).sort()).toEqual(['aiProvider', 'hasKey']);
    expect(JSON.stringify(saved.body)).not.toContain(USER_KEY);

    const found = await request(app)
      .get(SETTINGS)
      .set(authHeader(ada.token));
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ aiProvider: 'xai', hasKey: true });
    expect(JSON.stringify(found.body)).not.toContain(USER_KEY);
    expect(found.body.apiKey).toBeUndefined();
    expect(found.body.aiApiKeyEncrypted).toBeUndefined();

    const stored = await User.findById(ada.userId).select('+aiApiKeyEncrypted').lean();
    expect(stored.aiProvider).toBe('xai');
    expect(stored.aiApiKeyEncrypted).toEqual(expect.any(String));
    expect(stored.aiApiKeyEncrypted).not.toBe(USER_KEY);
    expect(stored.aiApiKeyEncrypted).not.toContain(USER_KEY);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: ada.email, password: 'password1' });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toContain(USER_KEY);
    expect(login.body.user.aiApiKeyEncrypted).toBeUndefined();
  });

  test('a blank key clears the stored key and whitespace does too', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-ai-clear@example.com',
    });
    const saved = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    expect(saved.body.hasKey).toBe(true);

    const cleared = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: '   ' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ aiProvider: 'xai', hasKey: false });

    const again = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    expect(again.body.hasKey).toBe(true);

    const missing = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'none' });
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual({ aiProvider: 'none', hasKey: false });

    const stored = await User.findById(ada.userId).select('+aiApiKeyEncrypted').lean();
    expect(stored.aiApiKeyEncrypted == null || stored.aiApiKeyEncrypted === '').toBe(true);
    const found = await request(app).get(SETTINGS).set(authHeader(ada.token));
    expect(found.body).toEqual({ aiProvider: 'none', hasKey: false });
  });

  test('each user sees only their own settings', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-ai-own@example.com',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace-ai-own@example.com',
    });
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });

    const graceSettings = await request(app).get(SETTINGS).set(authHeader(grace.token));
    expect(graceSettings.body).toEqual({ aiProvider: 'none', hasKey: false });
    expect(JSON.stringify(graceSettings.body)).not.toContain(USER_KEY);
  });

  test('a guest can save their own key', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-ai-guest@example.com',
    });
    const planId = await createPlan(ada.token);
    const gus = await registerAndLogin({
      firstName: 'Gus',
      lastName: 'Guest',
      email: 'gus-ai@example.com',
    });
    await acceptRole(ada.token, gus.token, planId, 'gus-ai@example.com', 'Guest');

    const saved = await request(app)
      .put(SETTINGS)
      .set(authHeader(gus.token))
      .send({ aiProvider: 'openai', apiKey: USER_KEY });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ aiProvider: 'openai', hasKey: true });
    expect(JSON.stringify(saved.body)).not.toContain(USER_KEY);
  });

  test('invalid provider is rejected and does not replace a saved key', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-ai-bad@example.com',
    });
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });

    const bad = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'claude', apiKey: 'other-key-should-not-store' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Provider must be xai, openai, anthropic, gemini, or none');
    expect(JSON.stringify(bad.body)).not.toContain('other-key-should-not-store');

    const typed = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: 42 });
    expect(typed.status).toBe(400);
    expect(typed.body.message).toBe('API key must be text');

    const found = await request(app).get(SETTINGS).set(authHeader(ada.token));
    expect(found.body).toEqual({ aiProvider: 'xai', hasKey: true });
    const stored = await User.findById(ada.userId).select('+aiApiKeyEncrypted').lean();
    expect(stored.aiApiKeyEncrypted).not.toContain('other-key-should-not-store');
  });

  test('a missing or short encryption secret rejects a key save', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-ai-secret@example.com',
    });
    delete process.env.AI_KEY_ENCRYPTION_SECRET;

    const missing = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    expect(missing.status).toBe(500);
    expect(missing.body.message).toBe('AI key encryption is not configured');
    expect(JSON.stringify(missing.body)).not.toContain(USER_KEY);

    process.env.AI_KEY_ENCRYPTION_SECRET = 'too-short';
    const short = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    expect(short.status).toBe(500);
    expect(short.body.message).toBe('AI key encryption is not configured');

    const stored = await User.findById(ada.userId).select('+aiApiKeyEncrypted').lean();
    expect(stored.aiApiKeyEncrypted == null || stored.aiApiKeyEncrypted === '').toBe(true);

    const anon = await request(app).get(SETTINGS);
    expect(anon.status).toBe(401);
    const anonPut = await request(app).put(SETTINGS).send({ aiProvider: 'xai', apiKey: USER_KEY });
    expect(anonPut.status).toBe(401);
    expect(JSON.stringify(anonPut.body)).not.toContain(USER_KEY);
  });

  test('clearing a key still works when the encryption secret is missing', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-ai-clear-secret@example.com',
    });
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    delete process.env.AI_KEY_ENCRYPTION_SECRET;

    const blocked = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'openai', apiKey: 'replacement-key' });
    expect(blocked.status).toBe(500);
    const still = await request(app).get(SETTINGS).set(authHeader(ada.token));
    expect(still.body).toEqual({ aiProvider: 'xai', hasKey: true });

    const cleared = await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'none', apiKey: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ aiProvider: 'none', hasKey: false });
  });
});

describe('confirmation paste uses the user key', () => {
  const text = [
    'Confirmation: CONF-88',
    'Booking reference: ABC123',
    'From: JFK',
    'To: LAX',
    'Departure: 2026-07-02 08:15',
    'Arrival: 2026-07-02 11:40',
  ].join('\n');

  async function owner() {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: `ada-paste-${Date.now()}@example.com`,
    });
    await createPlan(ada.token);
    return ada;
  }

  function paste(token) {
    return request(app)
      .post('/api/activities/parse-confirmation')
      .set(authHeader(token))
      .send({ text, type: 'flight' });
  }

  test('paste prefers the user key when one is saved', async () => {
    process.env.XAI_API_KEY = SERVER_KEY;
    const ada = await owner();
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    axios.post.mockResolvedValue(modelPayload({
      bookingReference: 'ABC123',
      confirmation: 'CONF-88',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    }));

    const parsed = await paste(ada.token);
    expect(parsed.status).toBe(200);
    expect(parsed.body.confirmation).toBe('CONF-88');
    expect(xaiCalls()).toHaveLength(1);
    expect(bearer(xaiCalls()[0])).toBe(`Bearer ${USER_KEY}`);
    expect(JSON.stringify(axios.post.mock.calls)).not.toContain(SERVER_KEY);
  });

  test('paste uses the server key when the user has no key', async () => {
    process.env.XAI_API_KEY = SERVER_KEY;
    const ada = await owner();
    axios.post.mockResolvedValue(modelPayload({
      bookingReference: 'ABC123',
      confirmation: 'CONF-88',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    }));

    const parsed = await paste(ada.token);
    expect(parsed.status).toBe(200);
    expect(bearer(xaiCalls()[0])).toBe(`Bearer ${SERVER_KEY}`);
  });

  test('clearing the key returns paste to the server key', async () => {
    process.env.XAI_API_KEY = SERVER_KEY;
    const ada = await owner();
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai' });
    axios.post.mockResolvedValue(modelPayload({
      bookingReference: 'ABC123',
      confirmation: 'CONF-88',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    }));

    const parsed = await paste(ada.token);
    expect(parsed.status).toBe(200);
    expect(bearer(xaiCalls()[0])).toBe(`Bearer ${SERVER_KEY}`);
  });

  test('no user key and no server key uses the labeled parser', async () => {
    const ada = await owner();
    const parsed = await paste(ada.token);
    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({
      bookingReference: 'CONF-88',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    });
    expect(xaiCalls()).toHaveLength(0);
  });

  test('a non-xAI provider does not call xAI with that key', async () => {
    process.env.XAI_API_KEY = SERVER_KEY;
    const ada = await owner();
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'openai', apiKey: USER_KEY });
    axios.post.mockResolvedValue(modelPayload({ confirmation: 'CONF-88' }));

    const parsed = await paste(ada.token);
    expect(parsed.status).toBe(200);
    expect(parsed.body.bookingReference).toBe('CONF-88');
    expect(parsed.body.origin).toBe('JFK');
    expect(parsed.body.confirmation).toBeUndefined();
    expect(xaiCalls()).toHaveLength(0);
    expect(JSON.stringify(axios.post.mock.calls)).not.toContain(USER_KEY);
    expect(JSON.stringify(axios.post.mock.calls)).not.toContain(SERVER_KEY);
  });
});

describe('place suggest uses the user key for summaries', () => {
  function suggestMocks() {
    axios.get.mockResolvedValue({ status: 200, data: { results: [] } });
    axios.post.mockImplementation(async (url) => {
      if (url === XAI_ENDPOINT) {
        return {
          status: 200,
          data: {
            output_text: JSON.stringify({
              textQuery: 'small cafe in Paris',
              summaries: [{ placeId: PLACE_ID, summary: 'A small cafe in Paris.' }],
            }),
          },
        };
      }
      return googleOk();
    });
  }

  async function owner(email) {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email,
    });
    const planId = await createPlan(ada.token);
    return { ada, planId };
  }

  function suggest(token, planId) {
    return request(app)
      .post(`/api/plans/${planId}/suggest`)
      .set(authHeader(token))
      .send({ query: 'somewhere quiet for coffee', activityType: 'dining' });
  }

  test('summaries prefer the user key and the Places list stays the same shape', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.XAI_API_KEY = SERVER_KEY;
    suggestMocks();
    const { ada, planId } = await owner('ada-suggest-userkey@example.com');
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });

    const found = await suggest(ada.token, planId);
    expect(found.status).toBe(200);
    expect(Array.isArray(found.body)).toBe(true);
    expect(found.body[0].placeId).toBe(PLACE_ID);
    expect(found.body[0].name).toBe('Cafe Paris');
    expect(found.body[0].summary).toBe('A small cafe in Paris.');
    expect(xaiCalls().length).toBeGreaterThan(0);
    for (const call of xaiCalls()) {
      expect(bearer(call)).toBe(`Bearer ${USER_KEY}`);
    }
    const placesCall = axios.post.mock.calls.find((call) => call[0] === SEARCH_URL);
    expect(placesCall[2].headers['X-Goog-Api-Key']).toBe('maps-key');
    expect(JSON.stringify(placesCall[2].headers)).not.toContain(USER_KEY);
    expect(JSON.stringify(found.body)).not.toContain(USER_KEY);
  });

  test('suggest uses the server key when the user key is absent', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.XAI_API_KEY = SERVER_KEY;
    suggestMocks();
    const { ada, planId } = await owner('ada-suggest-serverkey@example.com');

    const found = await suggest(ada.token, planId);
    expect(found.status).toBe(200);
    expect(found.body[0].summary).toBe('A small cafe in Paris.');
    for (const call of xaiCalls()) {
      expect(bearer(call)).toBe(`Bearer ${SERVER_KEY}`);
    }
  });

  test('clearing the key returns suggest to the server key', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.XAI_API_KEY = SERVER_KEY;
    suggestMocks();
    const { ada, planId } = await owner('ada-suggest-clearkey@example.com');
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: '' });

    const found = await suggest(ada.token, planId);
    expect(found.status).toBe(200);
    expect(found.body[0].summary).toBe('A small cafe in Paris.');
    for (const call of xaiCalls()) {
      expect(bearer(call)).toBe(`Bearer ${SERVER_KEY}`);
    }
  });

  test('no key still returns the Places list', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    suggestMocks();
    const { ada, planId } = await owner('ada-suggest-nokey@example.com');

    const found = await suggest(ada.token, planId);
    expect(found.status).toBe(200);
    expect(found.body[0].name).toBe('Cafe Paris');
    expect(found.body[0].summary).toBeUndefined();
    expect(xaiCalls()).toHaveLength(0);
    expect(axios.post.mock.calls.some((call) => call[0] === SEARCH_URL)).toBe(true);
  });

  test('a model failure still returns the Places list', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    const { ada, planId } = await owner('ada-suggest-modelfail@example.com');
    await request(app)
      .put(SETTINGS)
      .set(authHeader(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    axios.get.mockResolvedValue({ status: 200, data: { results: [] } });
    axios.post.mockImplementation(async (url) => {
      if (url === XAI_ENDPOINT) throw new Error('model down');
      return googleOk();
    });

    const found = await suggest(ada.token, planId);
    expect(found.status).toBe(200);
    expect(found.body[0].placeId).toBe(PLACE_ID);
    expect(found.body[0].summary).toBeUndefined();
    expect(JSON.stringify(found.body)).not.toContain(USER_KEY);
  });
});
