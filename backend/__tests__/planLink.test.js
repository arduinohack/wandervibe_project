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

let mongo;

const windowStart = '2026-07-01T00:00:00.000Z';
const windowEnd = '2026-07-08T23:59:59.999Z';

async function registerAndLogin({ firstName, lastName, email }) {
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName, lastName, email, password: 'password1' });
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

async function addActivity(token, planId, name, startTime) {
  const res = await request(app)
    .post('/api/activities')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name,
      type: 'dining',
      planId,
      location: 'Cafe',
      startTime,
      endTime: startTime,
    });
  expect(res.status).toBe(201);
  return res.body._id;
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

describe('personal plan link', () => {
  test('a guest links a personal plan and sees source activities in the window', async () => {
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
    const insideId = await addActivity(ada.token, planId, 'Lunch', '2026-07-02T12:00:00.000Z');
    const outsideId = await addActivity(ada.token, planId, 'August dinner', '2026-08-01T12:00:00.000Z');
    const sourceActivities = await Event.countDocuments({ planId });
    const sourceMembers = await PlanUser.countDocuments({ planId });

    const linked = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ start: windowStart, end: windowEnd });
    expect(linked.status).toBe(201);
    const personal = linked.body.plan;
    expect(personal.ownerId).toBe(sam.userId);
    expect(personal.sourcePlanId).toBe(planId);
    expect(new Date(personal.linkStart).toISOString()).toBe(windowStart);
    expect(new Date(personal.linkEnd).toISOString()).toBe(windowEnd);
    expect(personal.name).toBe('My Paris');
    expect(await Event.countDocuments({ planId })).toBe(sourceActivities);
    expect(await PlanUser.countDocuments({ planId })).toBe(sourceMembers);
    expect(await Event.countDocuments({ planId: personal._id })).toBe(0);
    const personalMembers = await PlanUser.find({ planId: personal._id });
    expect(personalMembers).toHaveLength(1);
    expect(personalMembers[0].userId).toBe(sam.userId);
    expect(personalMembers[0].role).toBe('Owner');
    const source = await Plan.findById(planId);
    expect(source.name).toBe('Paris');
    expect(source.ownerId).toBe(ada.userId);

    const ownId = await addActivity(sam.token, personal._id, 'Early note', '2026-06-01T08:00:00.000Z');
    const itinerary = await request(app)
      .get(`/api/plans/${personal._id}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(itinerary.status).toBe(200);
    const rows = itinerary.body.events;
    expect(rows.map((row) => row._id)).toEqual([ownId, insideId]);
    expect(rows[0].linked).toBe(false);
    expect(rows[0].name).toBe('Early note');
    expect(rows[1].linked).toBe(true);
    expect(rows[1].name).toBe('Lunch');
    expect(rows.some((row) => row._id === outsideId)).toBe(false);

    await request(app)
      .put(`/api/activities/${insideId}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ name: 'Lunch revised' });
    const reloaded = await request(app)
      .get(`/api/plans/${personal._id}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    const lunch = reloaded.body.events.find((row) => row._id === insideId);
    expect(lunch.name).toBe('Lunch revised');
    expect(lunch.linked).toBe(true);
    expect(await Event.findById(insideId)).toMatchObject({ planId, name: 'Lunch revised' });

    const renamed = await request(app)
      .put(`/api/activities/${ownId}`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ name: 'My early note' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('My early note');

    const blocked = await request(app)
      .put(`/api/activities/${insideId}`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ name: 'Guest changed lunch' });
    expect(blocked.status).toBe(403);
    expect((await Event.findById(insideId)).name).toBe('Lunch revised');

    const removed = await request(app)
      .delete(`/api/activities/${ownId}`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(removed.status).toBe(200);
    const afterDelete = await request(app)
      .get(`/api/plans/${personal._id}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(afterDelete.body.events.map((row) => row._id)).toEqual([insideId]);
    expect(await Event.findById(outsideId)).not.toBeNull();
  });

  test('a non-member is 403 and a missing token is 401', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const outsider = await registerAndLogin({
      firstName: 'Otto',
      lastName: 'Outsider',
      email: 'otto@example.com',
    });
    const planId = await createPlan(ada.token);

    const denied = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ start: windowStart, end: windowEnd });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only a plan member can link a personal plan');
    expect(await Plan.countDocuments({ sourcePlanId: planId })).toBe(0);

    const missing = await request(app)
      .post(`/api/plans/${planId}/link`)
      .send({ start: windowStart, end: windowEnd });
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');
  });

  test('start and end are required and end cannot be before start', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);

    const blank = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({});
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe('start and end are required');

    const reversed = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ start: windowEnd, end: windowStart });
    expect(reversed.status).toBe(400);
    expect(reversed.body.message).toBe('end must be on or after start');
    expect(await Plan.countDocuments({ sourcePlanId: planId })).toBe(0);
  });
});
