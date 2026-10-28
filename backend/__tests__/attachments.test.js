const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const { allowRegister, clearRegisterInvite } = require('./inviteForRegister');
const User = require('../models/User');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const Invitation = require('../models/Invitation');
const { Event } = require('../models/Event');
const Attachment = require('../models/Attachment');
const { absolutePath } = require('../utils/attachmentStore');

jest.setTimeout(30000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const TEXT = Buffer.from('not an image');

let mongo;
let uploadDir;
const previousUpload = process.env.UPLOAD_DIR;

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
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
  return { token: loginRes.body.token, userId: loginRes.body.user._id, email };
}

async function createPlan(token) {
  const res = await request(app)
    .post('/api/plans')
    .set(bearer(token))
    .send({
      type: 'trip',
      name: 'Paris trip',
      destination: 'Paris',
      timeZone: 'UTC',
    });
  expect(res.status).toBe(201);
  return res.body.plan._id;
}

async function createActivity(token, planId) {
  const res = await request(app)
    .post('/api/activities')
    .set(bearer(token))
    .send({ planId, name: 'Museum visit', type: 'tour', durationMinutes: 60 });
  expect(res.status).toBe(201);
  return res.body._id;
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

function attach(token, activityId, buffer, filename, contentType) {
  return request(app)
    .post(`/api/activities/${activityId}/attachments`)
    .set(bearer(token))
    .attach('file', buffer, { filename, contentType });
}

beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wv-uploads-'));
  process.env.UPLOAD_DIR = uploadDir;
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
  ]);
  const names = await fs.readdir(uploadDir);
  await Promise.all(names.map((name) => fs.rm(path.join(uploadDir, name), { recursive: true, force: true })));
});

