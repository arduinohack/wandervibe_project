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

async function createPlan(token, name) {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({ type: 'trip', name, destination: name, timeZone: 'UTC' });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

async function createDinner(token, planId) {
  const res = await request(app)
    .post('/api/activities')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Dinner',
      type: 'dining',
      planId,
      startTime: '2026-06-01T15:00:00.000Z',
      endTime: '2026-06-01T18:00:00.000Z',
    });
  expect(res.status).toBe(201);
  return res.body._id;
}

async function acceptCollaborator(ownerToken, planId, email, memberToken) {
  const inviteRes = await request(app)
    .post(`/api/plans/${planId}/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role: 'Collaborator' });
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

describe('admin delete user', () => {
  test('deleting a sole owner removes that user, plan, and events', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const eventId = await createDinner(grace.token, planId);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(1);

    const removed = await request(app)
      .delete(`/api/admin/users/${grace.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(removed.status).toBe(200);

    expect(await User.findById(grace.userId)).toBeNull();
    expect(await User.findById(admin.userId)).not.toBeNull();
    expect(await Plan.findById(planId)).toBeNull();
    expect(await Event.findById(eventId)).toBeNull();
    expect(await Event.countDocuments({ planId })).toBe(0);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(0);
    expect(await PlanUser.countDocuments({ planId })).toBe(0);
    expect(await SupportLog.countDocuments({ planId })).toBe(0);

    const audit = await SupportLog.findOne({ event: 'UserDeleted' });
    expect(audit).not.toBeNull();
    expect(audit.actorUserId).toBe(admin.userId);
    expect(audit.extra.deletedUserId).toBe(grace.userId);
  });

  test('an owner with an accepted collaborator is not deleted', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const eventId = await createDinner(grace.token, planId);
    await acceptCollaborator(grace.token, planId, 'alan@example.com', alan.token);

    const before = {
      users: await User.countDocuments(),
      plans: await Plan.countDocuments(),
      members: await PlanUser.countDocuments({ planId }),
      events: await Event.countDocuments({ planId }),
      invites: await Invitation.countDocuments({ planId }),
    };

    const denied = await request(app)
      .delete(`/api/admin/users/${grace.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(denied.status).toBe(409);
    expect(denied.body.message).toBe('User owns a plan still shared with someone else');
    expect(denied.body.plans).toEqual([{ _id: planId, name: 'Paris' }]);

    expect(await User.findById(grace.userId)).not.toBeNull();
    expect(await User.findById(alan.userId)).not.toBeNull();
    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await Event.findById(eventId)).not.toBeNull();
    expect((await PlanUser.findOne({ planId, userId: alan.userId })).role).toBe('Collaborator');
    expect((await PlanUser.findOne({ planId, userId: grace.userId })).role).toBe('Owner');
    expect(await User.countDocuments()).toBe(before.users);
    expect(await Plan.countDocuments()).toBe(before.plans);
    expect(await PlanUser.countDocuments({ planId })).toBe(before.members);
    expect(await Event.countDocuments({ planId })).toBe(before.events);
    expect(await Invitation.countDocuments({ planId })).toBe(before.invites);
    expect(await SupportLog.countDocuments({ event: 'UserDeleted' })).toBe(0);
  });

  test('a pending invitation to someone else blocks deleting the owner', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'alan@example.com', role: 'Collaborator' });
    expect(inviteRes.status).toBe(201);

    const denied = await request(app)
      .delete(`/api/admin/users/${grace.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(denied.status).toBe(409);
    expect(denied.body.plans).toEqual([{ _id: planId, name: 'Paris' }]);
    expect(await User.findById(grace.userId)).not.toBeNull();
    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await Invitation.countDocuments({ planId, status: 'pending' })).toBe(1);
    expect(await SupportLog.countDocuments({ event: 'UserDeleted' })).toBe(0);
  });

  test('deleting a collaborator leaves the plan and its events', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const eventId = await createDinner(grace.token, planId);
    await acceptCollaborator(grace.token, planId, 'alan@example.com', alan.token);
    await SupportLog.create({
      level: 'info',
      event: 'Note',
      actorUserId: alan.userId,
      planId,
      message: 'keep me',
    });

    const removed = await request(app)
      .delete(`/api/admin/users/${alan.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(removed.status).toBe(200);

    expect(await User.findById(alan.userId)).toBeNull();
    expect(await User.findById(grace.userId)).not.toBeNull();
    expect(await Plan.findById(planId)).not.toBeNull();
    expect((await Plan.findById(planId)).ownerId).toBe(grace.userId);
    expect(await Event.findById(eventId)).not.toBeNull();
    expect(await PlanUser.findOne({ planId, userId: alan.userId })).toBeNull();
    expect((await PlanUser.findOne({ planId, userId: grace.userId })).role).toBe('Owner');
    const kept = await SupportLog.findOne({ event: 'Note', planId });
    expect(kept).not.toBeNull();
    expect(kept.actorUserId).toBe(alan.userId);
  });

  test('a member is forbidden, self-delete conflicts, and an unknown id is missing', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');

    const anon = await request(app).delete(`/api/admin/users/${grace.userId}`);
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe('No token, authorization denied');

    const member = await request(app)
      .delete(`/api/admin/users/${admin.userId}`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(member.status).toBe(403);

    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const self = await request(app)
      .delete(`/api/admin/users/${admin.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(self.status).toBe(409);
    expect(self.body.message).toBe('You cannot delete your own account');
    expect(await User.findById(admin.userId)).not.toBeNull();

    const missing = await request(app)
      .delete('/api/admin/users/does-not-exist')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('User not found');

    expect(await User.findById(grace.userId)).not.toBeNull();
    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await SupportLog.countDocuments({ event: 'UserDeleted' })).toBe(0);
  });
});

