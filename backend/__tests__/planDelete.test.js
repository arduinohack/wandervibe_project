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
const ActivityRevision = require('../models/ActivityRevision');
const SupportLog = require('../models/SupportLog');

jest.setTimeout(30000);

let mongo;

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
    ActivityRevision.deleteMany({}),
    SupportLog.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('owner plan delete', () => {
  test('the owner can delete a plan that is not shared', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);
    const dinner = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: '2026-06-01T19:00:00.000Z',
        endTime: '2026-06-01T21:00:00.000Z',
      });
    expect(dinner.status).toBe(201);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(1);
    await Invitation.create({
      _id: 'invite-old',
      planId,
      userId: 'someone-else',
      invitedBy: ada.userId,
      role: 'Guest',
      status: 'rejected',
    });
    await SupportLog.create({
      level: 'info',
      event: 'Note',
      actorUserId: ada.userId,
      planId,
      message: 'remove me',
    });

    const removed = await request(app)
      .delete(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.message).toBe('Plan deleted');

    expect(await User.findById(ada.userId)).not.toBeNull();
    expect(await Plan.findById(planId)).toBeNull();
    expect(await Event.countDocuments({ planId })).toBe(0);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(0);
    expect(await Invitation.countDocuments({ planId })).toBe(0);
    expect(await PlanUser.countDocuments({ planId })).toBe(0);
    expect(await SupportLog.findOne({ event: 'Note', planId })).toBeNull();
  });

  test('a collaborator cannot delete the plan', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, grace.token, planId, 'grace@example.com', 'Collaborator');

    const denied = await request(app)
      .delete(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only the Owner can delete a plan');
    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await PlanUser.countDocuments({ planId })).toBe(2);
  });

  test('another member blocks owner delete and nothing is written', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);
    const dinner = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: '2026-06-01T19:00:00.000Z',
        endTime: '2026-06-01T21:00:00.000Z',
      });
    expect(dinner.status).toBe(201);
    await acceptRole(ada.token, alan.token, planId, 'alan@example.com', 'Collaborator');
    await SupportLog.create({
      level: 'info',
      event: 'Note',
      actorUserId: ada.userId,
      planId,
      message: 'keep me',
    });

    const before = {
      plans: await Plan.countDocuments(),
      members: await PlanUser.countDocuments({ planId }),
      events: await Event.countDocuments({ planId }),
      revisions: await ActivityRevision.countDocuments({ planId }),
    };

    const denied = await request(app)
      .delete(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(denied.status).toBe(409);
    expect(denied.body.message).toBe('Plan is still shared with someone else');
    expect(denied.body.people).toEqual([
      expect.objectContaining({
        userId: alan.userId,
        email: 'alan@example.com',
        firstName: 'Alan',
        lastName: 'Turing',
        role: 'Collaborator',
      }),
    ]);
    expect(denied.body.invites).toEqual([]);

    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await Event.findById(dinner.body._id || dinner.body.id)).not.toBeNull();
    expect((await PlanUser.findOne({ planId, userId: ada.userId })).role).toBe('Owner');
    expect((await PlanUser.findOne({ planId, userId: alan.userId })).role).toBe('Collaborator');
    expect(await SupportLog.findOne({ event: 'Note', planId })).not.toBeNull();
    expect(await Plan.countDocuments()).toBe(before.plans);
    expect(await PlanUser.countDocuments({ planId })).toBe(before.members);
    expect(await Event.countDocuments({ planId })).toBe(before.events);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(before.revisions);
    expect(await User.findById(ada.userId)).not.toBeNull();
    expect(await User.findById(alan.userId)).not.toBeNull();
  });

  test('a pending invitation blocks owner delete', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);
    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect(inviteRes.status).toBe(201);

    const denied = await request(app)
      .delete(`/api/plans/${planId}`)
      .set('Authorization', `Bearer ${ada.token}`);
    expect(denied.status).toBe(409);
    expect(denied.body.people).toEqual([]);
    expect(denied.body.invites).toEqual([
      expect.objectContaining({
        email: 'alan@example.com',
        role: 'Guest',
        status: 'pending',
      }),
    ]);
    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await Invitation.countDocuments({ planId, status: 'pending' })).toBe(1);
  });

  test('an unknown plan is 404', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const missing = await request(app)
      .delete('/api/plans/missing-plan')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Plan not found');
  });

  test('delete without a token is 401', async () => {
    const missing = await request(app).delete('/api/plans/missing-plan');
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');
  });
});
