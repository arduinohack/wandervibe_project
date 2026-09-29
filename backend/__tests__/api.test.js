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

async function registerAndLogin({ firstName, lastName, email, password }) {
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName, lastName, email, password });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  return {
    registerRes,
    loginRes,
    token: loginRes.body.token,
    userId: loginRes.body.user && loginRes.body.user._id,
  };
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

describe('auth', () => {
  test('register + login returns a token', async () => {
    const { registerRes, loginRes, token } = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });

    expect(registerRes.status).toBe(201);
    expect(loginRes.status).toBe(200);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });
});

describe('plans', () => {
  test('request without a token gets 401 and does not create a plan', async () => {
    const res = await request(app)
      .post('/api/plans')
      .send({ type: 'trip', name: 'Nope' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('No token, authorization denied');
    expect(await Plan.countDocuments()).toBe(0);
  });

  test('coordinator creates a plan', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });

    const res = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });

    expect(res.status).toBe(201);
    expect(res.body.plan.ownerId).toBe(ada.userId);

    const membership = await PlanUser.findOne({ planId: res.body.plan._id, userId: ada.userId });
    expect(membership).toBeTruthy();
    expect(membership.role).toBe('Owner');
  });

  test('creator sees the plan on GET /api/plans', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const listRes = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.plans.map((plan) => plan._id)).toContain(planId);
  });

  test('creator still sees the plan when the PlanUser row is missing', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;
    await PlanUser.deleteOne({ planId, userId: ada.userId });

    const listRes = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.plans.map((plan) => plan._id)).toContain(planId);
  });

  test('an accepted member sees the plan and the owner still does', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'VibePlanner' });
    expect(inviteRes.status).toBe(201);

    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    const graceList = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${grace.token}`);
    expect(graceList.status).toBe(200);
    expect(graceList.body.plans.map((plan) => plan._id)).toContain(planId);

    const adaList = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(adaList.status).toBe(200);
    expect(adaList.body.plans.map((plan) => plan._id)).toContain(planId);
  });

  test('a pending invitation does not add the plan', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
      password: 'password3',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Wanderer' });
    expect(inviteRes.status).toBe(201);

    const alanList = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${alan.token}`);
    expect(alanList.status).toBe(200);
    expect(alanList.body.plans.map((plan) => plan._id)).not.toContain(planId);

    const adaList = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`);
    expect(adaList.status).toBe(200);
    expect(adaList.body.plans.map((plan) => plan._id)).toContain(planId);
  });
});

describe('invites', () => {
  test('coordinator invites a second user as VibePlanner and they show up after accept', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const oldInvite = await request(app)
      .post(`/api/invites/trips/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'VibePlanner' });
    expect(oldInvite.status).toBe(404);

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'VibePlanner' });

    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.invitation.planId).toBe(planId);
    expect(inviteRes.body.invitation.role).toBe('Collaborator');

    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });

    expect(acceptRes.status).toBe(200);

    const usersRes = await request(app)
      .get(`/api/plans/${planId}/users`)
      .set('Authorization', `Bearer ${ada.token}`);

    expect(usersRes.status).toBe(200);
    const graceRow = usersRes.body.users.find((user) => user.email === 'grace@example.com');
    expect(graceRow).toBeTruthy();
    expect(graceRow.role).toBe('Collaborator');
  });

  test('a wanderer cannot invite', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
      password: 'password3',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const wandererInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Wanderer' });
    expect(wandererInvite.status).toBe(201);

    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${wandererInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    for (const role of ['VibePlanner', 'Guest']) {
      const denied = await request(app)
        .post(`/api/plans/${planId}/invite`)
        .set('Authorization', `Bearer ${grace.token}`)
        .send({ email: 'alan@example.com', role });
      expect(denied.status).toBe(403);
    }
    expect(await Invitation.findOne({ userId: alan.userId })).toBeNull();
  });

  test('a planner may invite a wanderer as Guest', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
      password: 'password3',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const plannerInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'VibePlanner' });
    expect(plannerInvite.status).toBe(201);

    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${plannerInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });

    expect(guestInvite.status).toBe(201);
    expect(guestInvite.body.invitation.planId).toBe(planId);
    expect(guestInvite.body.invitation.role).toBe('Guest');
    expect(guestInvite.body.invitation.userId).toBe(alan.userId);

    const alanAccept = await request(app)
      .post(`/api/invites/invitations/${guestInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ status: 'accepted' });
    expect(alanAccept.status).toBe(200);

    const membership = await PlanUser.findOne({ planId, userId: alan.userId });
    expect(membership).toBeTruthy();
    expect(membership.role).toBe('Guest');
  });

  test('a planner cannot invite a VibePlanner', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
      password: 'password3',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const plannerInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'VibePlanner' });
    expect(plannerInvite.status).toBe(201);

    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${plannerInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    for (const role of ['Collaborator', 'VibePlanner']) {
      const denied = await request(app)
        .post(`/api/plans/${planId}/invite`)
        .set('Authorization', `Bearer ${grace.token}`)
        .send({ email: 'alan@example.com', role });
      expect(denied.status).toBe(403);
    }
    expect(await Invitation.findOne({ userId: alan.userId })).toBeNull();
  });

  test('short membership names follow the same invite rules', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
      password: 'password3',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;
    await PlanUser.updateOne({ planId, userId: ada.userId }, { $set: { role: 'coordinator' } });

    const plannerInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'planner' });
    expect(plannerInvite.status).toBe(201);
    expect(plannerInvite.body.invitation.role).toBe('Collaborator');

    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${plannerInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);
    await PlanUser.updateOne({ planId, userId: grace.userId }, { $set: { role: 'planner' } });

    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'alan@example.com', role: 'wanderer' });
    expect(guestInvite.status).toBe(201);
    expect(guestInvite.body.invitation.role).toBe('Guest');

    await PlanUser.updateOne({ planId, userId: grace.userId }, { $set: { role: 'wanderer' } });
    const denied = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect(denied.status).toBe(403);
  });

  test('invite rejects owner and UI role labels', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    for (const role of ['Owner', 'VibeCoordinator', 'Organizer', 'Host', 'Co-Planner', 'Attendee', 'Planner']) {
      const res = await request(app)
        .post(`/api/plans/${planId}/invite`)
        .set('Authorization', `Bearer ${ada.token}`)
        .send({ email: 'grace@example.com', role });
      expect(res.status).toBe(400);
    }

    expect(await Invitation.countDocuments({ userId: grace.userId })).toBe(0);
  });

  test('reassign writes Owner to the target and Collaborator to the previous owner', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'VibePlanner' });
    expect(inviteRes.status).toBe(201);

    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    const reassignRes = await request(app)
      .post(`/api/plans/${planId}/reassign-coordinator`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ targetUserId: grace.userId });
    expect(reassignRes.status).toBe(200);

    const adaMembership = await PlanUser.findOne({ planId, userId: ada.userId });
    const graceMembership = await PlanUser.findOne({ planId, userId: grace.userId });
    expect(adaMembership.role).toBe('Collaborator');
    expect(graceMembership.role).toBe('Owner');
    expect((await Plan.findById(planId)).ownerId).toBe(grace.userId);
  });

  test('a leftover Wanderer invitation is stored as Guest on accept', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    await Invitation.collection.insertOne({
      _id: 'legacy-wanderer-invite',
      planId,
      userId: grace.userId,
      invitedBy: ada.userId,
      role: 'Wanderer',
      status: 'pending',
    });

    const acceptRes = await request(app)
      .post('/api/invites/invitations/legacy-wanderer-invite/respond')
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.invitation.role).toBe('Guest');

    const membership = await PlanUser.findOne({ planId, userId: grace.userId });
    expect(membership.role).toBe('Guest');
  });

  test('a leftover VibeCoordinator row can still invite', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;
    await PlanUser.updateOne({ planId, userId: ada.userId }, { $set: { role: 'VibeCoordinator' } });

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'VibePlanner' });
    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.invitation.role).toBe('Collaborator');
  });
});

describe('itinerary', () => {
  test('orders events by startTime and numbers the first event as day 1', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const later = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Later dinner',
        type: 'dining',
        planId,
        startTime: '2026-06-02T15:00:00.000Z',
        endTime: '2026-06-02T18:00:00.000Z',
      });
    expect(later.status).toBe(201);

    const earlier = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Earlier dinner',
        type: 'dining',
        planId,
        startTime: '2026-06-01T15:00:00.000Z',
        endTime: '2026-06-01T18:00:00.000Z',
      });
    expect(earlier.status).toBe(201);

    const res = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${ada.token}`);

    expect(res.status).toBe(200);
    expect(new Date(res.body.events[0].startTime).toISOString()).toBe('2026-06-01T15:00:00.000Z');
    expect(res.body.events[0].dayNumber).toBe(1);
    expect(res.body.events[1].dayNumber).toBe(2);
  });
});

