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
const { Event } = require('../models/Event');
const { notifyUsers } = require('../utils/notifications');
const { upgradeBody } = require('../utils/membershipTiers');
const { ARCHIVED_MESSAGE } = require('../utils/planArchive');

jest.setTimeout(30000);

let mongo;

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function iso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function legView(leg) {
  return {
    origin: leg.origin,
    originTimeZone: leg.originTimeZone || '',
    destination: leg.destination,
    destinationTimeZone: leg.destinationTimeZone || '',
    departure: iso(leg.departure),
    arrival: iso(leg.arrival),
    durationMinutes: leg.durationMinutes,
  };
}

function linkView(link) {
  return { linkName: link.linkName, linkUrl: link.linkUrl };
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
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('copy plan', () => {
  test('the owner gets a new plan with the same activities, and the cap still applies', async () => {
    const ada = await registerAndLogin('ada-copy@example.com', 'Ada');
    const grace = await registerAndLogin('grace-copy@example.com', 'Grace');
    const alan = await registerAndLogin('alan-copy@example.com', 'Alan');
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
        serviceProvider: 'Delta',
        confirmation: 'ABC123',
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
        autoCalculateStartDate: true,
        autoCalculateEndDate: false,
      });
    expect(edited.status).toBe(200);

    const foreign = await Event.create({
      _id: 'foreign-activity',
      name: 'Stay home',
      type: 'tour',
      planId: 'other-plan',
      ownerId: grace.userId,
      googlePlaceId: 'ChIJ-other',
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
      storageKey: 'copy-test/ticket.pdf',
    });
    await Plan.updateOne(
      { _id: planId },
      {
        $set: {
          planningState: 'reviewing',
          location: 'Left Bank',
          sourcePlanId: 'other-plan',
          linkedActivityIds: [foreign._id],
          activityIds: ['not-copied'],
          participants: [{ userId: new mongoose.Types.ObjectId(), role: 'Wanderer' }],
        },
      },
    );
    await acceptRole(ada.token, grace.token, planId, 'grace-copy@example.com', 'Collaborator');
    await acceptRole(ada.token, alan.token, planId, 'alan-copy@example.com', 'Guest');

    const sourcePlan = await Plan.findById(planId).lean();
    const sourceActivities = await Event.find({ planId }).lean();
    expect(sourceActivities).toHaveLength(2);
    const sourceIds = sourceActivities.map((row) => row._id).sort();
    const callsBefore = notifyUsers.mock.calls.length;

    const collaborator = await request(app)
      .post(`/api/plans/${planId}/copy`)
      .set(bearer(grace.token))
      .send({});
    expect(collaborator.status).toBe(403);
    expect(collaborator.body).toEqual({ message: 'Only the Owner can copy a plan.' });

    const guest = await request(app)
      .post(`/api/plans/${planId}/copy`)
      .set(bearer(alan.token))
      .send({});
    expect(guest.status).toBe(403);
    expect(guest.body).toEqual({ message: 'Only the Owner can copy a plan.' });

    const badName = await request(app)
      .post(`/api/plans/${planId}/copy`)
      .set(bearer(ada.token))
      .send({ name: 4 });
    expect(badName.status).toBe(400);
    expect(badName.body).toEqual({ message: 'Name must be text.' });

    const copied = await request(app)
      .post(`/api/plans/${planId}/copy`)
      .set(bearer(ada.token))
      .send({});
    expect(copied.status).toBe(201);
    expect(notifyUsers.mock.calls.length).toBe(callsBefore);
    const plan = copied.body.plan;
    expect(plan._id).not.toBe(planId);
    expect(plan.name).toBe('Copy of Paris week');
    expect(plan.type).toBe('trip');
    expect(plan.destination).toBe('Paris');
    expect(plan.location).toBe('Left Bank');
    expect(plan.budget).toBe(250);
    expect(plan.timeZone).toBe('Europe/Paris');
    expect(plan.hiddenFields).toEqual(['budget']);
    expect(plan.planningState).toBe('reviewing');
    expect(plan.autoCalculateStartDate).toBe(true);
    expect(plan.autoCalculateEndDate).toBe(false);
    expect(iso(plan.startDate)).toBe(iso(sourcePlan.startDate));
    expect(iso(plan.endDate)).toBe(iso(sourcePlan.endDate));
    expect(plan.ownerId).toBe(ada.userId);
    expect(plan.status).toBe('active');
    expect(plan.archiveDescription || '').toBe('');
    expect(plan.archivedAt == null).toBe(true);
    expect(plan.archivedBy == null).toBe(true);
    expect(plan.sourcePlanId || '').toBe('');
    expect(plan.linkedActivityIds || []).toEqual([]);
    expect(plan.activityIds || []).toEqual([]);
    expect(plan.participants || []).toEqual([]);

    const members = await PlanUser.find({ planId: plan._id }).lean();
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(ada.userId);
    expect(members[0].role).toBe('Owner');
    expect(await Invitation.countDocuments({ planId: plan._id })).toBe(0);
    expect(await Attachment.countDocuments({ planId: plan._id })).toBe(0);
    expect(await Attachment.countDocuments({ planId })).toBe(1);
    expect(await ActivityRevision.countDocuments({ planId: plan._id })).toBe(0);
    expect(await Event.countDocuments({ planId: 'other-plan' })).toBe(1);

    const copies = await Event.find({ planId: plan._id }).lean();
    expect(copies).toHaveLength(2);
    expect(copies.map((row) => row._id).sort()).not.toEqual(sourceIds);
    for (const source of sourceActivities) {
      const match = copies.find((row) => row.name === source.name);
      expect(match).toBeTruthy();
      expect(match._id).not.toBe(source._id);
      expect(match.planId).toBe(plan._id);
      expect(match.ownerId).toBe(ada.userId);
      expect(match.type).toBe(source.type);
      expect(match.googlePlaceId).toBe(source.googlePlaceId);
      expect(match.cost).toBe(source.cost);
      expect(match.costType).toBe(source.costType);
      expect(match.location).toBe(source.location);
      expect(match.details).toBe(source.details);
      expect(match.bookingReference).toBe(source.bookingReference);
      expect(iso(match.startTime)).toBe(iso(source.startTime));
      expect(iso(match.endTime)).toBe(iso(source.endTime));
      expect((match.legs || []).map(legView)).toEqual((source.legs || []).map(legView));
      expect((match.urlLinks || []).map(linkView)).toEqual((source.urlLinks || []).map(linkView));
    }
    expect(copies.some((row) => row._id === foreign._id)).toBe(false);
    const stillThere = await Event.find({ planId }).select('_id').lean();
    expect(stillThere.map((row) => row._id).sort()).toEqual(sourceIds);

    const logged = await SupportLog.findOne({ event: 'PlanCopied', planId: plan._id }).lean();
    expect(logged).toBeTruthy();
    expect(String(logged.extra.sourcePlanId)).toBe(planId);

    const owned = await request(app)
      .get('/api/users/me/ai-credits')
      .set(bearer(ada.token));
    expect(owned.status).toBe(200);
    expect(owned.body.plansOwned).toBe(2);

    const capped = await request(app)
      .post(`/api/plans/${planId}/copy`)
      .set(bearer(ada.token))
      .send({});
    expect(capped.status).toBe(402);
    expect(capped.body).toEqual(upgradeBody('trial'));
    expect(await Plan.countDocuments({ ownerId: ada.userId })).toBe(2);

    const archived = await request(app)
      .post(`/api/plans/${planId}/archive`)
      .set(bearer(ada.token))
      .send({ description: 'Done' });
    expect(archived.status).toBe(200);
    const archivedCopy = await request(app)
      .post(`/api/plans/${planId}/copy`)
      .set(bearer(ada.token))
      .send({});
    expect(archivedCopy.status).toBe(403);
    expect(archivedCopy.body).toEqual({ message: ARCHIVED_MESSAGE });

    const named = await request(app)
      .post(`/api/plans/${plan._id}/copy`)
      .set(bearer(ada.token))
      .send({ name: '  Weekend trip  ' });
    expect(named.status).toBe(201);
    expect(named.body.plan._id).not.toBe(plan._id);
    expect(named.body.plan.name).toBe('Weekend trip');
    expect(named.body.plan.ownerId).toBe(ada.userId);
    expect(await Event.countDocuments({ planId: named.body.plan._id })).toBe(2);
    const after = await request(app)
      .get('/api/users/me/ai-credits')
      .set(bearer(ada.token));
    expect(after.body.plansOwned).toBe(2);

    const listed = await request(app).get('/api/plans').set(bearer(ada.token));
    expect(listed.status).toBe(200);
    expect(listed.body.plans.map((row) => row.name).sort()).toEqual([
      'Copy of Paris week',
      'Weekend trip',
    ]);
  });
});
