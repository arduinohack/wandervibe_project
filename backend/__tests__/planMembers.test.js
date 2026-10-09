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
        expect(memberKeys(row)).toEqual(['email', 'name', 'role', 'status']);
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
    }

    const outsider = await request(app)
      .get(`/api/plans/${planId}/members`)
      .set('Authorization', `Bearer ${eve.token}`);
    expect(outsider.status).toBe(403);
  });
});