afterAll(async () => {
  if (previousUpload == null) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUpload;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe('activity attachments', () => {
  test('a member can upload, list, and download an image or PDF', async () => {
    const owner = await registerAndLogin('ada-file@example.com');
    const guest = await registerAndLogin('gus-file@example.com');
    const planId = await createPlan(owner.token);
    await acceptRole(owner.token, guest.token, planId, guest.email, 'Guest');
    const activityId = await createActivity(owner.token, planId);

    const missing = await request(app).get(`/api/activities/${activityId}/attachments`);
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe('No token, authorization denied');

    const uploaded = await attach(owner.token, activityId, PNG, 'photo.png', 'image/png');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.storageKey).toBeUndefined();
    expect(uploaded.body.activityId).toBe(activityId);
    expect(uploaded.body.planId).toBe(planId);
    expect(uploaded.body.uploadedBy).toBe(owner.userId);
    expect(uploaded.body.filename).toBe('photo.png');
    expect(uploaded.body.mimeType).toBe('image/png');
    expect(uploaded.body.size).toBe(PNG.length);
    expect(uploaded.body.id).toBeTruthy();

    const stored = await Attachment.findById(uploaded.body.id).select('+storageKey').lean();
    expect(stored.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f-]{36}$/);
    const onDisk = absolutePath(stored.storageKey);
    const relative = path.relative(uploadDir, onDisk);
    expect(relative.startsWith('..')).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
    expect(await fs.readFile(onDisk)).toEqual(PNG);

    const pdf = await attach(owner.token, activityId, PDF, 'ticket.txt', 'text/plain');
    expect(pdf.status).toBe(201);
    expect(pdf.body.mimeType).toBe('application/pdf');
    expect(pdf.body.filename).toBe('ticket.pdf');

    const guestUpload = await attach(guest.token, activityId, PNG, 'nope.png', 'image/png');
    expect(guestUpload.status).toBe(403);
    expect(guestUpload.body.message).toBe('Only Owner or Collaborator can add attachments');

    const listed = await request(app)
      .get(`/api/activities/${activityId}/attachments`)
      .set(bearer(guest.token));
    expect(listed.status).toBe(200);
    expect(listed.body.map((row) => row.id).sort()).toEqual(
      [uploaded.body.id, pdf.body.id].sort(),
    );
    expect(listed.body.every((row) => row.storageKey == null)).toBe(true);

    const file = await request(app)
      .get(`/api/attachments/${uploaded.body.id}/file`)
      .set(bearer(guest.token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/^image\/png/);
    expect(file.headers['content-disposition']).toContain('photo.png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.isBuffer(file.body)).toBe(true);
    expect(file.body.equals(PNG)).toBe(true);
  });

  test('rejects other file types, files over 10 MB, and a sixth attachment', async () => {
    const owner = await registerAndLogin('ada-limit@example.com');
    const planId = await createPlan(owner.token);
    const activityId = await createActivity(owner.token, planId);

    const text = await attach(owner.token, activityId, TEXT, 'notes.txt', 'text/plain');
    expect(text.status).toBe(400);
    expect(text.body.message).toBe('Only images and PDF files can be attached');
    expect(await Attachment.countDocuments({ activityId })).toBe(0);

    const spoofed = await attach(
      owner.token,
      activityId,
      Buffer.from('MZ not a png'),
      'photo.png',
      'image/png',
    );
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.message).toBe('Only images and PDF files can be attached');

    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const oversized = await attach(owner.token, activityId, big, 'huge.png', 'image/png');
    expect(oversized.status).toBe(400);
    expect(oversized.body.message).toBe('File must be 10 MB or smaller');

    for (let index = 0; index < 5; index += 1) {
      const saved = await attach(owner.token, activityId, PNG, `photo-${index}.png`, 'image/png');
      expect(saved.status).toBe(201);
    }
    const sixth = await attach(owner.token, activityId, PNG, 'photo-5.png', 'image/png');
    expect(sixth.status).toBe(400);
    expect(sixth.body.message).toBe('An activity can have at most 5 attachments');
    expect(await Attachment.countDocuments({ activityId })).toBe(5);
  });

  test('the uploader or the owner can delete, and the file is removed', async () => {
    const owner = await registerAndLogin('ada-del@example.com');
    const collaborator = await registerAndLogin('bea-del@example.com');
    const other = await registerAndLogin('cam-del@example.com');
    const stranger = await registerAndLogin('dee-del@example.com');
    const planId = await createPlan(owner.token);
    await acceptRole(owner.token, collaborator.token, planId, collaborator.email, 'Collaborator');
    await acceptRole(owner.token, other.token, planId, other.email, 'Collaborator');
    const activityId = await createActivity(owner.token, planId);

    const uploaded = await attach(
      collaborator.token,
      activityId,
      PNG,
      'shared.png',
      'image/png',
    );
    expect(uploaded.status).toBe(201);
    const stored = await Attachment.findById(uploaded.body.id).select('+storageKey').lean();
    const onDisk = absolutePath(stored.storageKey);

    const strangerList = await request(app)
      .get(`/api/activities/${activityId}/attachments`)
      .set(bearer(stranger.token));
    expect(strangerList.status).toBe(403);
    expect(strangerList.body.message).toBe('Only plan members can view attachments');

    const strangerFile = await request(app)
      .get(`/api/attachments/${uploaded.body.id}/file`)
      .set(bearer(stranger.token));
    expect(strangerFile.status).toBe(403);

    const otherDelete = await request(app)
      .delete(`/api/attachments/${uploaded.body.id}`)
      .set(bearer(other.token));
    expect(otherDelete.status).toBe(403);
    expect(otherDelete.body.message).toBe('Only the uploader or the Owner can delete an attachment');
    expect(await fs.readFile(onDisk)).toEqual(PNG);

    const removed = await request(app)
      .delete(`/api/attachments/${uploaded.body.id}`)
      .set(bearer(owner.token));
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ id: uploaded.body.id, deleted: true });
    expect(await Attachment.findById(uploaded.body.id)).toBeNull();
    await expect(fs.access(onDisk)).rejects.toThrow();

    const gone = await request(app)
      .get(`/api/attachments/${uploaded.body.id}/file`)
      .set(bearer(owner.token));
    expect(gone.status).toBe(404);
    expect(gone.body.message).toBe('Attachment not found');

    const again = await attach(collaborator.token, activityId, PNG, 'mine.png', 'image/png');
    expect(again.status).toBe(201);
    const selfDelete = await request(app)
      .delete(`/api/attachments/${again.body.id}`)
      .set(bearer(collaborator.token));
    expect(selfDelete.status).toBe(200);
    expect(selfDelete.body.deleted).toBe(true);
  });

  test('a storage key cannot leave the upload directory', async () => {
    const owner = await registerAndLogin('ada-path@example.com');
    const planId = await createPlan(owner.token);
    const activityId = await createActivity(owner.token, planId);
    const outside = path.join(path.dirname(uploadDir), 'wv-secret.txt');
    await fs.writeFile(outside, 'secret');
    const row = await Attachment.create({
      activityId,
      planId,
      uploadedBy: owner.userId,
      filename: 'secret.txt',
      mimeType: 'application/pdf',
      size: 6,
      storageKey: '../wv-secret.txt',
    });
    const file = await request(app)
      .get(`/api/attachments/${row._id}/file`)
      .set(bearer(owner.token));
    expect(file.status).toBe(404);
    expect(file.body.message).toBe('File not found');
    expect(await fs.readFile(outside, 'utf8')).toBe('secret');
    await fs.rm(outside, { force: true });
  });

  test('unknown activity and a missing file are 404', async () => {
    const owner = await registerAndLogin('ada-miss@example.com');
    const planId = await createPlan(owner.token);
    const missingActivity = await attach(owner.token, 'missing-activity', PNG, 'photo.png', 'image/png');
    expect(missingActivity.status).toBe(404);
    expect(missingActivity.body.message).toBe('Activity not found');

    const activityId = await createActivity(owner.token, planId);
    const empty = await request(app)
      .get(`/api/activities/${activityId}/attachments`)
      .set(bearer(owner.token));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const noFile = await request(app)
      .get('/api/attachments/missing-file/file')
      .set(bearer(owner.token));
    expect(noFile.status).toBe(404);
    expect(noFile.body.message).toBe('Attachment not found');
  });
});
