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

jest.setTimeout(30000);

let mongo;

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
  test('a guest links selected activities and sees them with their own', async () => {
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
    const lunchId = await addActivity(ada.token, planId, 'Lunch', '2026-07-02T12:00:00.000Z');
    const dinnerId = await addActivity(ada.token, planId, 'Dinner', '2026-07-03T19:00:00.000Z');
    const museumId = await addActivity(ada.token, planId, 'Museum', '2026-08-01T12:00:00.000Z');
    const sourceActivities = await Event.countDocuments({ planId });
    const sourceMembers = await PlanUser.countDocuments({ planId });

    const linked = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [lunchId, dinnerId] });
    expect(linked.status).toBe(201);
    const personal = linked.body.plan;
    expect(personal.ownerId).toBe(sam.userId);
    expect(personal.sourcePlanId).toBe(planId);
    expect(personal.linkedActivityIds).toEqual([lunchId, dinnerId]);
    expect(personal.name).toBe('My Paris');
    expect(await Event.countDocuments({ planId })).toBe(sourceActivities);
    expect(await PlanUser.countDocuments({ planId })).toBe(sourceMembers);
    expect(await Event.countDocuments({ planId: personal._id })).toBe(0);
    const personalMembers = await PlanUser.find({ planId: personal._id });
    expect(personalMembers).toHaveLength(1);
    expect(personalMembers[0].userId).toBe(sam.userId);
    expect(personalMembers[0].role).toBe('Owner');
    const source = await Plan.findById(planId).lean();
    expect(source.name).toBe('Paris');
    expect(source.ownerId).toBe(ada.userId);
    expect(source.sourcePlanId || '').toBe('');

    const beforeId = await addActivity(sam.token, personal._id, 'Early note', '2026-06-01T08:00:00.000Z');
    const afterId = await addActivity(sam.token, personal._id, 'Late note', '2026-09-01T08:00:00.000Z');
    const itinerary = await request(app)
      .get(`/api/plans/${personal._id}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(itinerary.status).toBe(200);
    const rows = itinerary.body.events;
    expect(rows.map((row) => row._id)).toEqual([beforeId, lunchId, dinnerId, afterId]);
    expect(rows[0]).toMatchObject({ linked: false, name: 'Early note' });
    expect(rows[1]).toMatchObject({ linked: true, name: 'Lunch' });
    expect(rows[2]).toMatchObject({ linked: true, name: 'Dinner' });
    expect(rows[3]).toMatchObject({ linked: false, name: 'Late note' });
    expect(rows.some((row) => row._id === museumId)).toBe(false);

    await request(app)
      .put(`/api/activities/${lunchId}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ name: 'Lunch revised' });
    const reloaded = await request(app)
      .get(`/api/plans/${personal._id}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    const lunch = reloaded.body.events.find((row) => row._id === lunchId);
    expect(lunch.name).toBe('Lunch revised');
    expect(lunch.linked).toBe(true);
    expect(await Event.findById(lunchId)).toMatchObject({ planId, name: 'Lunch revised' });

    const renamed = await request(app)
      .put(`/api/activities/${beforeId}`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ name: 'My early note' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('My early note');

    const blocked = await request(app)
      .put(`/api/activities/${lunchId}`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ name: 'Guest changed lunch' });
    expect(blocked.status).toBe(403);
    expect((await Event.findById(lunchId)).name).toBe('Lunch revised');

    const removedOwn = await request(app)
      .delete(`/api/activities/${beforeId}`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(removedOwn.status).toBe(200);

    const removedSource = await request(app)
      .delete(`/api/activities/${dinnerId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(removedSource.status).toBe(200);
    const afterDelete = await request(app)
      .get(`/api/plans/${personal._id}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(afterDelete.body.events.map((row) => row._id)).toEqual([lunchId, afterId]);
    expect(await Event.findById(dinnerId)).toBeNull();
    expect(await Event.findById(museumId)).not.toBeNull();
    expect((await Plan.findById(planId).lean()).name).toBe('Paris');
  });

  test('a non-member is 403, a missing token is 401, and an unknown activity is 400', async () => {
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
    const otherPlanId = await createPlan(ada.token);
    const onPlan = await addActivity(ada.token, planId, 'Lunch', '2026-07-02T12:00:00.000Z');
    const elsewhere = await addActivity(ada.token, otherPlanId, 'Elsewhere', '2026-07-02T12:00:00.000Z');

    const denied = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ activityIds: [onPlan] });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only a plan member can link a personal plan');
    expect(await Plan.countDocuments({ sourcePlanId: planId })).toBe(0);

    const missing = await request(app)
      .post(`/api/plans/${planId}/link`)
      .send({ activityIds: [onPlan] });
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');

    const blank = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({});
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe('activityIds is required');

    const unknown = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ activityIds: [onPlan, elsewhere] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe('An activity is not on this plan');
    expect(await Plan.countDocuments({ sourcePlanId: planId })).toBe(0);
    expect(await Event.findById(onPlan)).not.toBeNull();
    expect(await Event.findById(elsewhere)).not.toBeNull();
  });

  test('the owner replaces the selected activities without deleting them on the source', async () => {
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
    const lunchId = await addActivity(ada.token, planId, 'Lunch', '2026-07-02T12:00:00.000Z');
    const dinnerId = await addActivity(ada.token, planId, 'Dinner', '2026-07-03T19:00:00.000Z');

    const linked = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [lunchId] });
    expect(linked.status).toBe(201);
    const personalId = linked.body.plan._id;

    const replaced = await request(app)
      .put(`/api/plans/${personalId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [dinnerId] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.plan.linkedActivityIds).toEqual([dinnerId]);
    expect(replaced.body.plan.sourcePlanId).toBe(planId);
    const savedPlan = await request(app)
      .get(`/api/plans/${personalId}`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(savedPlan.status).toBe(200);
    expect(savedPlan.body.plan.sourcePlanId).toBe(planId);
    const afterUncheck = await request(app)
      .get(`/api/plans/${personalId}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(afterUncheck.body.events.map((row) => row._id)).toEqual([dinnerId]);
    expect(afterUncheck.body.events[0].linked).toBe(true);
    expect(await Event.findById(lunchId)).toMatchObject({ planId, name: 'Lunch' });

    const added = await request(app)
      .put(`/api/plans/${personalId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [lunchId, dinnerId] });
    expect(added.status).toBe(200);
    const both = await request(app)
      .get(`/api/plans/${personalId}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(both.body.events.map((row) => row._id)).toEqual([lunchId, dinnerId]);

    const cleared = await request(app)
      .put(`/api/plans/${personalId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.plan.linkedActivityIds).toEqual([]);
    expect(cleared.body.plan.sourcePlanId).toBe(planId);
    const none = await request(app)
      .get(`/api/plans/${personalId}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(none.body.events).toEqual([]);
    expect(await Event.countDocuments({ planId })).toBe(2);

    const restored = await request(app)
      .put(`/api/plans/${personalId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [lunchId] });
    expect(restored.status).toBe(200);

    const notOnSource = await request(app)
      .put(`/api/plans/${personalId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [dinnerId, 'missing-activity'] });
    expect(notOnSource.status).toBe(400);
    expect(notOnSource.body.message).toBe('An activity is not on this plan');
    expect((await Plan.findById(personalId).lean()).linkedActivityIds).toEqual([lunchId]);

    const outsider = await request(app)
      .put(`/api/plans/${personalId}/link`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ activityIds: [dinnerId] });
    expect(outsider.status).toBe(403);
    expect(outsider.body.message).toBe('Only the Owner can change linked activities');
    expect((await Plan.findById(personalId).lean()).linkedActivityIds).toEqual([lunchId]);

    const missingToken = await request(app)
      .put(`/api/plans/${personalId}/link`)
      .send({ activityIds: [dinnerId] });
    expect(missingToken.status).toBe(401);
    expect(missingToken.body.message).toBe('No token, authorization denied');
  });

  test('own and linked activities stay in one list sorted by start time', async () => {
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
    const lunchId = await addActivity(ada.token, planId, 'Lunch', '2026-07-02T12:00:00.000Z');
    const linked = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [lunchId] });
    const personalId = linked.body.plan._id;
    const earlyId = await addActivity(sam.token, personalId, 'Early note', '2026-06-01T08:00:00.000Z');
    const lateId = await addActivity(sam.token, personalId, 'Late note', '2026-09-01T08:00:00.000Z');
    const lunchBefore = await Event.findById(lunchId).lean();

    const itinerary = await request(app)
      .get(`/api/plans/${personalId}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(itinerary.body.events.map((row) => row._id)).toEqual([earlyId, lunchId, lateId]);
    expect(itinerary.body.events.map((row) => row.linked)).toEqual([false, true, false]);

    const resorted = await request(app)
      .put('/api/activities/order')
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ planId: personalId, activityIds: [earlyId, lunchId, lateId] });
    expect(resorted.status).toBe(200);
    const lunch = await Event.findById(lunchId).lean();
    expect(lunch.planId).toBe(planId);
    expect(lunch.name).toBe('Lunch');
    expect(lunch.eventNum).toBe(lunchBefore.eventNum);
    expect((await Event.findById(earlyId).lean()).eventNum).toBe(0);
    expect((await Event.findById(lateId).lean()).eventNum).toBe(2);

    const reversed = await request(app)
      .put('/api/activities/order')
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ planId: personalId, activityIds: [lateId, lunchId, earlyId] });
    expect(reversed.status).toBe(200);
    const stillSorted = await request(app)
      .get(`/api/plans/${personalId}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(stillSorted.body.events.map((row) => row._id)).toEqual([earlyId, lunchId, lateId]);
    expect((await Event.findById(lunchId).lean()).eventNum).toBe(lunchBefore.eventNum);

    const unknown = await request(app)
      .put('/api/activities/order')
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ planId: personalId, activityIds: [earlyId, lateId, 'not-on-this-plan'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe('activityIds must list each activity once');
    expect((await Event.findById(lunchId).lean()).eventNum).toBe(lunchBefore.eventNum);
    expect((await Plan.findById(planId).lean()).name).toBe('Paris');
  });

  test('a linked plan includes its source plan id', async () => {
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
    const outsider = await registerAndLogin({
      firstName: 'Otto',
      lastName: 'Outsider',
      email: 'otto@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, sam.token, planId, 'sam@example.com', 'Guest');
    const lunchId = await addActivity(ada.token, planId, 'Lunch', '2026-07-02T12:00:00.000Z');
    const linked = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({ activityIds: [lunchId] });
    expect(linked.status).toBe(201);
    expect(linked.body.plan.sourcePlanId).toBe(planId);
    const personalId = linked.body.plan._id;

    const list = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${sam.token}`);
    expect(list.status).toBe(200);
    const listed = list.body.plans.find((plan) => plan._id === personalId);
    expect(listed.sourcePlanId).toBe(planId);

    const one = await request(app)
      .get(`/api/plans/${personalId}`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(one.status).toBe(200);
    expect(one.body.plan.sourcePlanId).toBe(linked.body.plan.sourcePlanId);
    expect(one.body.plan.name).toBe('My Paris');

    const source = await request(app)
      .get(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(source.status).toBe(200);
    expect(source.body.plan.name).toBe('Paris');
    expect(source.body.plan.sourcePlanId || '').toBe('');

    const denied = await request(app)
      .get(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Not authorized to read plan');

    const missingToken = await request(app).get(`/api/plans/${planId}`);
    expect(missingToken.status).toBe(401);
    expect(missingToken.body.message).toBe('No token, authorization denied');

    const missing = await request(app)
      .get('/api/plans/missing-plan')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Plan not found');
  });
});
