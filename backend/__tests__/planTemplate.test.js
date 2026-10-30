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
const Attachment = require('../models/Attachment');
const ActivityRevision = require('../models/ActivityRevision');
const SupportLog = require('../models/SupportLog');
const Template = require('../models/Template');
const { Event } = require('../models/Event');
const { notifyUsers } = require('../utils/notifications');
const { upgradeBody } = require('../utils/membershipTiers');
const { ARCHIVED_MESSAGE } = require('../utils/planArchive');

jest.setTimeout(30000);

const DAY_MS = 24 * 60 * 60 * 1000;

let mongo;

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function iso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function utcDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
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
    Attachment.deleteMany({}),
    ActivityRevision.deleteMany({}),
    SupportLog.deleteMany({}),
    Template.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('plan templates', () => {
  test('saving a template leaves the plan alone, and creating from it shifts the dates', async () => {
    const open = await request(app).get('/api/templates');
    expect(open.status).toBe(401);

    const ada = await registerAndLogin('ada-template@example.com', 'Ada');
    const grace = await registerAndLogin('grace-template@example.com', 'Grace');
    const alan = await registerAndLogin('alan-template@example.com', 'Alan');
    const created = await request(app)
      .post('/api/plans')
      .set(bearer(ada.token))
      .send({
        type: 'trip',
        name: 'Paris week',
        destination: 'Paris',
        timeZone: 'UTC',
        startDate: '2026-10-27T00:00:00.000Z',
        endDate: '2026-10-30T00:00:00.000Z',
      });
    expect(created.status).toBe(201);
    const planId = created.body.plan._id;

    const flight = await request(app)
      .post('/api/activities')
      .set(bearer(ada.token))
      .send({
        name: 'DL 961',
        type: 'flight',
        planId,
        googlePlaceId: 'ChIJ-cdg',
        location: 'CDG',
        cost: 480,
        costType: 'actual',
        details: 'Overnight',
        bookingReference: 'ABC123',
        urlLinks: [{ linkName: 'Check in', linkUrl: 'https://example.com/check-in' }],
        startTimeZone: 'America/New_York',
        endTimeZone: 'Europe/Paris',
        legs: [
          {
            origin: 'ATL',
            originTimeZone: 'America/New_York',
            destination: 'CDG',
            destinationTimeZone: 'Europe/Paris',
            departure: '2026-10-28T12:00:00.000Z',
            arrival: '2026-10-28T22:00:00.000Z',
            durationMinutes: 600,
          },
        ],
      });
    expect(flight.status).toBe(201);
    const dinner = await request(app)
      .post('/api/activities')
      .set(bearer(ada.token))
      .send({
        name: 'Dinner',
        type: 'dining',
        planId,
        location: 'Le Cafe',
        googlePlaceId: 'ChIJ-cafe',
        cost: 80,
        startTime: '2026-10-29T19:00:00.000Z',
        endTime: '2026-10-29T21:00:00.000Z',
        startTimeZone: 'Europe/Paris',
        endTimeZone: 'Europe/Paris',
      });
    expect(dinner.status).toBe(201);

    const edited = await request(app)
      .put(`/api/plans/${planId}`)
      .set(bearer(ada.token))
      .send({
        budget: 250,
        timeZone: 'Europe/Paris',
        hiddenFields: ['budget'],
      });
    expect(edited.status).toBe(200);
    await Plan.updateOne(
      { _id: planId },
      {
        $set: {
          planningState: 'reviewing',
          location: 'Left Bank',
          sourcePlanId: 'other-plan',
          linkedActivityIds: ['foreign-activity'],
        },
      },
    );
    await Event.create({
      _id: 'foreign-activity',
      name: 'Stay home',
      type: 'tour',
      planId: 'other-plan',
      ownerId: grace.userId,
      cost: 10,
      startTime: new Date('2026-10-28T08:00:00.000Z'),
    });
    await Attachment.create({
      activityId: flight.body._id,
      planId,
      uploadedBy: ada.userId,
      filename: 'ticket.pdf',
      mimeType: 'application/pdf',
      size: 12,
      storageKey: 'template-test/ticket.pdf',
    });
    await acceptRole(ada.token, grace.token, planId, 'grace-template@example.com', 'Collaborator');
    await acceptRole(ada.token, alan.token, planId, 'alan-template@example.com', 'Guest');

    const beforePlan = await Plan.findById(planId).lean();
    const beforeActivities = await Event.find({ planId }).sort({ name: 1 }).lean();
    expect(beforeActivities).toHaveLength(2);

    const collaborator = await request(app)
      .post(`/api/plans/${planId}/save-as-template`)
      .set(bearer(grace.token))
      .send({ name: 'Week template' });
    expect(collaborator.status).toBe(403);
    expect(collaborator.body).toEqual({
      message: 'Only the Owner can save a plan as a template.',
    });
    const guest = await request(app)
      .post(`/api/plans/${planId}/save-as-template`)
      .set(bearer(alan.token))
      .send({ name: 'Week template' });
    expect(guest.status).toBe(403);
    expect(guest.body).toEqual({
      message: 'Only the Owner can save a plan as a template.',
    });
    const badName = await request(app)
      .post(`/api/plans/${planId}/save-as-template`)
      .set(bearer(ada.token))
      .send({ name: 4 });
    expect(badName.status).toBe(400);
    expect(badName.body).toEqual({ message: 'Name must be text.' });
    const longNote = await request(app)
      .post(`/api/plans/${planId}/save-as-template`)
      .set(bearer(ada.token))
      .send({ name: 'Week template', description: 'x'.repeat(501) });
    expect(longNote.status).toBe(400);
    expect(longNote.body).toEqual({ message: 'Description is too long.' });
    expect(await Template.countDocuments()).toBe(0);

    const callsBefore = notifyUsers.mock.calls.length;
    const saved = await request(app)
      .post(`/api/plans/${planId}/save-as-template`)
      .set(bearer(ada.token))
      .send({ name: '  Week template  ', description: '  A week in Paris  ' });
    expect(saved.status).toBe(201);
    expect(notifyUsers.mock.calls.length).toBe(callsBefore);
    const template = saved.body.template;
    expect(template._id).toBeTruthy();
    expect(template._id).not.toBe(planId);
    expect(template.name).toBe('Week template');
    expect(template.description).toBe('A week in Paris');
    expect(template.ownerId).toBe(ada.userId);
    expect(template.sourcePlanId).toBe(planId);
    expect(template.type).toBe('trip');
    expect(template.destination).toBe('Paris');
    expect(template.location).toBe('Left Bank');
    expect(template.budget).toBe(250);
    expect(template.timeZone).toBe('Europe/Paris');
    expect(template.hiddenFields).toEqual(['budget']);
    expect(template.planningState).toBe('reviewing');
    expect(template.activities).toHaveLength(2);
    for (const snap of template.activities) {
      expect(snap._id).toBeUndefined();
      expect(snap.planId).toBeUndefined();
      expect(snap.ownerId).toBeUndefined();
    }
    const snapFlight = template.activities.find((row) => row.name === 'DL 961');
    const snapDinner = template.activities.find((row) => row.name === 'Dinner');
    expect(snapFlight.googlePlaceId).toBe('ChIJ-cdg');
    expect(snapFlight.cost).toBe(480);
    expect(snapFlight.legs[0].origin).toBe('ATL');
    expect(iso(snapFlight.legs[0].departure)).toBe('2026-10-28T12:00:00.000Z');
    expect(snapDinner.googlePlaceId).toBe('ChIJ-cafe');
    expect(snapDinner.cost).toBe(80);
    expect(await Plan.findById(template._id)).toBeNull();

    const afterPlan = await Plan.findById(planId).lean();
    const afterActivities = await Event.find({ planId }).sort({ name: 1 }).lean();
    expect(afterPlan.name).toBe(beforePlan.name);
    expect(afterPlan.updatedAt).toEqual(beforePlan.updatedAt);
    expect(afterActivities.map((row) => row._id)).toEqual(beforeActivities.map((row) => row._id));
    expect(afterActivities.map((row) => iso(row.startTime))).toEqual(
      beforeActivities.map((row) => iso(row.startTime)),
    );
    expect(await Event.countDocuments({ planId: 'other-plan' })).toBe(1);
    expect(await Attachment.countDocuments({ planId })).toBe(1);

    const listedPlans = await request(app).get('/api/plans').set(bearer(ada.token));
    expect(listedPlans.body.plans.map((row) => row.name)).toEqual(['Paris week']);
    const listed = await request(app).get('/api/templates').set(bearer(ada.token));
    expect(listed.status).toBe(200);
    expect(listed.body.templates.map((row) => row.name)).toEqual(['Week template']);
    expect(listed.body.templates[0].description).toBe('A week in Paris');
    expect(listed.body.templates[0].activities).toBeUndefined();
    const graceList = await request(app).get('/api/templates').set(bearer(grace.token));
    expect(graceList.body.templates).toEqual([]);
    const stolen = await request(app)
      .post(`/api/templates/${template._id}/create-plan`)
      .set(bearer(grace.token))
      .send({ name: 'November week', startDate: '2026-11-04' });
    expect(stolen.status).toBe(404);
    expect(stolen.body).toEqual({ message: 'Template not found' });

    const credits = await request(app)
      .get('/api/users/me/ai-credits')
      .set(bearer(ada.token));
    expect(credits.body.plansOwned).toBe(1);

    const missingDate = await request(app)
      .post(`/api/templates/${template._id}/create-plan`)
      .set(bearer(ada.token))
      .send({ name: 'November week' });
    expect(missingDate.status).toBe(400);
    expect(missingDate.body).toEqual({ message: 'Start date is required.' });

    const madeCalls = notifyUsers.mock.calls.length;
    const made = await request(app)
      .post(`/api/templates/${template._id}/create-plan`)
      .set(bearer(ada.token))
      .send({ name: '  November week  ', startDate: '2026-11-04' });
    expect(made.status).toBe(201);
    expect(notifyUsers.mock.calls.length).toBe(madeCalls);
    const plan = made.body.plan;
    expect(plan._id).not.toBe(planId);
    expect(plan._id).not.toBe(template._id);
    expect(plan.name).toBe('November week');
    expect(plan.ownerId).toBe(ada.userId);
    expect(plan.destination).toBe('Paris');
    expect(plan.location).toBe('Left Bank');
    expect(plan.budget).toBe(250);
    expect(plan.timeZone).toBe('Europe/Paris');
    expect(plan.hiddenFields).toEqual(['budget']);
    expect(plan.planningState).toBe('reviewing');
    expect(plan.sourcePlanId || '').toBe('');
    expect(plan.linkedActivityIds || []).toEqual([]);
    expect(plan.status).toBe('active');

    const copies = await Event.find({ planId: plan._id }).lean();
    expect(copies).toHaveLength(2);
    const flightCopy = copies.find((row) => row.name === 'DL 961');
    const dinnerCopy = copies.find((row) => row.name === 'Dinner');
    const sourceFlight = beforeActivities.find((row) => row.name === 'DL 961');
    const sourceDinner = beforeActivities.find((row) => row.name === 'Dinner');
    expect(flightCopy._id).not.toBe(sourceFlight._id);
    expect(flightCopy.planId).toBe(plan._id);
    expect(flightCopy.ownerId).toBe(ada.userId);
    expect(flightCopy.googlePlaceId).toBe('ChIJ-cdg');
    expect(flightCopy.cost).toBe(480);
    expect(utcDay(flightCopy.startTime)).toBe(Date.UTC(2026, 10, 4));
    expect(iso(flightCopy.startTime).slice(11)).toBe(iso(sourceFlight.startTime).slice(11));
    expect(utcDay(dinnerCopy.startTime) - utcDay(flightCopy.startTime)).toBe(DAY_MS);
    expect(new Date(dinnerCopy.startTime).getTime() - new Date(flightCopy.startTime).getTime())
      .toBe(new Date(sourceDinner.startTime).getTime() - new Date(sourceFlight.startTime).getTime());
    expect(iso(flightCopy.legs[0].departure).slice(11))
      .toBe(iso(sourceFlight.legs[0].departure).slice(11));
    expect(utcDay(flightCopy.legs[0].arrival)).toBe(Date.UTC(2026, 10, 4));
    expect(new Date(plan.startDate).getTime() - new Date(beforePlan.startDate).getTime())
      .toBe(new Date(flightCopy.startTime).getTime() - new Date(sourceFlight.startTime).getTime());
    expect(await PlanUser.find({ planId: plan._id }).lean()).toEqual([
      expect.objectContaining({ userId: ada.userId, role: 'Owner' }),
    ]);
    expect(await Invitation.countDocuments({ planId: plan._id })).toBe(0);
    expect(await Attachment.countDocuments({ planId: plan._id })).toBe(0);
    expect(await ActivityRevision.countDocuments({ planId: plan._id })).toBe(0);
    expect(await Event.find({ planId }).sort({ name: 1 }).lean()).toMatchObject(
      beforeActivities.map((row) => ({ _id: row._id, name: row.name })),
    );

    const owned = await request(app)
      .get('/api/users/me/ai-credits')
      .set(bearer(ada.token));
    expect(owned.body.plansOwned).toBe(2);
    const names = await request(app).get('/api/plans').set(bearer(ada.token));
    expect(names.body.plans.map((row) => row.name).sort()).toEqual([
      'November week',
      'Paris week',
    ]);

    const capped = await request(app)
      .post(`/api/templates/${template._id}/create-plan`)
      .set(bearer(ada.token))
      .send({ name: 'One more', startDate: '2026-12-01' });
    expect(capped.status).toBe(402);
    expect(capped.body).toEqual(upgradeBody('trial'));
    expect(await Plan.countDocuments({ ownerId: ada.userId })).toBe(2);
    expect(await Template.countDocuments({ ownerId: ada.userId })).toBe(1);

    const archived = await request(app)
      .post(`/api/plans/${planId}/archive`)
      .set(bearer(ada.token))
      .send({ description: 'Done' });
    expect(archived.status).toBe(200);
    const archivedSave = await request(app)
      .post(`/api/plans/${planId}/save-as-template`)
      .set(bearer(ada.token))
      .send({ name: 'Again' });
    expect(archivedSave.status).toBe(403);
    expect(archivedSave.body).toEqual({ message: ARCHIVED_MESSAGE });
    expect(await Template.countDocuments({ ownerId: ada.userId })).toBe(1);
  });
});
