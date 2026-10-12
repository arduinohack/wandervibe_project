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
const { notifyUsers } = require('../utils/notifications');
const { inviteeMail } = require('../utils/mailCopy');

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
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

function memberKeys(row) {
  return Object.keys(row).sort();
}

function expectedMemberKeys(status) {
  if (status === 'accepted') {
    return ['acceptedAt', 'email', 'name', 'role', 'status'];
  }
  return ['email', 'invitedAt', 'name', 'role', 'status'];
}

describe('GET /api/plans/:planId/members', () => {
  test('no token is 401', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);

    const res = await request(app).get(`/api/plans/${planId}/members`);
    expect(res.status).toBe(401);
  });

  test('a logged-in outsider is 403', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const eve = await registerAndLogin({
      firstName: 'Eve',
      lastName: 'Example',
      email: 'eve@example.com',
    });
    const planId = await createPlan(ada.token);

    const res = await request(app)
      .get(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${eve.token}`);
    expect(res.status).toBe(403);
  });

  test('Owner, Collaborator, and Guest see accepted people and pending invites', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);

    const collaboratorInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect(collaboratorInvite.status).toBe(201);
    const acceptCollaborator = await request(app)
      .post(`/api/invites/invitations/${collaboratorInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' });
    expect(acceptCollaborator.status).toBe(200);

    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect(guestInvite.status).toBe(201);
    const acceptGuest = await request(app)
      .post(`/api/invites/invitations/${guestInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ status: 'accepted' });
    expect(acceptGuest.status).toBe(200);

    const pendingKnown = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'eve@example.com', role: 'Guest' });
    expect(pendingKnown.status).toBe(201);
    const eve = await registerAndLogin({
      firstName: 'Eve',
      lastName: 'Example',
      email: 'eve@example.com',
    });

    const pendingUnknown = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'new.person@example.com', role: 'Collaborator' });
    expect(pendingUnknown.status).toBe(201);

    await User.updateOne(
      { _id: ada.userId },
      { $set: { resetToken: 'secret-reset-token', resetTokenExpiry: new Date() } },
    );

    for (const token of [ada.token, grace.token, alan.token]) {
      const res = await request(app)
        .get(`/api/plans/${planId}/members`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ members: expect.any(Array) });

      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toMatch(/password1/i);
      expect(bodyText).not.toMatch(/secret-reset-token/);
      expect(bodyText.toLowerCase()).not.toContain('password');
      expect(bodyText.toLowerCase()).not.toContain('resettoken');

      for (const row of res.body.members) {
        expect(memberKeys(row)).toEqual(expectedMemberKeys(row.status));
        expect(row.invitedAt === undefined || row.acceptedAt === undefined).toBe(true);
      }

      const byEmail = Object.fromEntries(
        res.body.members.map((row) => [row.email, row]),
      );
      expect(byEmail['ada@example.com']).toMatchObject({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'Owner',
        status: 'accepted',
      });
      expect(byEmail['grace@example.com']).toMatchObject({
        name: 'Grace Hopper',
        email: 'grace@example.com',
        role: 'Collaborator',
        status: 'accepted',
      });
      expect(byEmail['alan@example.com']).toMatchObject({
        name: 'Alan Turing',
        email: 'alan@example.com',
        role: 'Guest',
        status: 'accepted',
      });
      expect(byEmail['eve@example.com']).toMatchObject({
        name: 'Eve Example',
        email: 'eve@example.com',
        role: 'Guest',
        status: 'pending',
      });
      expect(byEmail['new.person@example.com']).toMatchObject({
        name: '',
        email: 'new.person@example.com',
        role: 'Collaborator',
        status: 'pending',
      });
      expect(res.body.members).toHaveLength(5);

      const adaMembership = await PlanUser.findOne({ planId, userId: ada.userId }).lean();
      const graceInvite = await Invitation.findById(collaboratorInvite.body.invitation._id).lean();
      const alanInvite = await Invitation.findById(guestInvite.body.invitation._id).lean();
      const eveInvite = await Invitation.findOne({ planId, email: 'eve@example.com' }).lean();
      const unknownInvite = await Invitation.findOne({
        planId,
        email: 'new.person@example.com',
      }).lean();
      expect(byEmail['ada@example.com'].acceptedAt).toBe(
        new Date(adaMembership.createdAt).toISOString(),
      );
      expect(byEmail['grace@example.com'].acceptedAt).toBe(
        new Date(graceInvite.updatedAt).toISOString(),
      );
      expect(byEmail['alan@example.com'].acceptedAt).toBe(
        new Date(alanInvite.updatedAt).toISOString(),
      );
      expect(byEmail['eve@example.com'].invitedAt).toBe(
        new Date(eveInvite.createdAt).toISOString(),
      );
      expect(byEmail['new.person@example.com'].invitedAt).toBe(
        new Date(unknownInvite.createdAt).toISOString(),
      );
    }

    const outsider = await request(app)
      .get(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${eve.token}`);
    expect(outsider.status).toBe(403);
  });

  test('a declined person is included with invitedAt', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);

    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect(guestInvite.status).toBe(201);
    const acceptGuest = await request(app)
      .post(`/api/invites/invitations/${guestInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ status: 'accepted' });
    expect(acceptGuest.status).toBe(200);

    const declinedInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect(declinedInvite.status).toBe(201);
    const reject = await request(app)
      .post(`/api/invites/invitations/${declinedInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'rejected' });
    expect(reject.status).toBe(200);

    await User.updateOne(
      { _id: grace.userId },
      { $set: { resetToken: 'secret-reset-token', resetTokenExpiry: new Date() } },
    );

    const stored = await Invitation.findById(declinedInvite.body.invitation._id).lean();
    expect(stored.status).toBe('rejected');

    for (const token of [ada.token, alan.token]) {
      const res = await request(app)
        .get(`/api/plans/${planId}/members`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toMatch(/password1/i);
      expect(bodyText).not.toMatch(/secret-reset-token/);
      expect(bodyText.toLowerCase()).not.toContain('password');
      expect(bodyText.toLowerCase()).not.toContain('resettoken');
      expect(bodyText).not.toContain(ada.token);
      expect(bodyText).not.toContain(grace.token);

      const byEmail = Object.fromEntries(
        res.body.members.map((row) => [row.email, row]),
      );
      expect(res.body.members).toHaveLength(3);
      expect(memberKeys(byEmail['grace@example.com'])).toEqual(expectedMemberKeys('rejected'));
      expect(byEmail['grace@example.com']).toMatchObject({
        name: 'Grace Hopper',
        email: 'grace@example.com',
        role: 'Collaborator',
        status: 'rejected',
        invitedAt: new Date(stored.createdAt).toISOString(),
      });
      expect(byEmail['grace@example.com'].acceptedAt).toBeUndefined();
      expect(byEmail['ada@example.com'].status).toBe('accepted');
      expect(byEmail['ada@example.com'].invitedAt).toBeUndefined();
      expect(byEmail['alan@example.com'].status).toBe('accepted');
    }
  });
});

