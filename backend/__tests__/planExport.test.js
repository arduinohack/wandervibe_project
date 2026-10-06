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
const { parseCsv } = require('../utils/csvPlanImport');

jest.setTimeout(30000);

let mongo;

const fields = [
  'name',
  'type',
  'start',
  'end',
  'duration',
  'location',
  'details',
  'googlePlaceId',
  'bookingReference',
  'cost',
  'costType',
  'gate',
  'baggageClaim',
  'roomNumber',
  'serviceProvider',
  'status',
  'customType',
  'urlLinks',
];

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

function exportStamp(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear() % 100).padStart(2, '0');
  return `${month}-${day}-${year}`;
}

function getExport(token, planId, query) {
  const req = request(app).get(`/api/plans/${planId}/export`).query(query);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

function getXlsx(token, planId, query) {
  const req = request(app)
    .get(`/api/plans/${planId}/export`)
    .query(query)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
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

async function seedPlan(owner) {
  const planRes = await request(app)
    .post('/api/plans')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({
      type: 'trip',
      name: 'Paris Trip',
      destination: 'Paris',
      timeZone: 'America/New_York',
    });
  expect(planRes.status).toBe(201);
  const planId = planRes.body.plan._id;
  await Event.create({
    _id: 'gap-row',
    name: 'Gap',
    type: 'activity',
    planId,
    ownerId: owner.userId,
    eventNum: 1,
    startTime: new Date('2026-10-05T14:00:00.000Z'),
  });
  await Event.create({
    _id: 'activity-should-stay-out',
    name: 'Airport',
    type: 'car',
    planId,
    ownerId: owner.userId,
    eventNum: 2,
    startTime: new Date('2026-10-05T14:00:00.000Z'),
    endTime: new Date('2026-10-05T16:00:00.000Z'),
    startTimeZone: 'America/New_York',
    endTimeZone: 'America/Chicago',
    timeZone: 'America/New_York',
    durationMinutes: 120,
    location: 'Terminal',
    details: 'Across town',
    googlePlaceId: 'place-1',
    bookingReference: 'ABC123',
    cost: 12.5,
    costType: 'actual',
    gate: 'A12',
    baggageClaim: '3',
    roomNumber: '101',
    serviceProvider: 'Hertz',
    status: 'complete',
    customType: 'shuttle',
    urlLinks: [{ linkName: 'Map', linkUrl: 'https://example.com/map' }],
  });
  await Event.updateOne(
    { _id: 'gap-row' },
    {
      $unset: {
        cost: 1,
        costType: 1,
        durationMinutes: 1,
        duration: 1,
        status: 1,
        googlePlaceId: 1,
        customType: 1,
        endTime: 1,
      },
    },
  );
  await Event.create({
    _id: 'other-plan-row',
    name: 'Elsewhere',
    type: 'tour',
    planId: 'some-other-plan',
    ownerId: owner.userId,
    eventNum: 1,
  });
  return planId;
}

describe('plan export', () => {
  test('owner csv export uses stored values and does not create a plan', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await seedPlan(ada);
    const beforePlans = await Plan.countDocuments();

    const exported = await getExport(ada.token, planId, {
      format: 'csv',
      fields: fields.join(','),
    });

    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toMatch(/text\/csv/);
    expect(exported.headers['content-disposition']).toContain(`Paris Trip ${exportStamp()}.csv`);
    expect(await Plan.countDocuments()).toBe(beforePlans);

    const table = parseCsv(exported.text).filter((row) => row.some((cell) => cell !== ''));
    expect(table[0]).toEqual(fields);
    expect(table[1][0]).toBe('Gap');
    expect(table[1][1]).toBe('activity');
    expect(table[1][2]).toBe('10/05/26 10:00 EDT');
    expect(table[1][3]).toBe('');
    expect(table[1][4]).toBe('');
    expect(table[1][9]).toBe('');
    expect(table[2]).toEqual([
      'Airport',
      'car',
      '10/05/26 10:00 EDT',
      '10/05/26 11:00 CDT',
      '120',
      'Terminal',
      'Across town',
      'place-1',
      'ABC123',
      '12.5',
      'actual',
      'A12',
      '3',
      '101',
      'Hertz',
      'complete',
      'shuttle',
      '[{"linkName":"Map","linkUrl":"https://example.com/map"}]',
    ]);
    expect(exported.text).not.toContain('activity-should-stay-out');
    expect(exported.text).not.toContain('Elsewhere');
    expect(exported.text).not.toContain(planId);
    expect(exported.text).not.toContain('eventNum');
    expect(exported.text).not.toContain('Drive');
  });

  test('excel export downloads an xlsx file', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await seedPlan(ada);
    const exported = await getXlsx(ada.token, planId, {
      format: 'xlsx',
      fields: 'name,type,cost',
    });

    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(exported.headers['content-disposition']).toContain(`Paris Trip ${exportStamp()}.xlsx`);
    expect(Buffer.isBuffer(exported.body)).toBe(true);
    expect(exported.body.subarray(0, 2).toString('utf8')).toBe('PK');
    const sheet = exported.body.toString('utf8');
    expect(sheet).toContain('<t>name</t>');
    expect(sheet).toContain('<t>type</t>');
    expect(sheet).toContain('<t>cost</t>');
    expect(sheet).toContain('<t>car</t>');
    expect(sheet).toContain('<v>12.5</v>');
    expect(sheet).not.toContain('activity-should-stay-out');
  });

  test('the download name is the plan name, the local date, and the format', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const stamp = exportStamp();
    const harbor = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: 'Harbor', destination: 'Harbor' });
    expect(harbor.status).toBe(201);
    const harborId = harbor.body.plan._id;

    const csv = await getExport(ada.token, harborId, { format: 'csv', fields: 'name' });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain(`filename="Harbor ${stamp}.csv"`);
    expect(csv.headers['content-disposition']).toContain(
      `filename*=UTF-8''Harbor%20${stamp}.csv`,
    );

    const xlsx = await getXlsx(ada.token, harborId, { format: 'xlsx', fields: 'name' });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-disposition']).toContain(`filename="Harbor ${stamp}.xlsx"`);
    expect(xlsx.headers['content-disposition']).toContain(
      `filename*=UTF-8''Harbor%20${stamp}.xlsx`,
    );

    const marked = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: '  a/b\\c:d"e  ', destination: 'X' });
    expect(marked.status).toBe(201);
    const markedFile = await getExport(ada.token, marked.body.plan._id, {
      format: 'csv',
      fields: 'name',
    });
    expect(markedFile.headers['content-disposition']).toContain(`filename="a b c d e ${stamp}.csv"`);

    const blank = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${ada.token}`)
      .send({ type: 'trip', name: '   ', destination: 'X' });
    expect(blank.status).toBe(201);
    const blankFile = await getExport(ada.token, blank.body.plan._id, {
      format: 'csv',
      fields: 'name',
    });
    expect(blankFile.headers['content-disposition']).toContain(`filename="plan ${stamp}.csv"`);
  });

  test('csv and excel use the fields query order as the column order', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await seedPlan(ada);
    const ordered = 'location,name,start';

    const csv = await getExport(ada.token, planId, { format: 'csv', fields: ordered });
    expect(csv.status).toBe(200);
    const table = parseCsv(csv.text).filter((row) => row.some((cell) => cell !== ''));
    expect(table[0]).toEqual(['location', 'name', 'start']);
    expect(table[1]).toEqual(['', 'Gap', '10/05/26 10:00 EDT']);
    expect(table[2]).toEqual(['Terminal', 'Airport', '10/05/26 10:00 EDT']);

    const xlsx = await getXlsx(ada.token, planId, { format: 'xlsx', fields: ordered });
    expect(xlsx.status).toBe(200);
    const sheet = xlsx.body.toString('utf8');
    expect(sheet).toContain(
      '<c r="A1" t="inlineStr"><is><t>location</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>name</t></is></c>' +
      '<c r="C1" t="inlineStr"><is><t>start</t></is></c>',
    );
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t>Terminal</t></is></c>');
    expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t>Airport</t></is></c>');
    expect(sheet).toContain('<c r="C3" t="inlineStr"><is><t>10/05/26 10:00 EDT</t></is></c>');
  });

  test('a collaborator can export and a guest is 403', async () => {
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
    const planId = await seedPlan(ada);
    await acceptRole(ada.token, grace.token, planId, 'grace@example.com', 'Collaborator');
    await acceptRole(ada.token, alan.token, planId, 'alan@example.com', 'Guest');
    const beforePlans = await Plan.countDocuments();

    const allowed = await getExport(grace.token, planId, { format: 'csv', fields: 'name' });
    expect(allowed.status).toBe(200);
    expect(parseCsv(allowed.text)[1][0]).toBe('Gap');

    const denied = await getExport(alan.token, planId, { format: 'csv', fields: 'name' });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only Owner or Collaborator can export a plan');
    expect(await Plan.countDocuments()).toBe(beforePlans);
  });

  test('export rejects a missing format, an empty field list, an unknown field, and a missing plan', async () => {
    const ada = await registerAndLogin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const planId = await seedPlan(ada);

    const noFormat = await getExport(ada.token, planId, { fields: 'name' });
    expect(noFormat.status).toBe(400);
    expect(noFormat.body.message).toBe('Query format must be csv or xlsx');

    const noFields = await getExport(ada.token, planId, { format: 'csv', fields: '' });
    expect(noFields.status).toBe(400);
    expect(noFields.body.message).toBe('At least one field is required');

    const unknown = await getExport(ada.token, planId, { format: 'csv', fields: 'name,planId' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe('Unknown export field');

    const missing = await getExport(ada.token, 'missing-plan', { format: 'csv', fields: 'name' });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Plan not found');

    const anonymous = await request(app).get(`/api/plans/${planId}/export`).query({
      format: 'csv',
      fields: 'name',
    });
    expect(anonymous.status).toBe(401);
  });
});
