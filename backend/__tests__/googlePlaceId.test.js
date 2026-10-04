jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');

jest.setTimeout(30000);

const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const OTHER_PLACE_ID = 'ChIJN1t_tDeuEWoR7Lv2_1Q9A';

let mongo;

async function registerAndLogin(email) {
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName: 'Ada', lastName: 'Lovelace', email, password: 'password1' });
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password1' });
  expect(loginRes.status).toBe(200);
  return { token: loginRes.body.token, userId: loginRes.body.user && loginRes.body.user._id };
}

async function createPlan(token) {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'trip',
      name: 'Paris',
      destination: 'Paris',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-10T00:00:00.000Z',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

function storedPlaceId(doc) {
  if (!doc || doc.googlePlaceId == null) return '';
  return doc.googlePlaceId;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    PlanUser.deleteMany({}),
    Invitation.deleteMany({}),
    Event.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('googlePlaceId', () => {
  test('create saves a Place ID and blank values do not', async () => {
    const { token } = await registerAndLogin('place-create@example.com');
    const planId = await createPlan(token);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Opera',
        type: 'attraction',
        planId,
        location: 'Sydney Opera House',
        googlePlaceId: `  ${PLACE_ID}  `,
      });
    expect(created.status).toBe(201);
    expect(created.body.googlePlaceId).toBe(PLACE_ID);
    expect(created.body.location).toBe('Sydney Opera House');
    expect(created.body.urlLinks || []).toEqual([]);
    const saved = await Event.findById(created.body._id).lean();
    expect(saved.googlePlaceId).toBe(PLACE_ID);
    expect(saved.location).toBe('Sydney Opera House');

    const missing = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Walk', type: 'tour', planId, location: 'River' });
    expect(missing.status).toBe(201);
    expect(storedPlaceId(missing.body)).toBe('');
    expect(storedPlaceId(await Event.findById(missing.body._id).lean())).toBe('');

    const empty = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cafe', type: 'dining', planId, googlePlaceId: '' });
    expect(empty.status).toBe(201);
    expect(storedPlaceId(await Event.findById(empty.body._id).lean())).toBe('');

    const spaces = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Park', type: 'tour', planId, googlePlaceId: '   ' });
    expect(spaces.status).toBe(201);
    const spacesDoc = await Event.findById(spaces.body._id).lean();
    expect(storedPlaceId(spacesDoc)).toBe('');
    expect(spacesDoc.googlePlaceId).not.toBe('   ');
  });

  test('update can set, replace, and clear a Place ID', async () => {
    const { token } = await registerAndLogin('place-update@example.com');
    const planId = await createPlan(token);
    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Museum', type: 'attraction', planId, location: 'Louvre' });
    expect(created.status).toBe(201);

    const set = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ googlePlaceId: PLACE_ID });
    expect(set.status).toBe(200);
    expect(set.body.googlePlaceId).toBe(PLACE_ID);
    expect(set.body.location).toBe('Louvre');

    const replaced = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ googlePlaceId: OTHER_PLACE_ID });
    expect(replaced.status).toBe(200);
    expect(replaced.body.googlePlaceId).toBe(OTHER_PLACE_ID);

    const cleared = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ googlePlaceId: '   ' });
    expect(cleared.status).toBe(200);
    const clearedDoc = await Event.findById(created.body._id).lean();
    expect(storedPlaceId(clearedDoc)).toBe('');
    expect(clearedDoc.googlePlaceId).not.toBe('   ');
    expect(clearedDoc.location).toBe('Louvre');
  });

  test('a type change keeps googlePlaceId when the body does not send one', async () => {
    const { token } = await registerAndLogin('place-type@example.com');
    const planId = await createPlan(token);
    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        location: 'Bistro',
        googlePlaceId: PLACE_ID,
      });
    expect(created.status).toBe(201);

    const changed = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'hotel' });
    expect(changed.status).toBe(200);
    expect(changed.body.type).toBe('hotel');
    expect(changed.body.googlePlaceId).toBe(PLACE_ID);
    expect(changed.body.location).toBe('Bistro');

    const replaced = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'tour', googlePlaceId: OTHER_PLACE_ID });
    expect(replaced.status).toBe(200);
    expect(replaced.body.type).toBe('tour');
    expect(replaced.body.googlePlaceId).toBe(OTHER_PLACE_ID);
  });

  test('a guest cannot create or update an activity with a Place ID', async () => {
    const ada = await registerAndLogin('place-owner@example.com');
    const grace = await registerAndLogin('place-guest@example.com');
    const planId = await createPlan(ada.token);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Museum',
        type: 'attraction',
        planId,
        googlePlaceId: PLACE_ID,
      });
    expect(created.status).toBe(201);

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'place-guest@example.com', role: 'Guest' });
    expect(inviteRes.status).toBe(201);
    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    const before = await Event.countDocuments({ planId });
    const deniedCreate = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${grace.token}`)
      .send({
        name: 'Guest stop',
        type: 'tour',
        planId,
        googlePlaceId: OTHER_PLACE_ID,
      });
    expect(deniedCreate.status).toBe(403);
    expect(await Event.countDocuments({ planId })).toBe(before);

    const deniedUpdate = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ googlePlaceId: OTHER_PLACE_ID });
    expect(deniedUpdate.status).toBe(403);
    const stored = await Event.findById(created.body._id).lean();
    expect(stored.googlePlaceId).toBe(PLACE_ID);
    expect(stored.name).toBe('Museum');
  });
});