describe('activity permissions', () => {
  const dinner = (planId, name) => ({
    name,
    type: 'dining',
    planId,
    startTime: '2026-06-01T15:00:00.000Z',
    endTime: '2026-06-01T18:00:00.000Z',
  });

  test('the owner can create an activity', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const created = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${ada.token}`)
      .send(dinner(planId, 'Owner dinner'));

    expect(created.status).toBe(201);
    expect(created.body.planId).toBe(planId);
  });

  test('an owner without a PlanUser row can still create an activity', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;
    await PlanUser.deleteOne({ planId, userId: ada.userId });

    const created = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${ada.token}`)
      .send(dinner(planId, 'Owner dinner'));

    expect(created.status).toBe(201);
  });

  test('a collaborator can create and update an activity', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect(inviteRes.status).toBe(201);
    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    const created = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${grace.token}`)
      .send(dinner(planId, 'Collaborator dinner'));
    expect(created.status).toBe(201);

    const ownerEvent = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${ada.token}`)
      .send(dinner(planId, 'Owner dinner'));
    expect(ownerEvent.status).toBe(201);

    const updated = await request(app)
      .put(`/api/events/${ownerEvent.body._id}`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ name: 'Updated by collaborator' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Updated by collaborator');

    await PlanUser.updateOne({ planId, userId: grace.userId }, { $set: { role: 'planner' } });
    const aliasCreate = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${grace.token}`)
      .send(dinner(planId, 'Alias dinner'));
    expect(aliasCreate.status).toBe(201);

    const removed = await request(app)
      .delete(`/api/events/${ownerEvent.body._id}`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(removed.status).toBe(200);
    expect(await Event.findById(ownerEvent.body._id)).toBeNull();
  });

  test('a guest cannot create or update an activity', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'password2',
    });
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const ownerEvent = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${ada.token}`)
      .send(dinner(planId, 'Owner dinner'));
    expect(ownerEvent.status).toBe(201);

    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Guest' });
    expect(inviteRes.status).toBe(201);
    const acceptRes = await request(app)
      .post(`/api/invites/invitations/${inviteRes.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptRes.status).toBe(200);

    const before = await Event.countDocuments({ planId });
    const denied = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${grace.token}`)
      .send(dinner(planId, 'Guest dinner'));
    expect(denied.status).toBe(403);
    expect(await Event.countDocuments({ planId })).toBe(before);

    const deniedUpdate = await request(app)
      .put(`/api/events/${ownerEvent.body._id}`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ name: 'Guest edit' });
    expect(deniedUpdate.status).toBe(403);
    expect((await Event.findById(ownerEvent.body._id)).name).toBe('Owner dinner');

    const itinerary = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(itinerary.status).toBe(200);
  });

  test('a user who is not a member cannot create an activity', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'password1',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
      password: 'password3',
    });
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Paris', destination: 'Paris', timeZone: 'UTC' });
    const planId = planRes.body.plan._id;

    const before = await Event.countDocuments({ planId });
    const denied = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${alan.token}`)
      .send(dinner(planId, 'Stranger dinner'));

    expect(denied.status).toBe(403);
    expect(await Event.countDocuments({ planId })).toBe(before);
  });
});
