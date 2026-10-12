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

function iso(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function legView(leg) {
  return {
    origin: leg.origin,
    destination: leg.destination,
    departure: iso(leg.departure),
    arrival: iso(leg.arrival),
  };
}

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
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('flight legs', () => {
  const firstDeparture = '2026-07-02T12:00:00.000Z';
  const firstArrival = '2026-07-02T15:00:00.000Z';
  const secondDeparture = '2026-07-02T18:00:00.000Z';
  const lastArrival = '2026-07-02T22:00:00.000Z';

  function twoLegs() {
    return [
      {
        origin: '  ATL ',
        destination: 'DFW',
        departure: firstDeparture,
        arrival: firstArrival,
      },
      {
        origin: 'ORD',
        destination: ' SEA ',
        departure: secondDeparture,
        arrival: lastArrival,
      },
    ];
  }

  test('a flight stores each leg and the activity span follows the legs', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-legs@example.com',
    });
    const planId = await createPlan(ada.token);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T01:00:00.000Z',
        durationMinutes: 5,
        startTimeZone: 'America/New_York',
        endTimeZone: 'America/Chicago',
        legs: twoLegs(),
      });

    expect(created.status).toBe(201);
    expect(iso(created.body.startTime)).toBe(firstDeparture);
    expect(iso(created.body.endTime)).toBe(lastArrival);
    expect(created.body.durationMinutes).toBe(600);
    expect(created.body.legs.map(legView)).toEqual([
      {
        origin: 'ATL',
        destination: 'DFW',
        departure: firstDeparture,
        arrival: firstArrival,
      },
      {
        origin: 'ORD',
        destination: 'SEA',
        departure: secondDeparture,
        arrival: lastArrival,
      },
    ]);
    expect(await Event.countDocuments({ planId })).toBe(1);

    const stored = await Event.findById(created.body._id).lean();
    expect(iso(stored.startTime)).toBe(firstDeparture);
    expect(iso(stored.endTime)).toBe(lastArrival);
    expect(stored.legs.map(legView)).toEqual(created.body.legs.map(legView));
  });

  test('a guest can read legs and cannot change them', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-legs-read@example.com',
    });
    const sam = await registerAndLogin({
      firstName: 'Sam',
      lastName: 'Guest',
      email: 'sam-legs@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, sam.token, planId, 'sam-legs@example.com', 'Guest');

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTimeZone: 'UTC',
        endTimeZone: 'UTC',
        legs: twoLegs(),
      });
    expect(created.status).toBe(201);

    const itinerary = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(itinerary.status).toBe(200);
    const row = itinerary.body.events.find((event) => event._id === created.body._id);
    expect(row.legs.map(legView)).toEqual(created.body.legs.map(legView));

    const denied = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${sam.token}`)
      .send({
        name: 'Changed',
        legs: [{ origin: 'JFK', destination: 'LAX', departure: firstDeparture, arrival: lastArrival }],
      });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only Owner or Collaborator can change activities');

    const stored = await Event.findById(created.body._id).lean();
    expect(stored.name).toBe('DL 961');
    expect(stored.legs.map(legView)).toEqual(created.body.legs.map(legView));
  });

  test('omitting legs on update keeps them, and another type clears them', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-legs-keep@example.com',
    });
    const planId = await createPlan(ada.token);
    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTimeZone: 'UTC',
        endTimeZone: 'UTC',
        legs: twoLegs(),
      });
    expect(created.status).toBe(201);

    const renamed = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ name: 'DL 962' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('DL 962');
    expect(iso(renamed.body.startTime)).toBe(firstDeparture);
    expect(iso(renamed.body.endTime)).toBe(lastArrival);
    expect(renamed.body.legs.map(legView)).toEqual(created.body.legs.map(legView));

    const dining = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'dining' });
    expect(dining.status).toBe(200);
    expect(dining.body.type).toBe('dining');
    expect(dining.body.legs).toEqual([]);
    const stored = await Event.findById(created.body._id).lean();
    expect(stored.legs).toEqual([]);
  });

  test('a non-flight stores no legs, and an empty leg list does not replace the times', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-legs-empty@example.com',
    });
    const planId = await createPlan(ada.token);

    const dinner = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: firstDeparture,
        endTime: firstArrival,
        legs: twoLegs(),
      });
    expect(dinner.status).toBe(201);
    expect(dinner.body.legs).toEqual([]);
    expect(iso(dinner.body.startTime)).toBe(firstDeparture);
    expect(iso(dinner.body.endTime)).toBe(firstArrival);

    const flight = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTime: firstDeparture,
        endTime: firstArrival,
        startTimeZone: 'UTC',
        endTimeZone: 'UTC',
      });
    expect(flight.status).toBe(201);

    const cleared = await request(app)
      .put(`/api/activities/${flight.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        legs: [],
        startTime: secondDeparture,
        endTime: lastArrival,
      });
    expect(cleared.status).toBe(200);
    expect(cleared.body.legs).toEqual([]);
    expect(iso(cleared.body.startTime)).toBe(secondDeparture);
    expect(iso(cleared.body.endTime)).toBe(lastArrival);
  });

  test('an invalid leg time is stored as null and does not keep a different activity time', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-legs-invalid@example.com',
    });
    const planId = await createPlan(ada.token);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTime: '2026-08-01T00:00:00.000Z',
        endTime: '2026-08-01T02:00:00.000Z',
        durationMinutes: 5,
        startTimeZone: 'UTC',
        endTimeZone: 'UTC',
        legs: [
          {
            origin: 'ATL',
            destination: 'DFW',
            departure: 'not-a-date',
            arrival: lastArrival,
          },
        ],
      });

    expect(created.status).toBe(201);
    expect(created.body.startTime ?? null).toBeNull();
    expect(iso(created.body.endTime)).toBe(lastArrival);
    expect(created.body.durationMinutes ?? null).toBeNull();
    expect(created.body.legs.map(legView)).toEqual([
      {
        origin: 'ATL',
        destination: 'DFW',
        departure: null,
        arrival: lastArrival,
      },
    ]);
  });

  test('leg time zones are IANA names and set the activity zones', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-zones@example.com',
    });
    const sam = await registerAndLogin({
      firstName: 'Sam',
      lastName: 'Guest',
      email: 'sam-zones@example.com',
    });
    const planId = await createPlan(ada.token);
    await acceptRole(ada.token, sam.token, planId, 'sam-zones@example.com', 'Guest');

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T01:00:00.000Z',
        durationMinutes: 5,
        startTimeZone: 'UTC',
        endTimeZone: 'UTC',
        timeZone: 'UTC',
        legs: [
          {
            origin: 'ATL',
            originTimeZone: '  America/New_York ',
            destination: 'DFW',
            destinationTimeZone: 'America/Chicago',
            departure: firstDeparture,
            arrival: firstArrival,
          },
          {
            origin: 'ORD',
            originTimeZone: 'America/Chicago',
            destination: 'SEA',
            destinationTimeZone: 'America/Los_Angeles',
            departure: secondDeparture,
            arrival: lastArrival,
          },
        ],
      });

    expect(created.status).toBe(201);
    expect(created.body.startTimeZone).toBe('America/New_York');
    expect(created.body.endTimeZone).toBe('America/Los_Angeles');
    expect(created.body.timeZone).toBe('America/New_York');
    expect(iso(created.body.startTime)).toBe(firstDeparture);
    expect(iso(created.body.endTime)).toBe(lastArrival);
    expect(created.body.legs[0].originTimeZone).toBe('America/New_York');
    expect(created.body.legs[0].destinationTimeZone).toBe('America/Chicago');
    expect(created.body.legs[1].originTimeZone).toBe('America/Chicago');
    expect(created.body.legs[1].destinationTimeZone).toBe('America/Los_Angeles');

    const itinerary = await request(app)
      .get(`/api/plans/${planId}/itinerary`)
      .set('Authorization', `Bearer ${sam.token}`);
    expect(itinerary.status).toBe(200);
    const row = itinerary.body.events.find((event) => event._id === created.body._id);
    expect(row.legs[0].originTimeZone).toBe('America/New_York');
    expect(row.legs[1].destinationTimeZone).toBe('America/Los_Angeles');
    expect(row.startTimeZone).toBe('America/New_York');
    expect(row.endTimeZone).toBe('America/Los_Angeles');

    const renamed = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ name: 'DL 962' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.startTimeZone).toBe('America/New_York');
    expect(renamed.body.endTimeZone).toBe('America/Los_Angeles');
    expect(renamed.body.legs[0].originTimeZone).toBe('America/New_York');
    expect(renamed.body.legs[1].destinationTimeZone).toBe('America/Los_Angeles');

    const blankLegZones = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        startTimeZone: 'Europe/Paris',
        endTimeZone: 'Asia/Tokyo',
        legs: [
          {
            origin: 'ATL',
            originTimeZone: '',
            destination: 'DFW',
            destinationTimeZone: ' ',
            departure: firstDeparture,
            arrival: firstArrival,
          },
        ],
      });
    expect(blankLegZones.status).toBe(200);
    expect(blankLegZones.body.startTimeZone).toBe('Europe/Paris');
    expect(blankLegZones.body.endTimeZone).toBe('Asia/Tokyo');
    expect(blankLegZones.body.legs[0].originTimeZone).toBe('');
    expect(blankLegZones.body.legs[0].destinationTimeZone).toBe('');
  });

  test('a fixed offset or a daylight label is rejected and not stored', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada-zone-reject@example.com',
    });
    const planId = await createPlan(ada.token);

    const offsetLeg = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTimeZone: 'UTC',
        endTimeZone: 'UTC',
        legs: [
          {
            origin: 'ATL',
            originTimeZone: '-05:00',
            destination: 'DFW',
            destinationTimeZone: 'America/Chicago',
            departure: firstDeparture,
            arrival: firstArrival,
          },
        ],
      });
    expect(offsetLeg.status).toBe(400);
    expect(offsetLeg.body.message).toBe('Time zone must be an IANA name');
    expect(await Event.countDocuments({ planId })).toBe(0);

    const created = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        startTimeZone: 'America/New_York',
        endTimeZone: 'America/Chicago',
        legs: [
          {
            origin: 'ATL',
            originTimeZone: 'America/New_York',
            destination: 'DFW',
            destinationTimeZone: 'America/Chicago',
            departure: firstDeparture,
            arrival: firstArrival,
          },
        ],
      });
    expect(created.status).toBe(201);

    const daylightLabel = await request(app)
      .put(`/api/activities/${created.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Changed',
        legs: [
          {
            origin: 'ATL',
            originTimeZone: 'America/New_York',
            destination: 'DFW',
            destinationTimeZone: 'Eastern DT',
            departure: firstDeparture,
            arrival: firstArrival,
          },
        ],
      });
    expect(daylightLabel.status).toBe(400);
    expect(daylightLabel.body.message).toBe('Time zone must be an IANA name');
    const storedFlight = await Event.findById(created.body._id).lean();
    expect(storedFlight.name).toBe('DL 961');
    expect(storedFlight.startTimeZone).toBe('America/New_York');
    expect(storedFlight.legs[0].destinationTimeZone).toBe('America/Chicago');

    const dinner = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: firstDeparture,
        endTime: firstArrival,
        timeZone: '-05:00',
      });
    expect(dinner.status).toBe(400);
    expect(dinner.body.message).toBe('Time zone must be an IANA name');
    expect(await Event.countDocuments({ planId, type: 'dining' })).toBe(0);

    const keptDinner = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        startTime: firstDeparture,
        endTime: firstArrival,
        timeZone: 'Europe/Paris',
        legs: [
          {
            origin: 'ATL',
            originTimeZone: '-05:00',
            destination: 'DFW',
            destinationTimeZone: 'Eastern DT',
            departure: firstDeparture,
            arrival: firstArrival,
          },
        ],
      });
    expect(keptDinner.status).toBe(201);
    expect(keptDinner.body.legs).toEqual([]);
    expect(keptDinner.body.timeZone).toBe('Europe/Paris');

    const rejectedDinner = await request(app)
      .put(`/api/activities/${keptDinner.body._id}`)
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ name: 'Late dinner', timeZone: '-05:00' });
    expect(rejectedDinner.status).toBe(400);
    expect(rejectedDinner.body.message).toBe('Time zone must be an IANA name');
    const storedDinner = await Event.findById(keptDinner.body._id).lean();
    expect(storedDinner.name).toBe('Dinner');
    expect(storedDinner.timeZone).toBe('Europe/Paris');
  });
});