describe('DELETE /api/plans/:planId/members', () => {
  test('no token is 401', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);

    const res = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .send({ email: 'grace@example.com' });
    expect(res.status).toBe(401);
  });

  test('a Guest is 403 and the Owner cannot be removed', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);

    const collaboratorInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect(collaboratorInvite.status).toBe(201);
    expect((await request(app)
      .post(`/api/invites/invitations/${collaboratorInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect(guestInvite.status).toBe(201);
    expect((await request(app)
      .post(`/api/invites/invitations/${guestInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const guestRemove = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ email: 'grace@example.com' });
    expect(guestRemove.status).toBe(403);

    const ownerRemove = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'ada@example.com' });
    expect(ownerRemove.status).toBe(400);

    const collaboratorRemovesOwner = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'ada@example.com' });
    expect(collaboratorRemovesOwner.status).toBe(400);

    expect(await PlanUser.findOne({ planId, userId: ada.userId })).toBeTruthy();
    expect(await User.findById(ada.userId)).toBeTruthy();
  });

  test('Owner may remove a Collaborator or a pending Guest; Collaborator may remove a Guest only', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);

    const collaboratorInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect((await request(app)
      .post(`/api/invites/invitations/${collaboratorInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect((await request(app)
      .post(`/api/invites/invitations/${guestInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const pending = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'new.person@example.com', role: 'Guest' });
    expect(pending.status).toBe(201);

    const otherCollaborator = await registerAndLogin({
      firstName: 'Eve',
      lastName: 'Example',
      email: 'eve@example.com',
    });
    const otherInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'eve@example.com', role: 'Collaborator' });
    expect((await request(app)
      .post(`/api/invites/invitations/${otherInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${otherCollaborator.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const collaboratorDenied = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'eve@example.com' });
    expect(collaboratorDenied.status).toBe(403);
    expect(await PlanUser.findOne({ planId, userId: otherCollaborator.userId })).toBeTruthy();

    notifyUsers.mockClear();
    const collaboratorRemovesGuest = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'alan@example.com' });
    expect(collaboratorRemovesGuest.status).toBe(200);
    expect(await PlanUser.findOne({ planId, userId: alan.userId })).toBeNull();
    expect(await User.findById(alan.userId)).toBeTruthy();
    expect(notifyUsers).toHaveBeenCalledWith(
      [alan.userId],
      expect.stringContaining('removed'),
      'email',
    );

    notifyUsers.mockClear();
    const ownerRemovesCollaborator = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com' });
    expect(ownerRemovesCollaborator.status).toBe(200);
    expect(await PlanUser.findOne({ planId, userId: grace.userId })).toBeNull();
    expect(await User.findById(grace.userId)).toBeTruthy();

    notifyUsers.mockClear();
    const ownerCancelsPending = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'new.person@example.com' });
    expect(ownerCancelsPending.status).toBe(200);
    expect(await Invitation.findOne({
      planId,
      email: 'new.person@example.com',
      status: 'pending',
    })).toBeNull();
    expect(await User.findOne({ email: 'new.person@example.com' })).toBeNull();
    expect(notifyUsers).toHaveBeenCalledWith(
      ['new.person@example.com'],
      expect.stringContaining('removed'),
      'email',
    );
  });
});

async function acceptInvite(planId, ownerToken, email, role, memberToken) {
  const invite = await request(app)
    .post(`/api/plans/${planId}/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role });
  expect(invite.status).toBe(201);
  const accept = await request(app)
    .post(`/api/invites/invitations/${invite.body.invitation._id}/respond`)
    .set('Authorization', `Bearer ${memberToken}`)
    .send({ status: 'accepted' });
  expect(accept.status).toBe(200);
}

