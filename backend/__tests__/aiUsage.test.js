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
const AiUsage = require('../models/AiUsage');
const { SEARCH_URL } = require('../utils/placeSuggest');

jest.setTimeout(30000);

const SECRET = '0123456789abcdef0123456789abcdef';
const USER_KEY = 'user-xai-key-9f3c2a7b-do-not-echo';
const SERVER_KEY = 'server-xai-key-should-be-fallback';
const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const SETTINGS = '/api/users/me/ai-settings';
const PASTE_TEXT = [
  'Confirmation: CONF-88',
  'Booking reference: ABC123',
  'From: JFK',
  'To: LAX',
  'Departure: 2026-07-02 08:15',
  'Arrival: 2026-07-02 11:40',
].join('\n');

let mongo;
const previousXai = process.env.XAI_API_KEY;
const previousSecret = process.env.AI_KEY_ENCRYPTION_SECRET;
const previousGoogle = process.env.GOOGLE_MAPS_API_KEY;

function modelPayload(fields, usage) {
  const data = {
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(fields) }],
      },
    ],
  };
  if (usage) data.usage = usage;
  return { status: 200, data };
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

function suggestPayload(usage) {
  const data = {
    output_text: JSON.stringify({
      textQuery: 'small cafe in Paris',
      summaries: [{ placeId: PLACE_ID, summary: 'A small cafe in Paris.' }],
    }),
  };
  if (usage) data.usage = usage;
  return { status: 200, data };
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
  const userId = loginRes.body.user._id;
  await User.updateOne({ _id: userId }, { $set: { aiCredits: 20 } });
  return { token: loginRes.body.token, userId };
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

function auth(token) {
  return { Authorization: `Bearer ${token}` };
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
  jest.restoreAllMocks();
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
    AiUsage.deleteMany({}),
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

describe('AI usage', () => {
  test('indexes are by user and feature, newest first', () => {
    const fields = AiUsage.schema.indexes().map((entry) => entry[0]);
    expect(fields).toEqual(expect.arrayContaining([
      { userId: 1, createdAt: -1 },
      { feature: 1, createdAt: -1 },
    ]));
  });

  test('a successful paste stores one usage row and hides the key', async () => {
    process.env.XAI_API_KEY = SERVER_KEY;
    const ada = await registerAndLogin('ada-usage-paste@example.com');
    await createPlan(ada.token);
    await request(app)
      .put(SETTINGS)
      .set(auth(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });
    axios.post.mockResolvedValue(modelPayload({
      bookingReference: 'ABC123',
      confirmation: 'CONF-88',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    }, {
      input_tokens: 11,
      output_tokens: 4,
      total_tokens: 15,
    }));

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set(auth(ada.token))
      .send({ text: PASTE_TEXT, type: 'flight' });

    expect(parsed.status).toBe(200);
    expect(parsed.body.confirmation).toBe('CONF-88');
    expect(JSON.stringify(parsed.body)).not.toContain(USER_KEY);
    const rows = await AiUsage.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ada.userId);
    expect(rows[0].feature).toBe('paste');
    expect(rows[0].provider).toBe('xai');
    expect(rows[0].usedUserKey).toBe(true);
    expect(rows[0].model).toBe('grok-4.7');
    expect(rows[0].success).toBe(true);
    expect(rows[0].inputTokens).toBe(11);
    expect(rows[0].outputTokens).toBe(4);
    expect(rows[0].totalTokens).toBe(15);
    expect(rows[0].error).toBeUndefined();
    expect(rows[0].planId).toBeUndefined();
    expect(JSON.stringify(rows[0])).not.toContain(USER_KEY);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  test('a failed paste stores one usage row and still returns the parser', async () => {
    process.env.XAI_API_KEY = SERVER_KEY;
    const ada = await registerAndLogin('ada-usage-paste-fail@example.com');
    await createPlan(ada.token);
    axios.post.mockRejectedValue(new Error(`network down ${SERVER_KEY}`));

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set(auth(ada.token))
      .send({ text: PASTE_TEXT, type: 'flight' });

    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({
      bookingReference: 'CONF-88',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    });
    const rows = await AiUsage.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ada.userId);
    expect(rows[0].feature).toBe('paste');
    expect(rows[0].provider).toBe('server');
    expect(rows[0].usedUserKey).toBe(false);
    expect(rows[0].model).toBe('grok-4.7');
    expect(rows[0].success).toBe(false);
    expect(rows[0].inputTokens).toBeNull();
    expect(rows[0].outputTokens).toBeNull();
    expect(rows[0].totalTokens).toBeNull();
    expect(rows[0].error).toBe('network down [redacted]');
    expect(rows[0].error).not.toContain(SERVER_KEY);
  });

  test('a usage insert failure does not change the paste response', async () => {
    process.env.XAI_API_KEY = SERVER_KEY;
    const ada = await registerAndLogin('ada-usage-insert-fail@example.com');
    await createPlan(ada.token);
    axios.post.mockResolvedValue(modelPayload({
      bookingReference: 'ABC123',
      confirmation: 'CONF-88',
      origin: 'JFK',
      destination: 'LAX',
      start: '2026-07-02T08:15',
      end: '2026-07-02T11:40',
    }));
    const create = jest.spyOn(AiUsage, 'create').mockRejectedValue(new Error('usage db down'));

    const parsed = await request(app)
      .post('/api/activities/parse-confirmation')
      .set(auth(ada.token))
      .send({ text: PASTE_TEXT, type: 'flight' });

    expect(create).toHaveBeenCalled();
    expect(parsed.status).toBe(200);
    expect(parsed.body.confirmation).toBe('CONF-88');
    expect(parsed.body.origin).toBe('JFK');
    expect(await AiUsage.countDocuments({})).toBe(0);
  });

  test('suggest summary usage records the user key, and a skipped call records nothing', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.XAI_API_KEY = SERVER_KEY;
    axios.get.mockResolvedValue({ status: 200, data: { results: [] } });
    axios.post.mockImplementation(async (url) => {
      if (url === SEARCH_URL) return googleOk();
      return suggestPayload({
        input_tokens: 20,
        output_tokens: 6,
        total_tokens: 26,
      });
    });
    const ada = await registerAndLogin('ada-usage-suggest@example.com');
    const planId = await createPlan(ada.token);
    await request(app)
      .put(SETTINGS)
      .set(auth(ada.token))
      .send({ aiProvider: 'xai', apiKey: USER_KEY });

    const found = await request(app)
      .post(`/api/plans/${planId}/suggest`)
      .set(auth(ada.token))
      .send({ query: 'somewhere quiet for coffee', activityType: 'dining' });

    expect(found.status).toBe(200);
    expect(Array.isArray(found.body)).toBe(true);
    expect(found.body[0].placeId).toBe(PLACE_ID);
    expect(found.body[0].summary).toBe('A small cafe in Paris.');
    expect(JSON.stringify(found.body)).not.toContain(USER_KEY);
    const rows = await AiUsage.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ada.userId);
    expect(rows[0].planId).toBe(planId);
    expect(rows[0].feature).toBe('suggest');
    expect(rows[0].provider).toBe('xai');
    expect(rows[0].usedUserKey).toBe(true);
    expect(rows[0].model).toBe('grok-4.7');
    expect(rows[0].success).toBe(true);
    expect(rows[0].inputTokens).toBe(20);
    expect(rows[0].outputTokens).toBe(6);
    expect(rows[0].totalTokens).toBe(26);
    expect(JSON.stringify(rows[0])).not.toContain(USER_KEY);

    await AiUsage.deleteMany({});
    axios.post.mockReset();
    axios.get.mockResolvedValue({ status: 200, data: { results: [] } });
    axios.post.mockResolvedValue(googleOk());
    delete process.env.XAI_API_KEY;
    await request(app)
      .put(SETTINGS)
      .set(auth(ada.token))
      .send({ aiProvider: 'none' });

    const skipped = await request(app)
      .post(`/api/plans/${planId}/suggest`)
      .set(auth(ada.token))
      .send({ query: 'cafe' });
    expect(skipped.status).toBe(200);
    expect(skipped.body[0].name).toBe('Cafe Paris');
    expect(skipped.body[0].summary).toBeUndefined();
    expect(await AiUsage.countDocuments({})).toBe(0);

    process.env.XAI_API_KEY = SERVER_KEY;
    await request(app)
      .put(SETTINGS)
      .set(auth(ada.token))
      .send({ aiProvider: 'openai', apiKey: USER_KEY });
    const other = await request(app)
      .post(`/api/plans/${planId}/suggest`)
      .set(auth(ada.token))
      .send({ query: 'cafe' });
    expect(other.status).toBe(200);
    expect(other.body[0].placeId).toBe(PLACE_ID);
    expect(await AiUsage.countDocuments({})).toBe(0);
  });

  test('a failed suggest summary is recorded and the Places list is unchanged', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.XAI_API_KEY = SERVER_KEY;
    axios.get.mockResolvedValue({ status: 200, data: { results: [] } });
    axios.post.mockImplementation(async (url) => {
      if (url === SEARCH_URL) return googleOk();
      throw new Error('model down');
    });
    const ada = await registerAndLogin('ada-usage-suggest-fail@example.com');
    const planId = await createPlan(ada.token);

    const found = await request(app)
      .post(`/api/plans/${planId}/suggest`)
      .set(auth(ada.token))
      .send({ query: 'cafe' });

    expect(found.status).toBe(200);
    expect(found.body[0].placeId).toBe(PLACE_ID);
    expect(found.body[0].summary).toBeUndefined();
    const rows = await AiUsage.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ada.userId);
    expect(rows[0].planId).toBe(planId);
    expect(rows[0].feature).toBe('suggest');
    expect(rows[0].provider).toBe('server');
    expect(rows[0].usedUserKey).toBe(false);
    expect(rows[0].success).toBe(false);
    expect(rows[0].error).toBe('model down');
    expect(rows[0].inputTokens).toBeNull();
  });
});
