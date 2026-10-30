jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');
const { upgradeBody } = require('../utils/membershipTiers');
const { ARCHIVED_MESSAGE } = require('../utils/planArchive');

jest.setTimeout(30000);

let mongo;

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function registerAndLogin(email, firstName) {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({
      firstName,
      lastName: 'Lovelace',
      email,
      password: 'password1',
    });
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

async function postPlan(token, name) {
  return request(app)
    .post('/api/plans')
    .set(bearer(token))
    .send({
      type: 'trip',
      name,
      destination: 'Paris',
      timeZone: 'UTC',
      startDate: '2026-10-27T00:00:00.000Z',
      endDate: '2026-10-30T00:00:00.000Z',
    });
}

async function acceptRole(ownerToken, memberToken, planId, email, role) {
  const inviteRes = await request(app)
    .post(`/api/plans/${planId}/invite`)
    .set(bearer(ownerToken))
    .send({ email, role });
  expect(inviteRes.status).toBe(201);
  const acceptRes = await request(app)
    .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
    .set(bearer(memberToken))
    .send({ status: 'accepted' });
  expect(acceptRes.status).toBe(200);
}

function planNames(body) {
  return (body.plans || []).map((plan) => plan.name).sort();
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
  await mongo.stop();
});

describe('archive and recall', () => {
  test('archive drops the plan from the cap and blocks access', async () => {
    const ada = await registerAndLogin('ada-archive@example.com', 'Ada');
    const grace = await registerAndLogin('grace-archive@example.com', 'Grace');
    const alan = await registerAndLogin('alan-archive@example.com', 'Alan');
    const stranger = await registerAndLogin('stranger-archive@example.com', 'Sam');
    const first = await postPlan(ada.token, 'First');
    const second = await postPlan(ada.token, 'Second');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const planId = first.body.plan._id;
    const activity = await request(app)
      .post('/api/activities')
      .set(bearer(ada.token))
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: '2026-10-28T19:00:00.000Z',
        endTime: '2026-10-28T21:00:00.000Z',
      });
    expect(activity.status).toBe(201);
    await acceptRole(ada.token, grace.token, planId, 'grace-archive@example.com', 'Collaborator');
    await acceptRole(ada.token, alan.token, planId, 'alan-archive@example.com', 'Guest');

    const full = await postPlan(ada.token, 'Third');
    expect(full.status).toBe(402);
    expect(full.body).toEqual(upgradeBody('trial'));

    const archived = await request(app)
      .post(`/api/plans/${planId}/archive`)
      .set(bearer(ada.token))
      .send({ description: 'Summer trip done' });
    expect(archived.status).toBe(200);
    expect(archived.body.plan.status).toBe('archived');
    expect(archived.body.plan.archiveDescription).toBe('Summer trip done');
    expect(archived.body.plan.archivedBy).toBe(ada.userId);
    expect(new Date(archived.body.plan.archivedAt).getTime()).toBeGreaterThan(Date.now() - 60 * 1000);

    const stored = await Plan.findById(planId).lean();
    expect(stored.status).toBe('archived');
    expect(stored.archiveDescription).toBe('Summer trip done');
    expect(stored.archivedBy).toBe(ada.userId);
    expect(stored.archivedAt).toBeInstanceOf(Date);

    const credits = await request(app)
      .get('/api/users/me/ai-credits')
      .set(bearer(ada.token));
    expect(credits.status).toBe(200);
    expect(credits.body.plansOwned).toBe(1);

    const hidden = await request(app).get('/api/plans').set(bearer(ada.token));
    expect(hidden.status).toBe(200);
    expect(planNames(hidden.body)).toEqual(['Second']);

    const listed = await request(app)
      .get('/api/plans')
      .query({ includeArchived: '1' })
      .set(bearer(ada.token));
    expect(planNames(listed.body)).toEqual(['First', 'Second']);
    const shown = listed.body.plans.find((plan) => plan._id === planId);
    expect(shown.archiveDescription).toBe('Summer trip done');
    expect(shown.archivedAt).toBeTruthy();

    const guestList = await request(app)
      .get('/api/plans')
      .query({ includeArchived: '1' })
      .set(bearer(alan.token));
    expect(planNames(guestList.body)).toEqual([]);

    const plannerHidden = await request(app).get('/api/plans').set(bearer(grace.token));
    expect(planNames(plannerHidden.body)).toEqual([]);
    const plannerList = await request(app)
      .get('/api/plans')
      .query({ includeArchived: '1' })
      .set(bearer(grace.token));
    expect(planNames(plannerList.body)).toEqual(['First']);

    const opened = await request(app).get(`/api/plans/${planId}`).set(bearer(ada.token));
    expect(opened.status).toBe(403);
    expect(opened.body).toEqual({ message: ARCHIVED_MESSAGE });
    const plannerOpen = await request(app).get(`/api/plans/${planId}/itinerary`).set(bearer(grace.token));
    expect(plannerOpen.status).toBe(403);
    expect(plannerOpen.body).toEqual({ message: ARCHIVED_MESSAGE });
    const guestOpen = await request(app).get(`/api/plans/${planId}`).set(bearer(alan.token));
    expect(guestOpen.status).toBe(403);
    expect(guestOpen.body).toEqual({ message: ARCHIVED_MESSAGE });
    const outsider = await request(app).get(`/api/plans/${planId}`).set(bearer(stranger.token));
    expect(outsider.status).toBe(403);
    expect(outsider.body.message).not.toBe(ARCHIVED_MESSAGE);

    const created = await request(app)
      .post('/api/activities')
      .set(bearer(ada.token))
      .send({
        name: 'Lunch',
        type: 'dining',
        planId,
        startTime: '2026-10-29T19:00:00.000Z',
        endTime: '2026-10-29T21:00:00.000Z',
      });
    expect(created.status).toBe(403);
    expect(created.body).toEqual({ message: ARCHIVED_MESSAGE });
    const files = await request(app)
      .get(`/api/activities/${activity.body._id}/attachments`)
      .set(bearer(ada.token));
    expect(files.status).toBe(403);
    expect(files.body).toEqual({ message: ARCHIVED_MESSAGE });

    const again = await postPlan(ada.token, 'Third');
    expect(again.status).toBe(201);

    const guestArchive = await request(app)
      .post(`/api/plans/${planId}/archive`)
      .set(bearer(alan.token))
      .send({ description: 'no' });
    expect(guestArchive.status).toBe(403);
    const plannerArchive = await request(app)
      .post(`/api/plans/${planId}/archive`)
      .set(bearer(grace.token))
      .send({ description: 'no' });
    expect(plannerArchive.status).toBe(403);
    const guestRecall = await request(app)
      .post(`/api/plans/${planId}/recall`)
      .set(bearer(alan.token));
    expect(guestRecall.status).toBe(403);

    const overCap = await request(app)
      .post(`/api/plans/${planId}/recall`)
      .set(bearer(ada.token));
    expect(overCap.status).toBe(402);
    expect(overCap.body).toEqual(upgradeBody('trial'));
    expect((await Plan.findById(planId).lean()).status).toBe('archived');

    const parked = await request(app)
      .post(`/api/plans/${again.body.plan._id}/archive`)
      .set(bearer(ada.token))
      .send({ description: 'Hold this one' });
    expect(parked.status).toBe(200);

    const recalled = await request(app)
      .post(`/api/plans/${planId}/recall`)
      .set(bearer(grace.token));
    expect(recalled.status).toBe(200);
    expect(recalled.body.plan.status).toBe('active');
    expect(recalled.body.plan.archiveDescription).toBe('');
    expect(recalled.body.plan.archivedAt).toBeUndefined();
    expect(recalled.body.plan.archivedBy).toBeUndefined();

    const readable = await request(app).get(`/api/plans/${planId}`).set(bearer(alan.token));
    expect(readable.status).toBe(200);
    const after = await request(app).get('/api/plans').set(bearer(ada.token));
    expect(planNames(after.body)).toEqual(['First', 'Second']);
    const owned = await request(app).get('/api/users/me/ai-credits').set(bearer(ada.token));
    expect(owned.body.plansOwned).toBe(2);
  });
});