describe('POST /api/plans/:planId/reassign-coordinator', () => {
  test('no token is 401', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await createPlan(ada.token);
    const res = await request(app)
      .post(`/api/plans/${planId}/reassign-coordinator`)
      .send({ email: 'grace@example.com' });
    expect(res.status).toBe(401);
  });

  test('the owner assigns an accepted collaborator by email', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptInvite(planId, ada.token, 'grace@example.com', 'Collaborator', grace.token);
    await acceptInvite(planId, ada.token, 'alan@example.com', 'Guest', alan.token);
    await PlanUser.create({ planId, userId: 'extra-owner', role: 'Owner' });

    notifyUsers.mockClear();
    const res = await request(app)
      .post(`/api/plans/${planId}/reassign-coordinator`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'Grace@Example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe(grace.userId);

    const owners = await PlanUser.find({ planId, role: 'Owner' });
    expect(owners.map((row) => row.userId)).toEqual([grace.userId]);
    expect((await PlanUser.findOne({ planId, userId: ada.userId })).role).toBe('Collaborator');
    expect((await PlanUser.findOne({ planId, userId: alan.userId })).role).toBe('Guest');
    expect((await Plan.findById(planId)).ownerId).toBe(grace.userId);
    expect(await User.findById(ada.userId)).toBeTruthy();
    expect(await User.findById(grace.userId)).toBeTruthy();

    expect(notifyUsers).toHaveBeenCalledTimes(1);
    const [ids, message, channel] = notifyUsers.mock.calls[0];
    expect(ids.map(String).sort()).toEqual([ada.userId, grace.userId].sort());
    expect(message).toContain('Grace Hopper');
    expect(channel).toBe('email');
    expect(ids.map(String)).not.toContain(alan.userId);
  });

  test('a guest or a pending invite is 400 and a collaborator is 403', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptInvite(planId, ada.token, 'grace@example.com', 'Collaborator', grace.token);
    await acceptInvite(planId, ada.token, 'alan@example.com', 'Guest', alan.token);
    const pending = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'new.person@example.com', role: 'Collaborator' });
    expect(pending.status).toBe(201);

    const guest = await request(app)
      .post(`/api/plans/${planId}/reassign-coordinator`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com' });
    expect(guest.status).toBe(400);

    const pendingRes = await request(app)
      .post(`/api/plans/${planId}/reassign-coordinator`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'new.person@example.com' });
    expect(pendingRes.status).toBe(400);

    const collaborator = await request(app)
      .post(`/api/plans/${planId}/reassign-coordinator`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'alan@example.com' });
    expect(collaborator.status).toBe(403);

    expect((await Plan.findById(planId)).ownerId).toBe(ada.userId);
    expect((await PlanUser.findOne({ planId, userId: ada.userId })).role).toBe('Owner');
    expect((await PlanUser.findOne({ planId, userId: grace.userId })).role).toBe('Collaborator');
    expect(await PlanUser.findOne({ planId, userId: 'new.person@example.com' })).toBeNull();
    expect(await Invitation.findOne({ planId, email: 'new.person@example.com', status: 'pending' })).toBeTruthy();
    expect(await User.findById(ada.userId)).toBeTruthy();
    expect(await User.findById(grace.userId)).toBeTruthy();
  });
});

