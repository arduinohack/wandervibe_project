jest.mock('../utils/notifications', () => ({
  notifyUsers: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const { defaultChainStart } = require('../utils/activityChain');

jest.setTimeout(30000);

let mongo;

function iso(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function at(hours, minutes = 0) {
  return new Date(Date.UTC(2026, 6, 4, hours, minutes, 0)).toISOString();
}

async function registerAndLogin(email) {
  await allowRegister(email);
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ firstName: 'Ada', lastName: 'Lovelace', email, password: 'password1' });
  await clearRegisterInvite(email);
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password1' });
  expect(loginRes.status).toBe(200);
  return loginRes.body.token;
}

async function createPlan(token, timeZone = 'UTC') {
  const res = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'trip',
      name: 'Paris',
      destination: 'Paris',
      timeZone,
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

async function addTimed(token, planId, name, start, minutes, extra = {}) {
  const startDate = new Date(start);
  const end = new Date(startDate.getTime() + minutes * 60000);
  const res = await request(app)
    .post('/api/activities')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name,
      type: 'dining',
      planId,
      startTime: startDate.toISOString(),
      endTime: end.toISOString(),
      durationMinutes: minutes,
      ...extra,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function stored(planId) {
  const rows = await Event.find({ planId }).lean();
  rows.sort((a, b) => (Number(a.eventNum) || 0) - (Number(b.eventNum) || 0));
  return rows.map((row) => ({
    name: row.name,
    start: iso(row.startTime),
    end: iso(row.endTime),
    duration: row.durationMinutes,
  }));
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

describe('activity time chain', () => {
  test('an empty plan starts a new activity at 8:30 in the plan zone', async () => {
    // 8:30 AM Eastern Standard is 13:30 UTC.
    const january = defaultChainStart(
      [],
      'America/New_York',
      new Date('2026-01-15T15:00:00.000Z'),
    );
    expect(january.toISOString()).toBe('2026-01-15T13:30:00.000Z');

    const token = await registerAndLogin('chain-empty@example.com');
    const planId = await createPlan(token, 'America/New_York');
    const zone = 'America/New_York';
    const expected = DateTime.now().setZone(zone).startOf('day').set({
      hour: 8,
      minute: 30,
      second: 0,
      millisecond: 0,
    });

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'First',
        type: 'tour',
        planId,
        durationMinutes: 45,
      });

    expect(created.status).toBe(201);
    expect(iso(created.body.startTime)).toBe(expected.toUTC().toJSDate().toISOString());
    expect(iso(created.body.endTime)).toBe(
      expected.plus({ minutes: 45 }).toUTC().toJSDate().toISOString(),
    );
    expect(created.body.durationMinutes).toBe(45);
    const clock = DateTime.fromJSDate(new Date(created.body.startTime), { zone: 'utc' }).setZone(zone);
    expect(clock.hour).toBe(8);
    expect(clock.minute).toBe(30);
  });

  test('insert before the first activity uses 8:30 on the earliest day', async () => {
    const token = await registerAndLogin('chain-before-first@example.com');
    const planId = await createPlan(token, 'America/New_York');
    const morning = await addTimed(token, planId, 'Morning', '2026-07-04T18:00:00.000Z', 60);
    const later = await addTimed(token, planId, 'Later', '2026-07-06T16:00:00.000Z', 30);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Early',
        type: 'tour',
        planId,
        insertBefore: morning._id,
        durationMinutes: 30,
      });

    expect(created.status).toBe(201);
    // 8:30 AM Eastern Daylight on July 4 is 12:30 UTC, not the later day's morning.
    expect(iso(created.body.startTime)).toBe('2026-07-04T12:30:00.000Z');
    expect(iso(created.body.endTime)).toBe('2026-07-04T13:00:00.000Z');
    expect(created.body.durationMinutes).toBe(30);
    expect(await stored(planId)).toEqual([
      {
        name: 'Early',
        start: '2026-07-04T12:30:00.000Z',
        end: '2026-07-04T13:00:00.000Z',
        duration: 30,
      },
      {
        name: 'Morning',
        start: '2026-07-04T18:00:00.000Z',
        end: '2026-07-04T19:00:00.000Z',
        duration: 60,
      },
      {
        name: 'Later',
        start: '2026-07-06T16:00:00.000Z',
        end: '2026-07-06T16:30:00.000Z',
        duration: 30,
      },
    ]);
    expect(later.durationMinutes).toBe(30);
  });

  test('moving an activity to the front uses 8:30 and leaves the old chain', async () => {
    const token = await registerAndLogin('chain-front@example.com');
    const planId = await createPlan(token, 'America/New_York');
    const first = await addTimed(token, planId, 'First', '2026-07-04T18:00:00.000Z', 60);
    const second = await addTimed(token, planId, 'Second', '2026-07-04T19:00:00.000Z', 30);

    const moved = await request(app)
      .put(`/api/activities/${second._id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planId, activityIds: [second._id, first._id] });

    expect(moved.status).toBe(200);
    expect(await stored(planId)).toEqual([
      {
        name: 'Second',
        start: '2026-07-04T12:30:00.000Z',
        end: '2026-07-04T13:00:00.000Z',
        duration: 30,
      },
      {
        name: 'First',
        start: '2026-07-04T18:00:00.000Z',
        end: '2026-07-04T19:00:00.000Z',
        duration: 60,
      },
    ]);
  });

  test('insert before and insert after shift the joined chain and stop at a gap', async () => {
    const token = await registerAndLogin('chain-insert@example.com');
    const planId = await createPlan(token);
    const museum = await addTimed(token, planId, 'Museum', at(10), 60);
    const lunch = await addTimed(token, planId, 'Lunch', at(11), 60);
    await addTimed(token, planId, 'Show', at(14), 60);

    const before = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Coffee',
        type: 'dining',
        planId,
        insertBefore: lunch._id,
        durationMinutes: 20,
      });
    expect(before.status).toBe(201);
    expect(iso(before.body.startTime)).toBe(at(11));
    expect(iso(before.body.endTime)).toBe(at(11, 20));
    expect(before.body.durationMinutes).toBe(20);

    expect(await stored(planId)).toEqual([
      { name: 'Museum', start: at(10), end: at(11), duration: 60 },
      { name: 'Coffee', start: at(11), end: at(11, 20), duration: 20 },
      { name: 'Lunch', start: at(11, 20), end: at(12, 20), duration: 60 },
      { name: 'Show', start: at(14), end: at(15), duration: 60 },
    ]);

    const after = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Walk',
        type: 'tour',
        planId,
        insertAfter: museum._id,
        startTime: at(11),
        endTime: at(11, 30),
        durationMinutes: 30,
      });
    expect(after.status).toBe(201);
    expect(iso(after.body.startTime)).toBe(at(11));
    expect(iso(after.body.endTime)).toBe(at(11, 30));
    expect(after.body.durationMinutes).toBe(30);

    // Walk takes the 11:00 anchor. Coffee was joined to it, Lunch was joined to Coffee.
    // Show starts at 14:00, after Lunch's old 12:20 end, so it stays put.
    expect(await stored(planId)).toEqual([
      { name: 'Museum', start: at(10), end: at(11), duration: 60 },
      { name: 'Walk', start: at(11), end: at(11, 30), duration: 30 },
      { name: 'Coffee', start: at(11, 30), end: at(11, 50), duration: 20 },
      { name: 'Lunch', start: at(11, 50), end: at(12, 50), duration: 60 },
      { name: 'Show', start: at(14), end: at(15), duration: 60 },
    ]);
  });

  test('a manual start or duration edit shifts joined activities and keeps their duration', async () => {
    const token = await registerAndLogin('chain-edit@example.com');
    const planId = await createPlan(token);
    const museum = await addTimed(token, planId, 'Museum', at(10), 60);
    const flight = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'DL 100',
        type: 'flight',
        planId,
        startTimeZone: 'UTC',
        endTimeZone: 'UTC',
        legs: [{
          origin: 'ATL',
          destination: 'LGA',
          originTimeZone: 'UTC',
          destinationTimeZone: 'UTC',
          departure: at(11),
          arrival: at(12),
          durationMinutes: 60,
        }],
      });
    expect(flight.status).toBe(201);
    expect(flight.body.durationMinutes).toBe(60);
    await addTimed(token, planId, 'Show', at(14), 60);

    const renamed = await request(app)
      .put(`/api/activities/${museum._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Gallery' });
    expect(renamed.status).toBe(200);
    expect((await stored(planId)).map((row) => row.start)).toEqual([at(10), at(11), at(14)]);

    const longer = await request(app)
      .put(`/api/activities/${museum._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ endTime: at(11, 30), durationMinutes: 90 });
    expect(longer.status).toBe(200);
    expect(iso(longer.body.startTime)).toBe(at(10));
    expect(iso(longer.body.endTime)).toBe(at(11, 30));
    expect(longer.body.durationMinutes).toBe(90);

    const afterDuration = await Event.findById(flight.body._id).lean();
    expect(iso(afterDuration.startTime)).toBe(at(11, 30));
    expect(iso(afterDuration.endTime)).toBe(at(12, 30));
    expect(afterDuration.durationMinutes).toBe(60);
    expect(afterDuration.legs).toHaveLength(1);
    expect(iso(afterDuration.legs[0].departure)).toBe(at(11, 30));
    expect(iso(afterDuration.legs[0].arrival)).toBe(at(12, 30));
    expect(afterDuration.legs[0].durationMinutes).toBe(60);
    expect(afterDuration.legs[0].origin).toBe('ATL');

    const shiftedStart = await request(app)
      .put(`/api/activities/${museum._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        startTime: at(10, 30),
        endTime: at(12),
        durationMinutes: 90,
      });
    expect(shiftedStart.status).toBe(200);
    expect(iso(shiftedStart.body.startTime)).toBe(at(10, 30));
    expect(shiftedStart.body.durationMinutes).toBe(90);

    const afterStart = await Event.findById(flight.body._id).lean();
    expect(iso(afterStart.startTime)).toBe(at(12));
    expect(iso(afterStart.endTime)).toBe(at(13));
    expect(afterStart.durationMinutes).toBe(60);
    expect(iso(afterStart.legs[0].departure)).toBe(at(12));
    expect(iso(afterStart.legs[0].arrival)).toBe(at(13));
    expect(afterStart.legs[0].durationMinutes).toBe(60);

    expect(await stored(planId)).toEqual([
      { name: 'Gallery', start: at(10, 30), end: at(12), duration: 90 },
      { name: 'DL 100', start: at(12), end: at(13), duration: 60 },
      { name: 'Show', start: at(14), end: at(15), duration: 60 },
    ]);
  });

  test('moving an activity closes the joined chain it left and keeps every duration', async () => {
    const token = await registerAndLogin('chain-move@example.com');
    const planId = await createPlan(token);
    const museum = await addTimed(token, planId, 'Museum', at(10), 60);
    const lunch = await addTimed(token, planId, 'Lunch', at(11), 60);
    const walk = await addTimed(token, planId, 'Walk', at(12), 60);
    const show = await addTimed(token, planId, 'Show', at(15), 60);
    const ids = [museum._id, lunch._id, walk._id, show._id];

    const rejected = await request(app)
      .put(`/api/activities/${lunch._id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planId, activityIds: [museum._id, walk._id, show._id] });
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toBe('activityIds must list each activity once');
    expect((await stored(planId)).map((row) => row.start)).toEqual([
      at(10), at(11), at(12), at(15),
    ]);

    const moved = await request(app)
      .put(`/api/activities/${lunch._id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planId, activityIds: [museum._id, walk._id, show._id, lunch._id] });
    expect(moved.status).toBe(200);
    expect(moved.body.activityIds).toEqual([museum._id, walk._id, show._id, lunch._id]);

    // Walk was joined to Lunch, so it closes up to Museum. Show was not joined to Walk.
    // Lunch then starts when Show ends. Every duration stays the same.
    const chain = await stored(planId);
    expect(chain).toEqual([
      { name: 'Museum', start: at(10), end: at(11), duration: 60 },
      { name: 'Walk', start: at(11), end: at(12), duration: 60 },
      { name: 'Show', start: at(15), end: at(16), duration: 60 },
      { name: 'Lunch', start: at(16), end: at(17), duration: 60 },
    ]);

    const resorted = await request(app)
      .put('/api/activities/order')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId, activityIds: [lunch._id, show._id, walk._id, museum._id] });
    expect(resorted.status).toBe(200);
    const afterOrder = await Event.find({ _id: { $in: ids } }).lean();
    const byId = new Map(afterOrder.map((row) => [String(row._id), row]));
    expect(iso(byId.get(museum._id).startTime)).toBe(at(10));
    expect(iso(byId.get(walk._id).startTime)).toBe(at(11));
    expect(iso(byId.get(show._id).startTime)).toBe(at(15));
    expect(iso(byId.get(lunch._id).startTime)).toBe(at(16));
    expect(iso(byId.get(lunch._id).endTime)).toBe(at(17));
    expect(byId.get(lunch._id).durationMinutes).toBe(60);
    expect(byId.get(museum._id).eventNum).toBe(3);
    expect(byId.get(lunch._id).eventNum).toBe(0);
  });

  test('a linked plan shows source time changes and does not shift linked rows', async () => {
    const owner = await registerAndLogin('chain-owner@example.com');
    const guest = await registerAndLogin('chain-guest@example.com');
    const planId = await createPlan(owner);
    await acceptRole(owner, guest, planId, 'chain-guest@example.com', 'Guest');
    const museum = await addTimed(owner, planId, 'Museum', at(10), 60);
    const lunch = await addTimed(owner, planId, 'Lunch', at(11), 60);
    const show = await addTimed(owner, planId, 'Show', at(14), 60);

    const linked = await request(app)
      .post(`/api/plans/${planId}/link`)
      .set('Authorization', `Bearer ${guest}`)
      .send({ activityIds: [museum._id, lunch._id] });
    expect(linked.status).toBe(201);
    const personalId = linked.body.plan._id;

    const note = await addTimed(guest, personalId, 'Note', at(9), 30);
    const edited = await request(app)
      .put(`/api/activities/${museum._id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ endTime: at(11, 30), durationMinutes: 90 });
    expect(edited.status).toBe(200);

    const personal = await request(app)
      .get(`/api/plans/${personalId}/itinerary`)
      .set('Authorization', `Bearer ${guest}`);
    expect(personal.status).toBe(200);
    expect(personal.body.events.map((row) => ({
      name: row.name,
      linked: row.linked,
      start: iso(row.startTime),
      end: iso(row.endTime),
      duration: row.durationMinutes,
    }))).toEqual([
      { name: 'Note', linked: false, start: at(9), end: at(9, 30), duration: 30 },
      { name: 'Museum', linked: true, start: at(10), end: at(11, 30), duration: 90 },
      { name: 'Lunch', linked: true, start: at(11, 30), end: at(12, 30), duration: 60 },
    ]);

    const noteRow = await Event.findById(note._id).lean();
    expect(noteRow.planId).toBe(personalId);
    expect(iso(noteRow.startTime)).toBe(at(9));
    expect(iso(noteRow.endTime)).toBe(at(9, 30));
    expect(noteRow.durationMinutes).toBe(30);
    const showRow = await Event.findById(show._id).lean();
    expect(iso(showRow.startTime)).toBe(at(14));
    expect(iso(showRow.endTime)).toBe(at(15));
    expect(showRow.durationMinutes).toBe(60);

    const blocked = await request(app)
      .put(`/api/activities/${museum._id}`)
      .set('Authorization', `Bearer ${guest}`)
      .send({ endTime: at(12) });
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('Only Owner or Collaborator can change activities');
    expect(iso((await Event.findById(museum._id)).endTime)).toBe(at(11, 30));

    const blockedMove = await request(app)
      .put(`/api/activities/${lunch._id}/move`)
      .set('Authorization', `Bearer ${guest}`)
      .send({ planId: personalId, activityIds: [museum._id, lunch._id] });
    expect(blockedMove.status).toBe(403);

    const movedNote = await request(app)
      .put(`/api/activities/${note._id}/move`)
      .set('Authorization', `Bearer ${guest}`)
      .send({
        planId: personalId,
        activityIds: [museum._id, lunch._id, note._id],
      });
    expect(movedNote.status).toBe(200);
    const moved = await Event.findById(note._id).lean();
    expect(iso(moved.startTime)).toBe(at(12, 30));
    expect(iso(moved.endTime)).toBe(at(13));
    expect(moved.durationMinutes).toBe(30);
    expect(iso((await Event.findById(museum._id)).startTime)).toBe(at(10));
    expect(iso((await Event.findById(museum._id)).endTime)).toBe(at(11, 30));
    expect(iso((await Event.findById(lunch._id)).startTime)).toBe(at(11, 30));
    expect(iso((await Event.findById(lunch._id)).endTime)).toBe(at(12, 30));
    expect((await Event.findById(lunch._id)).durationMinutes).toBe(60);
  });
});
