const Plan = require('../models/Plan');
const PlanUser = require('../models/PlanUser');

const ARCHIVED_MESSAGE = 'This plan is archived.';
const DESCRIPTION_MAX = 500;

function isArchivedStatus(plan) {
  return Boolean(plan && plan.status === 'archived');
}

function archivedResult() {
  return { status: 403, body: { message: ARCHIVED_MESSAGE } };
}

function notArchivedFilter() {
  return { status: { $ne: 'archived' } };
}

function requestPath(req) {
  return `${req.baseUrl || ''}${req.path || ''}${req.originalUrl || ''}`;
}

function skipsArchiveGuard(req) {
  const path = requestPath(req).split('?')[0];
  return path.endsWith('/archive') || path.endsWith('/recall');
}

function planIdOf(req) {
  const fromParams = req.params && req.params.planId;
  if (fromParams) return String(fromParams);
  const original = String(req.originalUrl || '');
  const match = original.match(/\/api\/plans\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

// Members of an archived plan are blocked. Someone who is not a member
// falls through so the route can keep its own not-authorized response.
async function archivedMemberResult(planId, callerId) {
  const id = String(planId || '').trim();
  const userId = String(callerId || '').trim();
  if (!id || !userId) return null;
  const plan = await Plan.findById(id).select('status ownerId').lean();
  if (!isArchivedStatus(plan)) return null;
  if (String(plan.ownerId) === userId) return archivedResult();
  const member = await PlanUser.exists({ planId: id, userId });
  if (!member) return null;
  return archivedResult();
}

function archivedPlanGuard(req, res, next) {
  if (skipsArchiveGuard(req)) return next();
  const planId = planIdOf(req);
  if (!planId) return next();
  const callerId = req.user && (req.user.userId || req.user.id);
  archivedMemberResult(planId, callerId)
    .then((block) => {
      if (block) return res.status(block.status).json(block.body);
      return next();
    })
    .catch(next);
}

function readArchiveDescription(body) {
  if (!body || body.description == null) return { text: '' };
  if (typeof body.description !== 'string') {
    return { error: 'Description must be text.' };
  }
  const text = body.description.trim();
  if (text.length > DESCRIPTION_MAX) return { error: 'Description is too long.' };
  return { text };
}

module.exports = {
  ARCHIVED_MESSAGE,
  DESCRIPTION_MAX,
  isArchivedStatus,
  notArchivedFilter,
  archivedMemberResult,
  archivedPlanGuard,
  readArchiveDescription,
};