describe('POST /api/plans/:planId/invite replaces a removed invitation', () => {
  test('a removed collaborator can be invited again as Guest, and any removed role works', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);

    const pendingFirst = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'new.person@example.com', role: 'Collaborator' });
    expect(pendingFirst.status).toBe(201);
    const pendingAgain = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'new.person@example.com', role: 'Guest' });
    expect(pendingAgain.status).toBe(201);
    expect(pendingAgain.body.invitation.role).toBe('Guest');
    expect(pendingAgain.body.invitation.status).toBe('pending');
    const pendingRows = await Invitation.find({ planId, email: 'new.person@example.com' });
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0]._id).toBe(pendingAgain.body.invitation._id);
    expect(pendingRows[0].role).toBe('Guest');
    expect(pendingRows[0]._id).not.toBe(pendingFirst.body.invitation._id);

    const collaboratorInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect(collaboratorInvite.status).toBe(201);
    expect((await request(app)
      .post(`/api/invites/invitations/${collaboratorInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const removed = await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com' });
    expect(removed.status).toBe(200);
    expect(await PlanUser.findOne({ planId, userId: grace.userId })).toBeNull();
    const accepted = await Invitation.findOne({
      planId,
      userId: grace.userId,
      status: 'accepted',
    });
    expect(accepted).toBeTruthy();
    await Invitation.create({
      _id: 'stale-pending-grace',
      planId,
      userId: grace.userId,
      email: 'grace@example.com',
      invitedBy: ada.userId,
      role: 'Collaborator',
      status: 'pending',
    });

    const again = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'Grace@Example.com', role: 'Guest' });
    expect(again.status).toBe(201);
    expect(again.body.invitation.role).toBe('Guest');
    expect(again.body.invitation.status).toBe('pending');
    const graceRows = await Invitation.find({
      planId,
      $or: [{ email: 'grace@example.com' }, { userId: grace.userId }],
    });
    expect(graceRows).toHaveLength(1);
    expect(graceRows[0].role).toBe('Guest');
    expect(graceRows[0].status).toBe('pending');
    expect(graceRows[0]._id).toBe(again.body.invitation._id);
    expect(await Invitation.findById(accepted._id)).toBeNull();
    expect(await Invitation.findById('stale-pending-grace')).toBeNull();
    expect(await PlanUser.findOne({ planId, userId: grace.userId })).toBeNull();

    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect((await request(app)
      .post(`/api/invites/invitations/${guestInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ status: 'accepted' })).status).toBe(200);
    expect((await request(app)
      .delete(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com' })).status).toBe(200);

    const guestAgain = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Collaborator' });
    expect(guestAgain.status).toBe(201);
    expect(guestAgain.body.invitation.role).toBe('Collaborator');
    const alanRows = await Invitation.find({ planId, userId: alan.userId });
    expect(alanRows).toHaveLength(1);
    expect(alanRows[0].role).toBe('Collaborator');
    expect(alanRows[0].status).toBe('pending');
  });

  test('a person who is still a member is rejected', async () => {
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
    const invite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect(invite.status).toBe(201);
    expect((await request(app)
      .post(`/api/invites/invitations/${invite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const denied = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Guest' });
    expect(denied.status).toBe(400);
    expect(denied.body.msg).toBe('User already invited');

    const rows = await Invitation.find({ planId, userId: grace.userId });
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(invite.body.invitation._id);
    expect(rows[0].role).toBe('Collaborator');
    expect(rows[0].status).toBe('accepted');
    expect((await PlanUser.findOne({ planId, userId: grace.userId })).role).toBe('Collaborator');
  });
});

describe('POST /api/plans/:planId/invite/resend', () => {
  function signupUrl(email) {
    return `https://planitvibe.com/signup?email=${encodeURIComponent(email)}`;
  }

  test('no token is 401', async () => {
    const res = await request(app)
      .post('/api/plans/any-plan/invite/resend')
      .send({ email: 'ada@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('No token, authorization denied');
  });

  test('owner resends a pending invite without a new row or a new role', async () => {
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
    const collaboratorInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect(collaboratorInvite.status).toBe(201);
    const collaboratorId = collaboratorInvite.body.invitation._id;

    notifyUsers.mockClear();
    const resent = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'Grace@Example.com' });
    expect(resent.status).toBe(200);
    expect(resent.body.msg).toBe('Invitation sent!');
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      [grace.userId],
      inviteeMail({ planName: 'Paris', planType: 'trip', storedRole: 'Collaborator' }),
      'email',
    );
    const collaboratorRows = await Invitation.find({ planId, userId: grace.userId });
    expect(collaboratorRows).toHaveLength(1);
    expect(collaboratorRows[0]._id).toBe(collaboratorId);
    expect(collaboratorRows[0].role).toBe('Collaborator');
    expect(collaboratorRows[0].status).toBe('pending');
    expect(collaboratorRows[0].invitedBy).toBe(ada.userId);

    const guestEmail = 'new.person@example.com';
    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: guestEmail, role: 'Guest' });
    expect(guestInvite.status).toBe(201);
    const guestId = guestInvite.body.invitation._id;
    notifyUsers.mockClear();
    const guestResent = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: guestEmail });
    expect(guestResent.status).toBe(200);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      [guestEmail],
      inviteeMail({
        planName: 'Paris',
        planType: 'trip',
        storedRole: 'Guest',
        signupUrl: signupUrl(guestEmail),
      }),
      'email',
    );
    const guestRows = await Invitation.find({ planId, email: guestEmail });
    expect(guestRows).toHaveLength(1);
    expect(guestRows[0]._id).toBe(guestId);
    expect(guestRows[0].role).toBe('Guest');
    expect(guestRows[0].status).toBe('pending');
    expect(guestRows[0].userId).toBeFalsy();
  });

  test('a collaborator may resend a guest, and anyone else pending is refused', async () => {
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
    const alan = await registerAndLogin({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
    });
    const planId = await createPlan(ada.token);

    const collaboratorInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'grace@example.com', role: 'Collaborator' });
    expect((await request(app)
      .post(`/api/invites/invitations/${collaboratorInvite.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    const guestEmail = 'new.person@example.com';
    const guestInvite = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: guestEmail, role: 'Guest' });
    expect(guestInvite.status).toBe(201);
    const pendingCollaborator = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'bea@example.com', role: 'Collaborator' });
    expect(pendingCollaborator.status).toBe(201);

    notifyUsers.mockClear();
    const guestResent = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: guestEmail });
    expect(guestResent.status).toBe(200);
    expect(notifyUsers).toHaveBeenCalledWith(
      [guestEmail],
      inviteeMail({
        planName: 'Paris',
        planType: 'trip',
        storedRole: 'Guest',
        signupUrl: signupUrl(guestEmail),
      }),
      'email',
    );
    expect(await Invitation.countDocuments({ planId, email: guestEmail })).toBe(1);
    expect((await Invitation.findOne({ planId, email: guestEmail })).role).toBe('Guest');

    notifyUsers.mockClear();
    const collaboratorDenied = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ email: 'bea@example.com' });
    expect(collaboratorDenied.status).toBe(403);
    expect(collaboratorDenied.body.msg).toBe('Only Owner can resend a Collaborator invite');
    expect(notifyUsers).not.toHaveBeenCalled();
    expect((await Invitation.findById(pendingCollaborator.body.invitation._id)).role).toBe('Collaborator');
    expect(await Invitation.countDocuments({ planId, email: 'bea@example.com' })).toBe(1);

    const acceptedGuest = await request(app)
      .post(`/api/plans/${planId}/invite`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com', role: 'Guest' });
    expect((await request(app)
      .post(`/api/invites/invitations/${acceptedGuest.body.invitation._id}/respond`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ status: 'accepted' })).status).toBe(200);

    notifyUsers.mockClear();
    const notPending = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'alan@example.com' });
    expect(notPending.status).toBe(400);
    expect(notPending.body.msg).toBe('This person is not pending');
    expect(notifyUsers).not.toHaveBeenCalled();
    expect((await Invitation.findById(acceptedGuest.body.invitation._id)).status).toBe('accepted');

    const unknown = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.msg).toBe('This person is not pending');

    await Invitation.create({
      _id: 'rejected-row',
      planId,
      email: 'rejected@example.com',
      invitedBy: ada.userId,
      role: 'Guest',
      status: 'rejected',
    });
    const rejected = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ email: 'rejected@example.com' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.msg).toBe('This person is not pending');
    expect((await Invitation.findById('rejected-row')).status).toBe('rejected');

    const missing = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.msg).toBe('Missing email');

    const guestDenied = await request(app)
      .post(`/api/plans/${planId}/invite/resend`)
      .set('Authorization', `Bearer ${alan.token}`)
      .send({ email: guestEmail });
    expect(guestDenied.status).toBe(403);
    expect(guestDenied.body.msg).toBe('Access denied: insufficient plan role');
    expect(await Invitation.countDocuments({ planId, email: guestEmail })).toBe(1);
    expect((await Invitation.findOne({ planId, email: guestEmail })).status).toBe('pending');
  });
});
