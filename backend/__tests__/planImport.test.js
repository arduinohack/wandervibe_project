jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { DateTime } = require('luxon');
const app = require('../app');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');

jest.setTimeout(30000);

let mongo;

const columnMap = JSON.stringify({
  name: 'name',
  type: 'type',
  startTime: 'startTime',
  endTime: 'endTime',
  location: 'location',
});

const parisCsv = [
  'name,type,startTime,endTime,location',
  'Museum,tour,2026-06-01 15:00,2026-06-01 18:00,"Louvre, Paris"',
  'Flight,flight,2026-06-01T08:00:00Z,2026-06-01T12:00:00+02:00,CDG',
  ',tour,2026-06-01 09:00,2026-06-01 10:00,Skip me',
  'Walk,,2026-06-01 09:00,,River',
  '',
].join('\n');

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

function postImport(token, planId, csv, filename = 'import.csv') {
  const req = request(app).post(`/api/plans/${planId}/import`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.field('map', columnMap).attach('file', Buffer.from(csv, 'utf8'), filename);
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
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('csv plan import', () => {
  test('owner import creates a new plan with only that owner', async () => {
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

    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        type: 'trip',
        name: 'Paris',
        destination: 'Paris',
        location: 'Hotel',
        startDate: '2026-06-01',
        endDate: '2026-06-08',
        timeZone: 'Europe/Paris',
        budget: 50,
      });
    expect(planRes.status).toBe(201);
    const planId = planRes.body.plan._id;

    await acceptRole(ada.token, grace.token, planId, 'grace@example.com', 'Collaborator');
    await acceptRole(ada.token, alan.token, planId, 'alan@example.com', 'Guest');

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

    const stamp = DateTime.now().setZone('Europe/Paris').toFormat('yyyy-MM-dd');
    const imported = await postImport(ada.token, planId, parisCsv);
    expect(imported.status).toBe(201);
    expect(imported.body.planId).toBeTruthy();
    expect(imported.body.planId).not.toBe(planId);
    expect(imported.body.name).toBe(`Paris ${stamp} 1`);
    expect(imported.body.inserted).toBe(3);
    expect(imported.body.skipped).toBe(1);

    const created = await Plan.findById(imported.body.planId);
    const source = await Plan.findById(planId);
    expect(created.type).toBe('trip');
    expect(created.destination).toBe('Paris');
    expect(created.location).toBe('Hotel');
    expect(created.timeZone).toBe('Europe/Paris');
    expect(created.budget).toBe(0);
    expect(new Date(created.startDate).toISOString()).toBe(new Date(source.startDate).toISOString());
    expect(new Date(created.endDate).toISOString()).toBe(new Date(source.endDate).toISOString());
    expect(created.ownerId).toBe(ada.userId);
    expect(created.participants || []).toHaveLength(0);

    const members = await PlanUser.find({ planId: imported.body.planId });
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(ada.userId);
    expect(members[0].role).toBe('Owner');
    expect(await PlanUser.findOne({ planId: imported.body.planId, userId: grace.userId })).toBeNull();
    expect(await PlanUser.findOne({ planId: imported.body.planId, userId: alan.userId })).toBeNull();

    const sourceMembers = await PlanUser.find({ planId });
    expect(sourceMembers.map((row) => row.userId).sort()).toEqual(
      [ada.userId, grace.userId, alan.userId].sort(),
    );

    const activities = await Event.find({ planId: imported.body.planId });
    expect(activities).toHaveLength(3);
    expect(activities.every((row) => row.ownerId === ada.userId)).toBe(true);
    const museum = activities.find((row) => row.name === 'Museum');
    const flight = activities.find((row) => row.name === 'Flight');
    const walk = activities.find((row) => row.name === 'Walk');
    expect(museum.type).toBe('tour');
    expect(museum.location).toBe('Louvre, Paris');
    expect(museum.startTime.toISOString()).toBe('2026-06-01T13:00:00.000Z');
    expect(museum.endTime.toISOString()).toBe('2026-06-01T16:00:00.000Z');
    expect(flight.startTime.toISOString()).toBe('2026-06-01T08:00:00.000Z');
    expect(flight.endTime.toISOString()).toBe('2026-06-01T10:00:00.000Z');
    expect(walk.type).toBe('activity');
    expect(walk.location).toBe('River');
    expect(walk.startTime.toISOString()).toBe('2026-06-01T07:00:00.000Z');
    expect(walk.endTime == null).toBe(true);
    expect(activities.some((row) => row.name === 'Dinner')).toBe(false);

    const sourceEvents = await Event.find({ planId });
    expect(sourceEvents.map((row) => row.name)).toEqual(['Dinner']);

    const again = await postImport(
      ada.token,
      planId,
      'name,type,startTime,endTime,location\nCafe,dining,2026-06-02 12:00,,Left Bank\n',
    );
    expect(again.status).toBe(201);
    expect(again.body.name).toBe(`Paris ${stamp} 2`);
    expect(again.body.inserted).toBe(1);
    expect(again.body.skipped).toBe(0);

    const graceImport = await postImport(
      grace.token,
      planId,
      'name,type,startTime,endTime,location\nMarket,tour,2026-06-03 10:00,,Rue Cler\n',
    );
    expect(graceImport.status).toBe(201);
    expect(graceImport.body.name).toBe(`Paris ${stamp} 3`);
    const graceMembers = await PlanUser.find({ planId: graceImport.body.planId });
    expect(graceMembers).toHaveLength(1);
    expect(graceMembers[0].userId).toBe(grace.userId);
    expect(graceMembers[0].role).toBe('Owner');
    expect(await PlanUser.findOne({ planId: graceImport.body.planId, userId: ada.userId })).toBeNull();
    expect(await PlanUser.findOne({ planId: graceImport.body.planId, userId: alan.userId })).toBeNull();
  });

  test('a guest import is 403 and creates nothing', async () => {
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
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        type: 'trip',
        name: 'Paris',
        destination: 'Paris',
        timeZone: 'UTC',
      });
    expect(planRes.status).toBe(201);
    const planId = planRes.body.plan._id;
    await acceptRole(ada.token, alan.token, planId, 'alan@example.com', 'Guest');

    const beforePlans = await Plan.countDocuments();
    const beforeEvents = await Event.countDocuments();
    const denied = await postImport(alan.token, planId, parisCsv);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only Owner or Collaborator can import a plan');
    expect(await Plan.countDocuments()).toBe(beforePlans);
    expect(await Event.countDocuments()).toBe(beforeEvents);
    expect(await PlanUser.countDocuments({ userId: alan.userId, role: 'Owner' })).toBe(0);
  });

  test('an unknown plan is 404', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const res = await postImport(ada.token, 'missing-plan', parisCsv);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Plan not found');
    expect(await Plan.countDocuments()).toBe(0);
  });

  test('import without a token is 401', async () => {
    const res = await request(app).post('/api/plans/missing-plan/import');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('No token, authorization denied');
    expect(await Plan.countDocuments()).toBe(0);
  });

  test('an xlsx file is rejected', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        type: 'trip',
        name: 'Paris',
        destination: 'Paris',
        timeZone: 'UTC',
      });
    expect(planRes.status).toBe(201);
    const before = await Plan.countDocuments();
    const res = await postImport(ada.token, planRes.body.plan._id, parisCsv, 'sheet.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only a CSV file can be imported');
    expect(await Plan.countDocuments()).toBe(before);
    expect(await Event.countDocuments()).toBe(0);
  });
});