describe('admin delete plan', () => {
  test('deleting a sole plan removes its activities, revisions, invitations, and support logs', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const eventId = await createDinner(grace.token, planId);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(1);
    await Invitation.create({
      _id: 'invite-old',
      planId,
      userId: 'someone-else',
      invitedBy: grace.userId,
      role: 'Guest',
      status: 'rejected',
    });
    await SupportLog.create({
      level: 'info',
      event: 'Note',
      actorUserId: grace.userId,
      planId,
      message: 'remove me',
    });

    const removed = await request(app)
      .delete(`/api/admin/plans/${planId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.message).toBe('Plan deleted');

    expect(await User.findById(grace.userId)).not.toBeNull();
    expect(await Plan.findById(planId)).toBeNull();
    expect(await Event.findById(eventId)).toBeNull();
    expect(await Event.countDocuments({ planId })).toBe(0);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(0);
    expect(await Invitation.countDocuments({ planId })).toBe(0);
    expect(await PlanUser.countDocuments({ planId })).toBe(0);
    expect(await SupportLog.findOne({ event: 'Note', planId })).toBeNull();
  });

  test('another member blocks plan delete and nothing is written', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const eventId = await createDinner(grace.token, planId);
    await acceptCollaborator(grace.token, planId, 'alan@example.com', alan.token);
    await SupportLog.create({
      level: 'info',
      event: 'Note',
      actorUserId: grace.userId,
      planId,
      message: 'keep me',
    });

    const before = {
      plans: await Plan.countDocuments(),
      members: await PlanUser.countDocuments({ planId }),
      events: await Event.countDocuments({ planId }),
      revisions: await ActivityRevision.countDocuments({ planId }),
      invites: await Invitation.countDocuments({ planId }),
    };

    const denied = await request(app)
      .delete(`/api/admin/plans/${planId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(denied.status).toBe(409);
    expect(denied.body.message).toBe('Plan is still shared with someone else');

    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await Event.findById(eventId)).not.toBeNull();
    expect((await PlanUser.findOne({ planId, userId: grace.userId })).role).toBe('Owner');
    expect((await PlanUser.findOne({ planId, userId: alan.userId })).role).toBe('Collaborator');
    expect(await SupportLog.findOne({ event: 'Note', planId })).not.toBeNull();
    expect(await Plan.countDocuments()).toBe(before.plans);
    expect(await PlanUser.countDocuments({ planId })).toBe(before.members);
    expect(await Event.countDocuments({ planId })).toBe(before.events);
    expect(await ActivityRevision.countDocuments({ planId })).toBe(before.revisions);
    expect(await Invitation.countDocuments({ planId })).toBe(before.invites);
    expect(await User.findById(grace.userId)).not.toBeNull();
    expect(await User.findById(alan.userId)).not.toBeNull();
  });

  test('a pending invitation blocks plan delete', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const inviteRes = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect(inviteRes.status).toBe(201);

    const denied = await request(app)
      .delete(`/api/admin/plans/${planId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(denied.status).toBe(409);
    expect(await Plan.findById(planId)).not.toBeNull();
    expect(await Invitation.countDocuments({ planId, status: 'pending' })).toBe(1);
    expect(await PlanUser.countDocuments({ planId, userId: grace.userId })).toBe(1);
  });

  test('plan delete allows an admin, rejects a member, and 404s an unknown id', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');

    const anon = await request(app).delete(`/api/admin/plans/${planId}`);
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe('No token, authorization denied');

    const member = await request(app)
      .delete(`/api/admin/plans/${planId}`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(member.status).toBe(403);
    expect(member.body.message).toBe('Admin access required');

    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const missing = await request(app)
      .delete('/api/admin/plans/does-not-exist')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Plan not found');
    expect(await Plan.findById(planId)).not.toBeNull();
  });
});

describe('admin activity explorer', () => {
  test('an admin reads the activity and its revisions newest first', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${grace.token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        location: 'Le Bistro',
        details: 'Window table',
        startTime: '2026-06-01T15:00:00.000Z',
        endTime: '2026-06-01T18:00:00.000Z',
      });
    expect(created.status).toBe(201);
    const activityId = created.body._id;
    const updated = await request(app)
      .put(`/api/activities/${activityId}`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ details: 'Corner table' });
    expect(updated.status).toBe(200);

    const anon = await request(app).get(`/api/admin/activities/${activityId}`);
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe('No token, authorization denied');

    const member = await request(app)
      .get(`/api/admin/activities/${activityId}`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(member.status).toBe(403);
    expect(member.body.message).toBe('Admin access required');

    const found = await request(app)
      .get(`/api/admin/activities/${activityId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(found.status).toBe(200);
    expect(Object.keys(found.body).sort()).toEqual([
      '_id',
      'details',
      'endTime',
      'location',
      'name',
      'planId',
      'revisions',
      'startTime',
      'type',
    ]);
    expect(found.body).toMatchObject({
      _id: activityId,
      name: 'Dinner',
      type: 'dining',
      planId,
      startTime: '2026-06-01T15:00:00.000Z',
      endTime: '2026-06-01T18:00:00.000Z',
      location: 'Le Bistro',
      details: 'Corner table',
    });
    expect(found.body.revisions.map((row) => row.action)).toEqual(['update', 'create']);
    expect(Object.keys(found.body.revisions[0]).sort()).toEqual(['action', 'createdAt', 'email', 'userId']);
    expect(found.body.revisions[0].userId).toBe(grace.userId);
    expect(found.body.revisions[0].email).toBe('grace@example.com');
    expect(found.body.revisions[1].userId).toBe(grace.userId);
    expect(found.body.revisions[1].email).toBe('grace@example.com');
    expect(JSON.stringify(found.body)).not.toContain('password1');

    const missing = await request(app)
      .get('/api/admin/activities/does-not-exist')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Activity not found');
  });

  test('an admin delete removes the activity and writes the member delete revision', async () => {
    const admin = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@example.com',
    });
    await User.updateOne({ _id: admin.userId }, { $set: { role: 'admin' } });
    const grace = await registerAndLogin({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
    const planId = await createPlan(grace.token, 'Paris');
    const activityId = await createDinner(grace.token, planId);
    const keptId = await createDinner(grace.token, planId);

    const member = await request(app)
      .delete(`/api/admin/activities/${activityId}`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(member.status).toBe(403);
    expect(member.body.message).toBe('Admin access required');
    expect(await Event.findById(activityId)).not.toBeNull();
    expect(await ActivityRevision.countDocuments({ eventId: activityId, action: 'delete' })).toBe(0);

    const removed = await request(app)
      .delete(`/api/admin/activities/${activityId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.message).toBe('Activity deleted');
    expect(await Event.findById(activityId)).toBeNull();
    expect(await Event.findById(keptId)).not.toBeNull();

    const revision = await ActivityRevision.findOne({ eventId: activityId, action: 'delete' });
    expect(revision).not.toBeNull();
    expect(revision.deleted).toBe(true);
    expect(revision.userId).toBe(admin.userId);
    expect(revision.planId).toBe(planId);
    expect(revision.snapshot.name).toBe('Dinner');
    expect(revision.snapshot.type).toBe('dining');
    expect(String(revision.snapshot._id)).toBe(activityId);

    const history = await request(app)
      .get(`/api/activities/${activityId}/history`)
      .set('Authorization', `Bearer ${grace.token}`);
    expect(history.status).toBe(200);
    expect(history.body[0].action).toBe('delete');
    expect(history.body[0].deleted).toBe(true);
    expect(history.body[0].userId).toBe(admin.userId);
    expect(history.body[0].snapshot.name).toBe('Dinner');
    expect(history.body[0].snapshot.deleted).toBeUndefined();

    const missing = await request(app)
      .delete('/api/admin/activities/does-not-exist')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Activity not found');
  });
});
