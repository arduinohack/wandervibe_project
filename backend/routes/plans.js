const express = require('express');
const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');
const User = require('../models/User');
const Invitation = require('../models/Invitation');
const ActivityRevision = require('../models/ActivityRevision');
const SupportLog = require('../models/SupportLog');
const { Event } = require('../models/Event');
const { compareStoredOrder } = require('../utils/activityTimes');
const authMiddleware = require('../middleware/auth.js');  // Add this line for token verification
const { checkPermission } = require('../utils/permissions');
const { roleCheck, canonicalMembershipRole } = require('../middleware/roleCheck');
const { DateTime } = require('luxon');  // For time zone/DST in Day Numbers
const { v4: uuidv4 } = require('uuid');
const { notifyUsers } = require('../utils/notifications');
const { logSupport } = require('../utils/logSupport');
const multer = require('multer');
const {
  parseCsv,
  readColumnMap,
  headerIndex,
  cell,
  planZone,
  parseActivityTime,
  importDateStamp,
  escapeRegExp,
  uploadKind,
} = require('../utils/csvPlanImport');
const { readExportQuery, buildPlanExport } = require('../utils/planExport');
const router = express.Router();
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const logger = require('../utils/logger');  // Added: Borrow exported logger from ../util/logger.js


// POST /api/plans (Protected: Creates plan and assigns Owner role)
router.post('/', authMiddleware, async (req, res) => {
  const { type, name, destination, startDate, endDate, timeZone, budget } = req.body;

  logger.info('In Post /api/plans - Creates plan and assigns Owner role to requestor');
  // Validate required fields
  if (!type || !name) {
    return res.status(400).json({ msg: 'Missing required fields: type, name' });
  }

  try {
    // Generate UUID for plan ID
    const planId = uuidv4();

    logger.info('userId: ', req.user.userId);
    
    // Create the plan document
    const plan = new Plan({
      _id: planId,
      type,
      name,
      destination: req.body.destination,
      startDate: req.body.startDate ? new Date(req.body.startDate) : null,  // FIXED: Allow null
      endDate: req.body.endDate ? new Date(req.body.endDate) : null,  // FIXED: Allow null
      location: req.body.location,
      timeZone: req.body.timeZone,
      budget: req.body.budget || 0,
      autoCalculateStartDate: req.body.autoCalculateStartDate || true,
      autoCalculateEndDate: req.body.autoCalculateEndDate || true,
      ownerId: req.user.userId
    });
    await plan.save();  // Now saves with null dates    // Assign Owner role

    const planUser = new PlanUser({
      planId,
      userId: req.user.userId,
      role: 'Owner'
    });
    await planUser.save();

    // Notify the creator
    await notifyUsers([req.user.userId], `Your plan "${name}" has been created! ID: ${planId}`);

    await logSupport({
      level: 'info',
      event: 'PlanCreated',
      actorUserId: req.user.userId || req.user.id,
      planId,
      message: 'Plan created',
      extra: { type, name },
    });

    // Success response
    res.status(201).json({ 
      msg: 'Plan created successfully!', 
      plan 
    });
  } catch (err) {
    console.error('Plan creation error:', err);
    res.status(500).json({ msg: 'Server error during plan creation' });
  }
});

// GET /api/plans (Protected: Lists user's plans as owner or participant)
// get plans that user is an owner(VibeCoordinator), VibePlanner or Wanderer
router.get('/', authMiddleware, async (req, res) => {
  logger.info('Lists user\'s plans as owner or participant', {
    userId: req.user.userId,
    event: 'GetAPIPlans',
    context: { context: 'n/a' }
  });

  try {
    const userId = req.user.userId || req.user.id;
    const memberships = await PlanUser.find({ userId }).select('planId');
    const planIds = memberships.map((membership) => membership.planId);
    const plans = await Plan.find({
      $or: [
        { _id: { $in: planIds } },
        { ownerId: userId },
      ],
    }).populate('participants');
    res.status(200).json({ plans });
  } catch (error) {
    console.error('Fetch plans error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
/*    try {
    // Find plans where user is owner
    const ownedPlans = await Plan.find({ ownerId: req.user.userId }).select('type name destination startDate endDate autoCalculateStartDate autoCalculateEndDate location budget planningState timeZone ownerId');

    // Find plans where user is participant (via plan_users)
    const participantPlans = await PlanUser.find({ userId: req.user.userId }).populate('planId', 'name destination startDate endDate planningState timeZone');
    const participantPlanObjs = participantPlans.filter(pt => pt.planId).map(pt => pt.planId);  // Filter undefined

    // Combine and dedupe
    const allPlans = [...ownedPlans, ...participantPlanObjs];
    const uniquePlans = Array.from(new Set(allPlans.map(t => t._id.toString()))).map(id => 
      allPlans.find(t => t._id.toString() === id)
    );

    res.json({ 
      msg: 'User plans fetched!', 
      plans: uniquePlans.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))  // Sort by startDate
    });
  } catch (err) {
    console.error('List plans error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});
*/

// GET /api/plans/:planId/users (Protected: Lists plan participants with roles)
// Need to read users and role if the requesting user is owner or VibePlanner only
router.get('/:planId/users', authMiddleware, async (req, res) => {
  const { planId } = req.params;
  logger.info('In Get /api/plans/{planID}/users - lists a plans users');

  try {
    // Check caller is participant
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
    }

    // Fetch all plan users, populate with full user details
    const planUsers = await PlanUser.find({ planId }).populate('userId', 'firstName lastName email');

    // Format response
    const formatted = planUsers.map(tu => ({
      userId: tu.userId._id,
      name: `${tu.userId.firstName} ${tu.userId.lastName}`,
      email: tu.userId.email,
      role: tu.role
    }));

    // Group by role
    const grouped = {
      Owner: formatted.filter(u => canonicalMembershipRole(u.role) === 'Owner'),
      Collaborator: formatted.filter(u => canonicalMembershipRole(u.role) === 'Collaborator'),
      Guest: formatted.filter(u => canonicalMembershipRole(u.role) === 'Guest')
    };

    res.json({ 
      msg: 'Plan users fetched!', 
      users: formatted,  // Flat list
      grouped  // Role-grouped for UI
    });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

function memberDisplayName(user) {
  if (!user) return '';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim();
}

function normalizeMemberEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function escapeMemberEmailRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function memberEmailMatch(email) {
  return { email: { $regex: `^${escapeMemberEmailRegex(email)}$`, $options: 'i' } };
}

function pendingInviteFilter(planId, email, userId) {
  const matchers = [memberEmailMatch(email)];
  if (userId) matchers.push({ userId: String(userId) });
  return { planId, status: 'pending', $or: matchers };
}

// GET /api/plans/:planId/members
// Owner, Collaborator, or Guest. Accepted people plus pending invitations.
router.get('/:planId/members', roleCheck(['Owner', 'Collaborator', 'Guest']), async (req, res) => {
  const { planId } = req.params;
  logger.info('In Get /api/plans/{planId}/members - lists accepted members and pending invites');

  try {
    const [planUsers, pendingInvites] = await Promise.all([
      PlanUser.find({ planId }).select('userId role').lean(),
      Invitation.find({ planId, status: 'pending' }).select('userId email role').lean(),
    ]);

    const userIds = new Set();
    for (const row of planUsers) {
      if (row.userId) userIds.add(String(row.userId));
    }
    for (const invite of pendingInvites) {
      if (invite.userId) userIds.add(String(invite.userId));
    }

    const users = userIds.size
      ? await User.find({ _id: { $in: [...userIds] } }).select('firstName lastName email').lean()
      : [];
    const userById = new Map(users.map((user) => [String(user._id), user]));

    const members = [];
    const acceptedIds = new Set();
    for (const row of planUsers) {
      const id = String(row.userId || '');
      if (id) acceptedIds.add(id);
      const user = userById.get(id);
      members.push({
        name: memberDisplayName(user),
        email: (user && user.email) || '',
        role: row.role,
        status: 'accepted',
      });
    }

    for (const invite of pendingInvites) {
      const id = invite.userId ? String(invite.userId) : '';
      if (id && acceptedIds.has(id)) continue;
      const user = id ? userById.get(id) : null;
      members.push({
        name: memberDisplayName(user),
        email: (user && user.email) || invite.email || '',
        role: invite.role,
        status: 'pending',
      });
    }

    res.json({ members });
  } catch (err) {
    console.error('List members error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE /api/plans/:planId/members with { email }
// Owner may remove Collaborator or Guest. Collaborator may remove Guest.
// Guest is 403. Owner cannot be removed (400).
router.delete('/:planId/members', roleCheck(['Owner', 'Collaborator', 'Guest']), async (req, res) => {
  const { planId } = req.params;
  const email = normalizeMemberEmail(req.body && req.body.email);
  logger.info('In Delete /api/plans/{planId}/members - remove a member or pending invite');

  if (!email) {
    return res.status(400).json({ msg: 'Missing email' });
  }

  const callerRole = canonicalMembershipRole(req.planUser && req.planUser.role);
  if (callerRole === 'Guest') {
    return res.status(403).json({ msg: 'Access denied: insufficient plan role' });
  }

  try {
    const user = await User.findOne(memberEmailMatch(email)).select('firstName lastName email').lean();
    const userId = user ? String(user._id) : '';
    const [plan, membership, pending] = await Promise.all([
      Plan.findById(planId).select('name ownerId').lean(),
      userId ? PlanUser.findOne({ planId, userId }).lean() : null,
      Invitation.find(pendingInviteFilter(planId, email, userId)).select('role userId email').lean(),
    ]);

    const membershipRole = canonicalMembershipRole(membership && membership.role);
    const pendingRole = canonicalMembershipRole(pending[0] && pending[0].role);
    const isOwner = membershipRole === 'Owner'
      || pendingRole === 'Owner'
      || (userId && plan && String(plan.ownerId) === userId);

    if (isOwner) {
      return res.status(400).json({ msg: 'Cannot remove Owner' });
    }

    if (!membership && pending.length === 0) {
      return res.status(404).json({ msg: 'Member not found' });
    }

    const targetRole = membershipRole || pendingRole;
    if (callerRole === 'Collaborator' && targetRole !== 'Guest') {
      return res.status(403).json({ msg: 'Collaborators can only remove Guests' });
    }

    if (membership) {
      await PlanUser.deleteOne({ planId, userId: membership.userId });
    }
    if (pending.length) {
      await Invitation.deleteMany(pendingInviteFilter(planId, email, userId));
    }

    const planName = (plan && plan.name) || 'a plan';
    await notifyUsers(
      [userId || email],
      `You've been removed from "${planName}".`,
      'email',
    );

    res.status(200).json({ msg: 'Member removed' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/plans/:planId/remove-user (Protected: Removes user by ID)
// Owners can remove VibePlanners or Wanderers. VibePlanners can remove Wanderers.
router.post('/:planId/remove-user', authMiddleware, async (req, res) => {
  const { planId } = req.params;
  const { userId: targetUserId } = req.body;
  
  logger.info('In Post /api/plans/{planID}/remove-user - removes a user from a plan');

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing userId to remove' });
  }

  try {
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser) {
      return res.status(403).json({ msg: 'Access denied: Not a plan participant' });
    }

    if (targetUserId === req.user.userId) {
      return res.status(400).json({ msg: 'Cannot remove yourself' });
    }

    const targetPlanUser = await PlanUser.findOne({ planId, userId: targetUserId });
    if (!targetPlanUser) {
      return res.status(404).json({ msg: 'Target user not found on plan' });
    }

    const callerRole = canonicalMembershipRole(callerPlanUser.role);
    const targetRole = canonicalMembershipRole(targetPlanUser.role);
    if (callerRole !== 'Owner' && targetRole !== 'Guest') {
      return res.status(403).json({ msg: 'Collaborators can only remove Guests' });
    }

    if (targetRole === 'Owner') {
      return res.status(400).json({ msg: 'Cannot remove Owner—use reassign instead' });
    }

    await PlanUser.deleteOne({ planId, userId: targetUserId });

    const removedUser = await User.findById(targetUserId).select('firstName lastName');
    const plan = await Plan.findById(planId).select('name');

    await notifyUsers([targetUserId], `You've been removed from "${plan.name}" by ${callerPlanUser.userId}.`, 'email');
    await notifyUsers([req.user.userId], `Removed ${removedUser.firstName} ${removedUser.lastName} from "${plan.name}".`, 'email');

    res.json({ msg: 'User removed successfully!' });
  } catch (err) {
    console.error('Remove user error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/plans/:planId/reassign-coordinator (Protected: Transfers ownership to VibePlanner)
// only owners of a plan can reassign coordinator role to an existing planner
router.post('/:planId/reassign-coordinator', authMiddleware, async (req, res) => {
  const { planId } = req.params;
  const { targetUserId } = req.body;

  logger.info('In Post /api/plans/{planID}/reassign-coordinator - transfers plan ownership to a plan\'s VibePlanner');

  if (!targetUserId) {
    return res.status(400).json({ msg: 'Missing targetUserId' });
  }

  try {
    const callerPlanUser = await PlanUser.findOne({ planId, userId: req.user.userId });
    if (!callerPlanUser || canonicalMembershipRole(callerPlanUser.role) !== 'Owner') {
      return res.status(403).json({ msg: 'Only Owner can reassign' });
    }

    const targetPlanUser = await PlanUser.findOne({ planId, userId: targetUserId }).populate('userId', 'firstName lastName');
    if (!targetPlanUser || canonicalMembershipRole(targetPlanUser.role) !== 'Collaborator') {
      return res.status(400).json({ msg: 'Target must be a Collaborator' });
    }

    callerPlanUser.role = 'Collaborator';
    targetPlanUser.role = 'Owner';
    await callerPlanUser.save();
    await targetPlanUser.save();

    const plan = await Plan.findById(planId);
    plan.ownerId = targetUserId;
    await plan.save();

    const allParticipants = await PlanUser.find({ planId }).select('userId');
    const participantIds = allParticipants.map(tu => tu.userId);
    const reassignMsg = `Ownership transferred to ${targetPlanUser.userId.firstName} ${targetPlanUser.userId.lastName}!`;
    await notifyUsers(participantIds, reassignMsg, 'email');

    res.json({ msg: 'Ownership reassigned!', newCoordinator: targetPlanUser.userId });
  } catch (err) {
    console.error('Reassign error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/plans/:planId/itinerary (Protected: Fetches sorted events with Day Numbers)
// owners, assigned planners and assigned wanderers can get the plan itinierary
router.get('/:planId/itinerary', authMiddleware, async (req, res) => {
  const { planId } = req.params;

  logger.info('In Get /api/plans/{planID}/itinerary - fetches sorted events with Day Numbers');

  try {

    const canRead = await checkPermission(req.user.userId, planId, 'read');
    if (!canRead) return res.status(403).json({ message: 'Not authorized to read plan' });

    // Fetch plan for timeZone
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ msg: 'Plan not found' });
    }

    // Stored itinerary order. Equal eventNum values fall back to start time.
    let events = await Event.find({ $or: [{ planId: planId }, { eventPlanId: planId }] });
    events.sort(compareStoredOrder);
    events = events.map(event => ({
      ...event.toObject(),
      relevantTimeZone: event.type === 'flight'
        ? (event.destinationTimeZone || plan.timeZone)
        : plan.timeZone
    }));

    // Compute Day Numbers (loop, compare to previous). First event is day 1.
    let dayNumber = 1;
    let previousEnd = null;
    events.forEach(event => {
      if (previousEnd) {
        const start = DateTime.fromJSDate(event.startTime, { zone: event.relevantTimeZone });
        const prev = DateTime.fromJSDate(previousEnd, { zone: event.relevantTimeZone });
        if (start.startOf('day') > prev.startOf('day')) dayNumber++;
      }
      event.dayNumber = dayNumber;
      previousEnd = event.endTime;
    });

    // Group by dayNumber
    const grouped = events.reduce((acc, event) => {
      const day = event.dayNumber;
      acc[day] = acc[day] || [];
      acc[day].push(event);
      return acc;
    }, {});

    res.json({ 
      msg: 'Itinerary fetched!', 
      events,  // Flat list with dayNumber
      grouped  // {1: [events], 2: [events], ...}
    });
  } catch (err) {
    console.error('Itinerary error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

async function nextImportName(sourceName, timeZone) {
  const stamp = importDateStamp(timeZone);
  const pattern = new RegExp(`^${escapeRegExp(sourceName)} ${stamp} (\\d+)$`);
  const existing = await Plan.find({ name: pattern }).select('name').lean();
  let max = 0;
  for (const plan of existing) {
    const match = pattern.exec(plan.name);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return `${sourceName} ${stamp} ${max + 1}`;
}

function bodyText(body, key) {
  const value = body && body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readCsvUpload(req, res) {
  return new Promise((resolve, reject) => {
    csvUpload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve(req.file);
    });
  });
}

// POST /api/plans/:planId/import
// Owner or Collaborator uploads a CSV. Creates a new plan and one activity per named row.
router.post('/:planId/import', authMiddleware, async (req, res) => {
  const { planId } = req.params;
  try {
    const source = await Plan.findById(planId);
    if (!source) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const callerId = req.user.userId || req.user.id;
    const membership = await PlanUser.findOne({ planId, userId: callerId });
    let role = canonicalMembershipRole(membership && membership.role);
    if (!role && String(source.ownerId) === String(callerId)) role = 'Owner';
    if (role !== 'Owner' && role !== 'Collaborator') {
      return res.status(403).json({ message: 'Only Owner or Collaborator can import a plan' });
    }

    let file;
    try {
      file = await readCsvUpload(req, res);
    } catch (err) {
      if (res.headersSent) return;
      return res.status(400).json({ message: 'Only a CSV file can be imported' });
    }
    if (res.headersSent) return;

    const kind = uploadKind(file);
    if (kind === 'spreadsheet' || kind === 'notcsv') {
      return res.status(400).json({ message: 'Only a CSV file can be imported' });
    }
    if (kind !== 'csv') {
      return res.status(400).json({ message: 'CSV file and a column map are required' });
    }

    const columnMap = readColumnMap(req.body && req.body.map);
    if (!columnMap) {
      return res.status(400).json({ message: 'CSV file and a column map are required' });
    }

    const rows = parseCsv(file.buffer.toString('utf8'));
    const headers = rows[0] || [];
    const nameIndex = headerIndex(headers, columnMap.name);
    if (nameIndex < 0) {
      return res.status(400).json({ message: 'The name column is not in the CSV' });
    }
    const typeIndex = headerIndex(headers, columnMap.type);
    const startIndex = headerIndex(headers, columnMap.startTime);
    const endIndex = headerIndex(headers, columnMap.endTime);
    const locationIndex = headerIndex(headers, columnMap.location);
    const zone = planZone(source.timeZone);
    const planName = bodyText(req.body, 'planName');
    const defaultType = bodyText(req.body, 'defaultType');
    const typeMapped = typeIndex >= 0;
    if (!typeMapped && !defaultType) {
      return res.status(400).json({ message: 'A default type is required when type is not mapped' });
    }

    const activities = [];
    let skipped = 0;
    for (const dataRow of rows.slice(1)) {
      const name = cell(dataRow, nameIndex);
      if (!name) {
        skipped += 1;
        continue;
      }
      const activity = {
        _id: uuidv4(),
        name,
        type: typeMapped ? (cell(dataRow, typeIndex) || 'activity') : defaultType,
        location: cell(dataRow, locationIndex),
        planId: '',
        ownerId: callerId,
        status: 'draft',
      };
      const startTime = parseActivityTime(cell(dataRow, startIndex), zone);
      const endTime = parseActivityTime(cell(dataRow, endIndex), zone);
      if (startTime) activity.startTime = startTime;
      if (endTime) activity.endTime = endTime;
      activities.push(activity);
    }

    const newPlanId = uuidv4();
    const created = new Plan({
      _id: newPlanId,
      type: source.type,
      name: planName || await nextImportName(source.name, source.timeZone),
      destination: source.destination,
      startDate: source.startDate || null,
      endDate: source.endDate || null,
      location: source.location,
      timeZone: source.timeZone,
      ownerId: callerId,
    });
    await created.save();
    await new PlanUser({
      planId: newPlanId,
      userId: callerId,
      role: 'Owner',
    }).save();

    if (activities.length) {
      for (const activity of activities) activity.planId = newPlanId;
      await Event.insertMany(activities);
    }

    return res.status(201).json({
      planId: newPlanId,
      name: created.name,
      inserted: activities.length,
      skipped,
    });
  } catch (err) {
    if (res.headersSent) return;
    console.error('Plan import error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/plans/:planId/export
// Owner or Collaborator downloads the plan's activities. No plan is created.
router.get('/:planId/export', authMiddleware, async (req, res) => {
  const { planId } = req.params;
  try {
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const callerId = req.user.userId || req.user.id;
    const role = await callerPlanRole(plan, callerId);
    if (role !== 'Owner' && role !== 'Collaborator') {
      return res.status(403).json({ message: 'Only Owner or Collaborator can export a plan' });
    }

    const requested = readExportQuery(req.query);
    if (requested.error) {
      return res.status(400).json({ message: requested.error });
    }

    const activities = await Event.find({ planId }).lean();
    activities.sort(compareStoredOrder);
    const file = buildPlanExport({
      planName: plan.name,
      planTimeZone: plan.timeZone,
      activities,
      fields: requested.fields,
      format: requested.format,
    });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.disposition);
    return res.status(200).send(file.body);
  } catch (err) {
    console.error('Plan export error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

async function callerPlanRole(plan, callerId) {
  const membership = await PlanUser.findOne({ planId: plan._id, userId: callerId });
  let role = canonicalMembershipRole(membership && membership.role);
  if (!role && String(plan.ownerId) === String(callerId)) role = 'Owner';
  return role;
}

function sharedPerson(row, user) {
  return {
    userId: String(row.userId),
    email: (user && user.email) || '',
    firstName: (user && user.firstName) || '',
    lastName: (user && user.lastName) || '',
    role: row.role,
  };
}

function sharedInvite(row, user) {
  return {
    _id: String(row._id),
    email: (user && user.email) || row.email || '',
    role: row.role,
    status: 'pending',
  };
}

function textField(body, key) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return { present: false };
  const value = body[key];
  if (value == null) return { present: true, value: '' };
  if (typeof value !== 'string') return { present: true, invalid: true };
  return { present: true, value: value.trim() };
}

function boolField(body, key) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return { present: false };
  if (typeof body[key] !== 'boolean') return { present: true, invalid: true };
  return { present: true, value: body[key] };
}

function dateField(body, key) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return { present: false };
  const value = body[key];
  if (value == null || value === '') return { present: true, value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { present: true, invalid: true };
  return { present: true, value: date };
}

// PUT /api/plans/:planId
// The Owner may edit name, destination, dates, and time zone. Type and ownerId stay as stored.
router.put('/:planId', authMiddleware, async (req, res) => {
  const planId = String(req.params.planId || '');
  try {
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const callerId = req.user.userId || req.user.id;
    const role = await callerPlanRole(plan, callerId);
    if (role !== 'Owner') {
      return res.status(403).json({ message: 'Only the Owner can edit a plan' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = textField(body, 'name');
    if (name.invalid) return res.status(400).json({ message: 'Name must be text' });
    if (name.present && !name.value) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const destination = textField(body, 'destination');
    if (destination.invalid) {
      return res.status(400).json({ message: 'Destination must be text' });
    }
    if (destination.present && plan.type === 'trip' && !destination.value) {
      return res.status(400).json({ message: 'Destination is required' });
    }

    const startDate = dateField(body, 'startDate');
    const endDate = dateField(body, 'endDate');
    if (startDate.invalid || endDate.invalid) {
      return res.status(400).json({ message: 'Enter a valid date' });
    }

    const timeZone = textField(body, 'timeZone');
    if (timeZone.invalid) {
      return res.status(400).json({ message: 'Time zone must be text' });
    }

    const autoStart = boolField(body, 'autoCalculateStartDate');
    const autoEnd = boolField(body, 'autoCalculateEndDate');
    if (autoStart.invalid) {
      return res.status(400).json({ message: 'Auto-calculate start must be true or false' });
    }
    if (autoEnd.invalid) {
      return res.status(400).json({ message: 'Auto-calculate end must be true or false' });
    }

    if (name.present) plan.name = name.value;
    if (destination.present) plan.destination = destination.value;
    if (startDate.present) plan.startDate = startDate.value;
    if (endDate.present) plan.endDate = endDate.value;
    if (timeZone.present) plan.timeZone = timeZone.value;
    if (autoStart.present) plan.autoCalculateStartDate = autoStart.value;
    if (autoEnd.present) plan.autoCalculateEndDate = autoEnd.value;

    await plan.save();
    return res.json({ plan });
  } catch (err) {
    console.error('Edit plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/plans/:planId
// The Owner may delete a plan that is not shared. Another member or a pending invite is 409.
router.delete('/:planId', authMiddleware, async (req, res) => {
  const planId = String(req.params.planId || '');
  try {
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const callerId = req.user.userId || req.user.id;
    const role = await callerPlanRole(plan, callerId);
    if (role !== 'Owner') {
      return res.status(403).json({ message: 'Only the Owner can delete a plan' });
    }

    const [others, pending] = await Promise.all([
      PlanUser.find({ planId, userId: { $ne: callerId } }).lean(),
      Invitation.find({ planId, status: 'pending' }).lean(),
    ]);
    if (others.length || pending.length) {
      const userIds = [...new Set(
        [...others, ...pending].map((row) => row.userId).filter(Boolean),
      )];
      const users = userIds.length
        ? await User.find({ _id: { $in: userIds } }).select('email firstName lastName').lean()
        : [];
      const byId = new Map(users.map((user) => [String(user._id), user]));
      return res.status(409).json({
        message: 'Plan is still shared with someone else',
        people: others.map((row) => sharedPerson(row, byId.get(String(row.userId)))),
        invites: pending.map((row) => sharedInvite(row, byId.get(String(row.userId)))),
      });
    }

    await Event.deleteMany({ planId });
    await ActivityRevision.deleteMany({ planId });
    await Invitation.deleteMany({ planId });
    await SupportLog.deleteMany({ planId });
    await PlanUser.deleteMany({ planId });
    await Plan.deleteOne({ _id: planId });

    return res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('Delete plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;